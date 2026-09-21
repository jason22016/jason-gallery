"""Pinned CPU-only SigLIP2 thumbnail encoder used by the production build."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True


EXPECTED_RUNTIME = {
    "transformers": "4.57.1",
    "huggingface-hub": "0.36.0",
    "numpy": "2.2.6",
    "pillow": "11.3.0",
    "safetensors": "0.8.0",
    "tokenizers": "0.22.2",
}


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(file: Path) -> object:
    return json.loads(file.read_text(encoding="utf-8"))


def runtime_versions() -> dict[str, str]:
    versions = {name: importlib.metadata.version(name) for name in EXPECTED_RUNTIME}
    for name, expected in EXPECTED_RUNTIME.items():
        if versions[name] != expected:
            raise RuntimeError(f"Semantic runtime mismatch for {name}: expected {expected}, got {versions[name]}")
    torch_version = importlib.metadata.version("torch")
    if torch_version.split("+")[0] != "2.8.0":
        raise RuntimeError(f"Semantic runtime mismatch for torch: expected 2.8.0 CPU, got {torch_version}")
    versions["torch"] = torch_version
    return versions


def validate_model_config(config: object, expected_hash: str) -> dict:
    if not isinstance(config, dict) or digest_bytes(canonical_json(config).encode()) != expected_hash:
        raise RuntimeError("Semantic model contract hash mismatch")
    image = config.get("imageModel")
    preprocessing = config.get("preprocessing")
    embedding = config.get("embedding")
    client = config.get("clientModelRelease")
    index = config.get("index")
    if (
        config.get("schemaVersion") != 1
        or config.get("kind") != "jason-gallery-semantic-model"
        or not isinstance(image, dict)
        or image.get("id") != "google/siglip2-base-patch16-224"
        or image.get("revision") != "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"
        or not isinstance(preprocessing, dict)
        or preprocessing.get("version") != "siglip2-thumbnail-official-v1"
        or preprocessing.get("input") != "public-thumbnail-jpeg"
        or not isinstance(embedding, dict)
        or embedding.get("schemaVersion") != 1
        or embedding.get("dimension") != 768
        or embedding.get("dtype") != "float32-le"
        or embedding.get("normalization") != "l2"
        or not isinstance(client, dict)
        or client.get("indivisible") is not True
        or client.get("modelId") != image.get("id")
        or client.get("revision") != image.get("revision")
        or not isinstance(index, dict)
        or index.get("schemaVersion") != 1
    ):
        raise RuntimeError("Unsupported semantic model contract")
    release = dict(client)
    release_hash = release.pop("releaseSha256", None)
    if digest_bytes(canonical_json(release).encode()) != release_hash:
        raise RuntimeError("Client ONNX/tokenizer release contract mismatch")
    return config


def validate_processor(processor: object) -> None:
    value = processor.to_dict()
    expected = {
        "do_resize": True,
        "size": {"height": 224, "width": 224},
        "resample": 2,
        "do_rescale": True,
        "rescale_factor": 1 / 255,
        "do_normalize": True,
        "image_mean": [0.5, 0.5, 0.5],
        "image_std": [0.5, 0.5, 0.5],
    }
    for key, expected_value in expected.items():
        if value.get(key) != expected_value:
            raise RuntimeError(f"Official image preprocessing mismatch: {key}")


def check_request(value: object) -> dict:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1 or value.get("device") != "cpu":
        raise RuntimeError("Production semantic inference is CPU-only")
    if not isinstance(value.get("batchSize"), int) or not 1 <= value["batchSize"] <= 64:
        raise RuntimeError("Invalid semantic batch size")
    if not isinstance(value.get("threads"), int) or not 1 <= value["threads"] <= 64:
        raise RuntimeError("Invalid semantic CPU thread count")
    items = value.get("items")
    if not isinstance(items, list) or not items:
        raise RuntimeError("Semantic inference request must contain at least one item")
    keys: set[str] = set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {"cacheKey", "thumbnail"}:
            raise RuntimeError("Invalid semantic inference item")
        key = item["cacheKey"]
        thumbnail = item["thumbnail"]
        if not isinstance(key, str) or len(key) != 64 or any(char not in "0123456789abcdef" for char in key) or key in keys:
            raise RuntimeError("Invalid or duplicate semantic cache key")
        if not isinstance(thumbnail, str) or not Path(thumbnail).is_absolute() or not Path(thumbnail).is_file():
            raise RuntimeError("Semantic input must be an existing absolute thumbnail path")
        keys.add(key)
    return value


def main(request_file: Path) -> None:
    started = time.perf_counter()
    request = check_request(read_json(request_file))
    config_file = Path(request["modelConfig"])
    config = validate_model_config(read_json(config_file), request["modelContractSha256"])
    versions = runtime_versions()

    # Imports happen after the cheap contract/runtime checks so failures do not download a model.
    import numpy as np
    import torch
    from huggingface_hub import snapshot_download
    from PIL import Image, ImageOps
    from transformers import AutoImageProcessor, AutoModel

    if torch.cuda.is_available() and os.environ.get("SEMANTIC_DEVICE") != "cpu":
        raise RuntimeError("Production semantic inference must explicitly select CPU")
    torch.set_num_threads(request["threads"])
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)

    output = Path(request["outputDirectory"])
    output.mkdir(parents=True, exist_ok=False)
    model_cache = Path(request["modelCache"])
    model_cache.mkdir(parents=True, exist_ok=True)
    image = config["imageModel"]
    preprocessing = config["preprocessing"]
    offline = os.environ.get("SEMANTIC_OFFLINE") == "1"
    snapshot = Path(snapshot_download(
        repo_id=image["id"],
        revision=image["revision"],
        cache_dir=model_cache,
        allow_patterns=[image["config"]["file"], image["weights"]["file"], preprocessing["config"]["file"]],
        local_files_only=offline,
    ))
    for descriptor in (image["config"], image["weights"], preprocessing["config"]):
        if digest_file(snapshot / descriptor["file"]) != descriptor["sha256"]:
            raise RuntimeError(f"Pinned semantic model file hash mismatch: {descriptor['file']}")

    load_started = time.perf_counter()
    processor = AutoImageProcessor.from_pretrained(snapshot, local_files_only=True, use_fast=False, trust_remote_code=False)
    validate_processor(processor)
    model = AutoModel.from_pretrained(
        snapshot,
        local_files_only=True,
        trust_remote_code=False,
        dtype=torch.float32,
        attn_implementation="eager",
        use_safetensors=True,
    ).eval().to("cpu")
    model_load_seconds = time.perf_counter() - load_started

    inference_started = time.perf_counter()
    items = request["items"]
    batch_size = request["batchSize"]
    for offset in range(0, len(items), batch_size):
        batch = items[offset:offset + batch_size]
        images = []
        try:
            for item in batch:
                with Image.open(item["thumbnail"]) as source:
                    images.append(ImageOps.exif_transpose(source).convert("RGB"))
            inputs = processor(images=images, return_tensors="pt")
            with torch.inference_mode():
                vectors = model.get_image_features(**inputs).float().cpu().numpy().astype(np.float32, copy=False)
            norms = np.linalg.norm(vectors, axis=1, keepdims=True)
            if vectors.shape != (len(batch), config["embedding"]["dimension"]) or not np.isfinite(vectors).all() or np.any(norms < 1e-8):
                raise RuntimeError("Invalid SigLIP2 image embedding output")
            vectors = (vectors / norms).astype("<f4", copy=False)
            for item, vector in zip(batch, vectors, strict=True):
                target = output / f"{item['cacheKey']}.f32"
                temporary = output / f"{item['cacheKey']}.pending"
                temporary.write_bytes(vector.tobytes(order="C"))
                temporary.replace(target)
        finally:
            for opened in images:
                opened.close()
        print(f"semantic images {min(offset + batch_size, len(items))}/{len(items)}", file=sys.stderr, flush=True)
    inference_seconds = time.perf_counter() - inference_started
    print(canonical_json({
        "schemaVersion": 1,
        "device": "cpu",
        "modelContractSha256": request["modelContractSha256"],
        "count": len(items),
        "runtime": versions,
        "modelLoadSeconds": model_load_seconds,
        "inferenceSeconds": inference_seconds,
        "totalSeconds": time.perf_counter() - started,
    }))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--check":
        model = read_json(Path(sys.argv[2]))
        print(canonical_json({"device": "cpu", "runtime": runtime_versions(), "modelContractSha256": digest_bytes(canonical_json(model).encode())}))
    elif len(sys.argv) == 2:
        main(Path(sys.argv[1]).resolve())
    else:
        raise SystemExit("usage: embed.py <request.json> | embed.py --check <model.json>")
