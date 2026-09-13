import type { Project } from './schema';

export const COVER_ASPECT_RATIO = 5 / 6;
export const DEFAULT_COVER_CROP = { x: 0.5, y: 0.5, zoom: 1 };
export type CoverCrop = NonNullable<Project['coverCrop']>;
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Dimensions relative to a 5:6 frame. Offsets describe the available overflow. */
export function coverGeometry(width: number, height: number, crop: CoverCrop = DEFAULT_COVER_CROP) {
  const ratio = width / height / COVER_ASPECT_RATIO;
  const w = Math.max(1, ratio) * crop.zoom;
  const h = Math.max(1, 1 / ratio) * crop.zoom;
  return { width: w, height: h, left: -(w - 1) * crop.x, top: -(h - 1) * crop.y };
}

/** Shared by the editor, admin preview, and static public cards. */
export function coverImageStyle(width: number, height: number, crop?: CoverCrop) {
  const g = coverGeometry(width, height, crop);
  return { position: 'absolute' as const, width: `${g.width * 100}%`, height: `${g.height * 100}%`, left: `${g.left * 100}%`, top: `${g.top * 100}%`, maxWidth: 'none', objectFit: 'fill' as const };
}
