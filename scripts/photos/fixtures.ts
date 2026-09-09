import sharp from 'sharp';
function xmp(jpeg: Buffer, xml: string) {
  const payload = Buffer.from(`http://ns.adobe.com/xap/1.0/\0${xml}`);
  const header = Buffer.alloc(4); header.writeUInt16BE(0xffe1); header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}
export async function jpeg(color = '#426fa4', width = 96, height = 64) {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}
export async function gainmapJPEG() {
  const gain = xmp(await jpeg('#bbbbbb', 48, 32), `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0" hdrgm:GainMapMin="0" hdrgm:GainMapMax="2" hdrgm:Gamma="1" hdrgm:HDRCapacityMin="0" hdrgm:HDRCapacityMax="2"/></rdf:RDF></x:xmpmeta>`);
  const base = xmp(await jpeg('#6789ac'), `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="${gain.length}"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`);
  return Buffer.concat([base, gain]);
}
