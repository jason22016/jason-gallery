"""MobileCLIP2-S0 native reference, paired image space, and browser text export."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import experiment as e
import open_clip
from timm.utils import reparameterize_model
from PIL import Image, ImageOps
import numpy as np
import torch
import shutil

def main():
    e.freeze();torch.set_num_threads(4)
    target=e.OUT/'mobileclip2';target.mkdir(exist_ok=True)
    meta=e.read(e.OUT/'mobileclip2-download.json');snapshot=Path(meta['snapshot'])
    # Official Apple README: S0 requires identity normalization when loading a local checkpoint.
    model,_,preprocess=open_clip.create_model_and_transforms('MobileCLIP2-S0',pretrained=str(snapshot/'mobileclip2_s0.pt'),image_mean=(0,0,0),image_std=(1,1,1))
    model.eval();tok=open_clip.get_tokenizer('MobileCLIP2-S0')
    # Verify eval-mode image equivalence before structural reparameterization is used.
    corpus=e.phase1.corpus();photos=corpus['photos']
    def pixels(photo):
        with Image.open(e.ROOT/photo['thumbnail']) as im:return preprocess(ImageOps.exif_transpose(im).convert('RGB'))
    first=pixels(photos[0]).unsqueeze(0)
    with torch.inference_mode():before=model.encode_image(first)
    model=reparameterize_model(model,inplace=True).eval()
    with torch.inference_mode():after=model.encode_image(first)
    np.testing.assert_allclose(before.numpy(),after.numpy(),rtol=1e-3,atol=2e-5)
    images=[]
    with torch.inference_mode():
        for i in range(0,len(photos),8):
            images.append(model.encode_image(torch.stack([pixels(p) for p in photos[i:i+8]])).numpy())
            print('MobileCLIP2 images',min(i+8,len(photos)),flush=True)
    images=e.phase1.normalize(np.concatenate(images));np.save(target/'image-embeddings.npy',images)
    fixtures=e.all_queries()+[{'id':f'probe-{i}','text':t} for i,t in enumerate(e.PROBES)]
    token_ids=tok([q['text'] for q in fixtures]);vectors=[]
    with torch.inference_mode():
        for ids in token_ids:vectors.append(model.encode_text(ids.unsqueeze(0)).numpy()[0])
    np.save(target/'pytorch-vectors.npy',e.phase1.normalize(vectors[:len(e.all_queries())]))
    class TextOnly(torch.nn.Module):
        def __init__(self,tower):super().__init__();self.text=tower
        def forward(self,input_ids):return self.text(input_ids)
    tower=TextOnly(model.text).eval()
    # Avoid traced native fast-path attention whose export is unsupported.
    torch.backends.mha.set_fastpath_enabled(False)
    torch.onnx.export(tower,(token_ids[:1],),target/'fp32.onnx',input_names=['input_ids'],output_names=['text_embeds'],opset_version=17,dynamo=False)
    e.quantize_weights(target/'fp32.onnx',target/'int8wo.onnx')
    clip=Path(e.read(e.CACHE/'downloads/clip.json')['snapshot'])
    for f in ('tokenizer.json','tokenizer_config.json'):shutil.copyfile(clip/f,target/f)
    # OpenCLIP and original CLIP share byte BPE; use official OpenCLIP fixtures as parity oracle.
    data={'kind':'mobileclip2','dimension':512,'queries':e.all_queries(),'photos':e.read(e.BASE/'dataset.json')['photos'],
          'fixtures':[dict(q,input_ids=ids.tolist()) for q,ids in zip(fixtures,token_ids)]}
    e.write(target/'dataset.json',data);images.astype('<f4').tofile(target/'images.f32')
    for variant in ('fp32','int8wo'):
        runtime=e.session(target/f'{variant}.onnx')
        values=[runtime.run(None,{'input_ids':ids.unsqueeze(0).numpy()})[0][0] for ids in token_ids[:len(e.all_queries())]]
        np.save(target/f'{variant}-vectors.npy',e.phase1.normalize(values))
    np.save(target/'text-embeddings.npy',e.phase1.normalize(values))
    e.write(target/'model.json',{'text':meta,'image':meta,'dimension':512,'text_parameters':sum(p.numel() for p in tower.parameters()),
             'format':'ONNX opset17 FP32 control / INT8 weight-only','images_reused':False,'preprocess':str(preprocess),
             'reparameterize_max_abs':float((before-after).abs().max()),'tokenizer':'OpenCLIP SimpleTokenizer, 49408 byte BPE, native multilingual input; no translation',
             'browser_tokenizer_scope':'Shared original CLIP byte BPE. Explicit browser parity against OpenCLIP fixtures; ftfy general mojibake repair not implemented in JS.'})
    print('MobileCLIP2 complete',flush=True)

if __name__=='__main__':main()
