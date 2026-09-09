// Tiny browser-safe facade for the native manifest's hexadecimal ThumbHash encoding.
// Kept separate from browser.ts so placeholders cannot eagerly load the GPU viewer.
export { decompressUint8Array as decodeThumbHash } from '@afilmory/utils/u8array.ts';
