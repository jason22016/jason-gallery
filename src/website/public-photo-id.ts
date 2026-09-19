import { createHash } from 'node:crypto';

/** URL identity only. Keep the namespace, encoding and length stable across releases. */
export function shortPublicPhotoId(photoId: string): string {
  return createHash('sha256').update('jason-gallery:public-photo:v1\0').update(photoId, 'utf8')
    .digest().subarray(0, 12).toString('base64url');
}

/** Fail closed rather than silently publishing one photo at another photo's URL. */
export function indexPublicPhotoIds<T extends { readonly id: string; readonly publicId: string }>(photos: Iterable<T>): ReadonlyMap<string, T> {
  const index = new Map<string, T>();
  for (const photo of photos) {
    const existing = index.get(photo.publicId);
    if (existing && existing.id !== photo.id) throw new Error(`Public photo ID collision: ${photo.publicId}`);
    index.set(photo.publicId, photo);
  }
  return index;
}
