"""Render selected Top-10 comparisons for visual review, without inventing human labels."""
import sys
sys.dont_write_bytecode=True
import experiment as x
e=x.e
from PIL import Image,ImageOps,ImageDraw
names=['v64-int8','v64-uint4','v64-int4','v64-int4-e4','v64-mlp4','v32-int4','v16-int4']
results={n:e.read(x.OUT/'evaluation'/f'{n}-webgpu.json') for n in names}
photos={p['id']:p for p in e.read(e.CACHE/'corpus.json')['photos']}
for qid in ['extra-6','extra-13','feeding-deer-zh','feeding-chipmunk-zh','chipmunk-en','hard-2','hard-7','diagnostic-0','diagnostic-4']:
    i=next(i for i,q in enumerate(x.queries()) if q['id']==qid)
    sheet=Image.new('RGB',(1620,40+len(names)*136),'#15171b');draw=ImageDraw.Draw(sheet)
    draw.text((12,8),qid+' | Top-5 left / ranks 6-10 right | gray = unlabelled',(240,240,240))
    for row,name in enumerate(names):
        y=35+row*136;draw.text((12,y),name,(240,240,240))
        for k,p in enumerate(results[name]['queries'][i]['top10']):
            left=12+k*159
            with Image.open(e.ROOT/photos[p['id']]['thumbnail']) as im:
                im=ImageOps.exif_transpose(im).convert('RGB');im.thumbnail((150,100));sheet.paste(im,(left+(150-im.width)//2,y+18+(100-im.height)//2))
            color='#999' if p['relevant'] is None else '#36b98f' if p['relevant'] else '#ce6565'
            draw.rectangle((left,y+18,left+150,y+118),outline=color,width=2)
            draw.text((left,y+120),f'{k+1}: {p["filename"][:22]}',(220,220,220))
    sheet.save(x.OUT/f'review-{qid}.jpg',quality=90)
print('9 review sheets rendered; human judgements not generated')
