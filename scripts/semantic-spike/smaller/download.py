"""Pinned official downloads, with all hub files under the existing experiment cache."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import CACHE, write
from huggingface_hub import snapshot_download

MODELS={
 'multiclip':('sentence-transformers/clip-ViT-B-32-multilingual-v1','58edf8cada9e398793dca955574a48cbb7f18be2',
             ['*.json','*.safetensors','vocab.txt','onnx/model_qint8_arm64.onnx','README.md']),
 'mobileclip2':('apple/MobileCLIP2-S0','3136ea51c8ed56b9f9abfab04cb816735aaad6cb',['*.json','*.pt','README.md','LICENSE'])}
for key,(repo,revision,patterns) in MODELS.items():
    path=snapshot_download(repo,revision=revision,allow_patterns=patterns,max_workers=3)
    write(CACHE/'smaller'/f'{key}-download.json',{'id':repo,'revision':revision,'snapshot':path})
    print(key,path,flush=True)
