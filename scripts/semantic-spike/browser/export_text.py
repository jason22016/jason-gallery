"""Export only the fixed SigLIP2 text tower, including its original pooling/head."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import argparse
import gc
import shutil
import time
from collections import Counter
from common import CACHE, HERE, MODELS, read, sha256, write
from experiment import queries
import numpy as np
import torch
import onnx
from transformers import AutoModel, AutoProcessor

OUT = CACHE / 'phase2a'
ASSETS = OUT / 'assets'
SPEC = MODELS['siglip2']


class TextOnly(torch.nn.Module):
    def __init__(self, text_model):
        super().__init__()
        self.text_model = text_model

    def forward(self, input_ids):
        # Same last-position pooling and trained projection head as get_text_features.
        return self.text_model(input_ids=input_ids).pooler_output


def export():
    ASSETS.mkdir(parents=True, exist_ok=True)
    snapshot = Path(read(CACHE / 'downloads/siglip2.json')['snapshot'])
    assert snapshot.name == SPEC['revision']
    processor = AutoProcessor.from_pretrained(snapshot, local_files_only=True, use_fast=False)
    q = queries()
    fixtures = q + [{'id': f'extra-{i}', 'text': text} for i, text in enumerate([
        ' A CAT  beside 水面! ', '森林\t小路\n湖泊', '雪山🌄 café １２３', '繁體中文：餵鹿與湖泊',
        'a ' * 100, '照片' * 100, '', 'MOUNTAIN vs mountain', '<eos> a cat'])]
    token_ids = [processor(text=[x['text']], padding='max_length', truncation=True,
                           max_length=64, return_tensors='pt')['input_ids'][0].tolist() for x in fixtures]
    for name in ('tokenizer.json', 'tokenizer_config.json'):
        shutil.copyfile(snapshot / name, ASSETS / name)
    corpus = read(CACHE / 'corpus.json')
    baseline = read(CACHE / 'siglip2/results.json')
    assert baseline['model']['revision'] == SPEC['revision']
    assert baseline['corpusFingerprint'] == corpus['fingerprint']
    assert baseline['environment']['queries_sha256'] == sha256(HERE / 'queries.json')
    assert [(x['id'], x['text']) for x in q] == [(x['query']['id'], x['query']['text']) for x in baseline['queries']]
    assert read(CACHE / 'siglip2/index.json')['ids'] == [p['id'] for p in corpus['photos']]
    write(ASSETS / 'dataset.json', {'revision': SPEC['revision'], 'dimension': 768,
        'corpusFingerprint': corpus['fingerprint'], 'queries': q,
        'fixtures': [{**x, 'input_ids': ids} for x, ids in zip(fixtures, token_ids)],
        'photos': [{'id': p['id'], 'publicId': p['publicId'], 'filename': p['filename']} for p in corpus['photos']]})
    images = np.load(CACHE / 'siglip2/image-embeddings.npy').astype('<f4')
    images.tofile(ASSETS / 'images.f32')
    write(OUT / 'provenance.json', {**SPEC, 'corpusFingerprint': corpus['fingerprint'],
        'baseline_text_sha256': sha256(CACHE / 'siglip2/text-embeddings.npy'),
        'baseline_image_sha256': sha256(CACHE / 'siglip2/image-embeddings.npy'),
        'annotations_sha256': sha256(CACHE / 'annotations.json'),
        'torch': torch.__version__, 'onnx': onnx.__version__,
        'input': 'int64 [1,64]; EOS + right pad 0; NO attention mask; last-position pool + learned head',
        'tokenizer_class': type(processor.tokenizer).__name__})
    if (ASSETS / 'fp32.onnx').exists():
        return
    torch.set_num_threads(4)
    model = AutoModel.from_pretrained(snapshot, local_files_only=True, dtype=torch.float32,
                                     attn_implementation='eager').eval()
    text = TextOnly(model.text_model).eval()
    total = sum(p.numel() for p in text.parameters())
    del model
    gc.collect()
    dummy = torch.tensor([token_ids[0]], dtype=torch.int64)
    # Compare the extracted tower with Phase 1 before any export/quantization.
    with torch.inference_mode():
        values = torch.cat([text(torch.tensor([ids])) for ids in token_ids[:len(q)]]).numpy()
    values /= np.linalg.norm(values, axis=1, keepdims=True)
    baseline_vectors = np.load(CACHE / 'siglip2/text-embeddings.npy')
    alignment = np.sum(values * baseline_vectors, axis=1)
    write(OUT / 'pytorch-extraction.json', {'parameters': total, 'fp32_weight_bytes': total * 4,
        'mean_cosine_to_phase1': float(alignment.mean()), 'min_cosine_to_phase1': float(alignment.min())})
    assert alignment.min() > .99999
    start = time.perf_counter()
    torch.onnx.export(text, (dummy,), ASSETS / 'fp32.onnx', input_names=['input_ids'],
                      output_names=['text_embeds'], opset_version=17, dynamo=False,
                      do_constant_folding=True, export_params=True)
    print('Exported text-only FP32', total, 'parameters in', time.perf_counter()-start, 's', flush=True)


def convert(variant):
    target = ASSETS / f'{variant}.onnx'
    if target.exists():
        return
    if variant == 'fp16':
        from onnxconverter_common.float16 import convert_float_to_float16
        model = onnx.load(ASSETS / 'fp32.onnx')
        model = convert_float_to_float16(model, keep_io_types=True, disable_shape_infer=True)
        onnx.save(model, target)
    elif variant == 'int8':
        from onnxruntime.quantization import quantize_dynamic, QuantType
        quantize_dynamic(str(ASSETS / 'fp32.onnx'), str(target), per_channel=True,
                         weight_type=QuantType.QInt8, op_types_to_quantize=['MatMul', 'Gather'],
                         extra_options={'MatMulConstBOnly': True})
    elif variant == 'int8wo':
        # Weight-only symmetric INT8. Keep activations, layernorm and original head FP32.
        # Row-wise token scales avoid the global outlier range of the 256k vocabulary.
        # Gather before dequantization avoids expanding the entire embedding table.
        from onnx import helper, numpy_helper, TensorProto
        model = onnx.load(ASSETS / 'fp32.onnx')
        initializers = {t.name:t for t in model.graph.initializer}
        prefix_nodes, replacements, drop, added = [], {}, set(), []
        for node in model.graph.node:
            if node.op_type == 'Gather' and node.input[0] in initializers:
                name = node.input[0]
                values = numpy_helper.to_array(initializers[name])
                if values.shape != (256000,768):
                    continue
                scales = np.maximum(np.max(np.abs(values),axis=1,keepdims=True)/127,1e-12).astype(np.float32)
                quantized = np.clip(np.rint(values/scales),-127,127).astype(np.int8)
                added.extend([numpy_helper.from_array(quantized,name+'_q8'),numpy_helper.from_array(scales,name+'_scales')])
                drop.add(name)
                output = node.output[0]
                replacements[node.name] = [
                    helper.make_node('Gather',[name+'_q8',node.input[1]],[output+'_q8'],axis=0),
                    helper.make_node('Gather',[name+'_scales',node.input[1]],[output+'_scale'],axis=0),
                    helper.make_node('Cast',[output+'_q8'],[output+'_float'],to=TensorProto.FLOAT),
                    helper.make_node('Mul',[output+'_float',output+'_scale'],[output])]
            elif node.op_type == 'MatMul' and node.input[1] in initializers:
                name = node.input[1]
                if name in drop: continue
                values = numpy_helper.to_array(initializers[name])
                if values.ndim != 2: continue
                scales = np.maximum(np.max(np.abs(values),axis=0)/127,1e-12).astype(np.float32)
                quantized = np.clip(np.rint(values/scales),-127,127).astype(np.int8)
                added.extend([numpy_helper.from_array(quantized,name+'_q8'),numpy_helper.from_array(scales,name+'_scales'),
                              numpy_helper.from_array(np.zeros(scales.shape,dtype=np.int8),name+'_zeros')])
                drop.add(name)
                prefix_nodes.append(helper.make_node('DequantizeLinear',[name+'_q8',name+'_scales',name+'_zeros'],[name],axis=1))
        nodes = prefix_nodes + [n for node in model.graph.node for n in replacements.get(node.name,[node])]
        kept = [t for t in model.graph.initializer if t.name not in drop]
        del model.graph.node[:];model.graph.node.extend(nodes)
        del model.graph.initializer[:];model.graph.initializer.extend(kept+added)
        onnx.save(model,target)
    else:
        raise ValueError(variant)
    print('Converted', variant, target.stat().st_size, flush=True)


def manifest():
    variants = {}
    for name in ('fp32', 'fp16', 'int8', 'int8wo'):
        path = ASSETS / f'{name}.onnx'
        if not path.exists():
            continue
        model = onnx.load(path)
        assert not any('vision' in t.name for t in model.graph.initializer)
        assert [x.name for x in model.graph.input] == ['input_ids']
        assert [x.name for x in model.graph.output] == ['text_embeds']
        onnx.checker.check_model(str(path))
        variants[name] = {'file': path.name, 'bytes': path.stat().st_size, 'sha256': sha256(path),
                          'ops': dict(Counter(n.op_type for n in model.graph.node)),
                          'initializer_types': dict(Counter(onnx.TensorProto.DataType.Name(t.data_type) for t in model.graph.initializer)),
                          'initializer_parameters': sum(np.prod(t.dims).item() for t in model.graph.initializer)}
        del model
        gc.collect()
    write(ASSETS / 'manifest.json', {'model': SPEC, 'variants': variants,
        'tokenizer': {name: {'bytes': (ASSETS/name).stat().st_size, 'sha256': sha256(ASSETS/name)}
                      for name in ('tokenizer.json','tokenizer_config.json')}})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('step', choices=['export', 'fp16', 'int8', 'int8wo', 'manifest'])
    args = parser.parse_args()
    if args.step == 'export': export()
    elif args.step == 'manifest': manifest()
    else: convert(args.step)
