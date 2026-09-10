// Synthetic structural/color fixtures, never camera samples or screen calibration targets.
import sharp from 'sharp';
import { gainmapJPEG, jpeg } from '../../scripts/photos/fixtures';

export function segment(image: Buffer, marker: number, payload: Buffer) {
  const header = Buffer.alloc(4); header.writeUInt16BE(marker); header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([image.subarray(0, 2), header, payload, image.subarray(2)]);
}
export function isoMetadata() {
  // ISO 21496-1 v0, one channel, base color space, common denominator 64.
  const data = Buffer.alloc(37); data[4] = 0x48;
  [64, 0, 128, 0, 128, 64, 1, 1].forEach((v, i) => data.writeInt32BE(v, 5 + i * 4));
  return data;
}
export async function colorFixtures() {
  const srgb = await sharp(await jpeg('#d14a28')).withIccProfile('srgb').jpeg({ quality: 100 }).toBuffer();
  const profile = (await sharp(await sharp(srgb).withIccProfile('p3').toBuffer()).metadata()).icc!;
  // Assign P3 to encoded RGB values (rather than convert an sRGB-limited source).
  const p3 = segment(await jpeg('#f04020'), 0xffe2, Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.from([1, 1]), profile]));
  const hdr = await gainmapJPEG();
  const primaryEnd = hdr.indexOf(Buffer.from([0xff, 0xd9])) + 2;
  const hdrP3 = Buffer.concat([segment(hdr.subarray(0, primaryEnd), 0xffe2, Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.from([1, 1]), profile])), hdr.subarray(primaryEnd)]);
  const gain = segment(await jpeg('#bbbbbb', 48, 32), 0xffe2, Buffer.concat([Buffer.from('urn:iso:std:iso:ts:21496:-1\0'), isoMetadata()]));
  const base = segment(await jpeg('#6789ac'), 0xffe2, Buffer.concat([Buffer.from('urn:iso:std:iso:ts:21496:-1\0'), Buffer.alloc(4)]));
  // MPF, little-endian TIFF, version + image count + two MP entries.
  const tiff = Buffer.alloc(82); tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(3, 8);
  tiff.writeUInt16LE(0xb000, 10); tiff.writeUInt16LE(7, 12); tiff.writeUInt32LE(4, 14); tiff.write('0100', 18);
  tiff.writeUInt16LE(0xb001, 22); tiff.writeUInt16LE(4, 24); tiff.writeUInt32LE(1, 26); tiff.writeUInt32LE(2, 30);
  tiff.writeUInt16LE(0xb002, 34); tiff.writeUInt16LE(7, 36); tiff.writeUInt32LE(32, 38); tiff.writeUInt32LE(50, 42);
  const primarySize = base.length + 90;
  tiff.writeUInt32LE(0x20030000, 50); tiff.writeUInt32LE(primarySize, 54);
  tiff.writeUInt32LE(gain.length, 70); tiff.writeUInt32LE(primarySize - 10, 74);
  const iso = Buffer.concat([segment(base, 0xffe2, Buffer.concat([Buffer.from('MPF\0'), tiff])), gain]);
  // Source advertises GainMap, but auxiliary has an invalid JPEG frame payload.
  const broken = Buffer.from(hdr); broken.fill(0, primaryEnd + 2);
  return { 'srgb-icc.jpg': srgb, 'p3-icc.jpg': p3, 'hdr-p3.jpg': hdrP3, 'iso-mpf.jpg': iso, 'broken-gain.jpg': broken };
}
