"""Contact sheets for visual inspection; never writes or invents human judgements."""
import sys
sys.dont_write_bytecode=True
import experiment as e
from PIL import Image, ImageOps, ImageDraw

names=['baseline','trim64k','trim32k','multiclip','mobileclip2']
results={n:e.read(e.OUT/'evaluation'/f'{n}-int8wo-webgpu.json') for n in names}
photos={p['id']:p for p in e.read(e.CACHE/'corpus.json')['photos']}
selected=['chipmunk-en','boat-en','crane-en','feeding-chipmunk-zh','lake-trees-en','extra-6','extra-0','extra-12']
for qid in selected:
    i=next(i for i,q in enumerate(e.all_queries()) if q['id']==qid)
    sheet=Image.new('RGB',(1620,730),'#15171b');draw=ImageDraw.Draw(sheet)
    draw.text((12,8),qid+' | ranks 1-5 left, 6-10 right | green=existing AI qrel',(240,240,240))
    for row,name in enumerate(names):
        y=42+row*136;draw.text((12,y),name,(240,240,240))
        for rank,p in enumerate(results[name]['queries'][i]['top10']):
            x=12+rank*159
            with Image.open(e.ROOT/photos[p['id']]['thumbnail']) as im:
                im=ImageOps.exif_transpose(im).convert('RGB');im.thumbnail((150,100));sheet.paste(im,(x+(150-im.width)//2,y+18+(100-im.height)//2))
            draw.rectangle((x,y+18,x+150,y+118),outline='#36b98f' if p['relevant'] else '#ce6565',width=2)
            draw.text((x,y+120),f'{rank+1}: {p["filename"][:22]}',(220,220,220))
    sheet.save(e.OUT/f'review-{qid}.jpg',quality=90)
print('Wrote',len(selected),'visual-review contact sheets')
