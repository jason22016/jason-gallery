import type { ResolvedProject } from '../projects';
import type { PhotoDetails } from '../components/viewer/photos';

const detailFields = new Set(['DateTimeOriginal', 'OffsetTimeOriginal', 'tzSource', 'GPSAltitudeRef', 'ColorSpace', 'zone', 'tz', 'Artist', 'Software', 'FocalLength', 'FocalLengthIn35mmFormat', 'MaxApertureValue', 'ExposureProgram', 'ExposureMode', 'MeteringMode', 'WhiteBalance', 'Flash', 'LightSource', 'SceneCaptureType', 'FujiRecipe', 'GPSAltitude', 'BrightnessValue', 'ExposureCompensation', 'ShutterSpeedValue', 'ApertureValue', 'SensingMethod', 'FocalPlaneXResolution', 'FocalPlaneYResolution', 'Copyright']);

/** Build-only public projection. A raw Manifest photo is not sufficient authority. */
export function projectPhotoDetails(project: ResolvedProject, id: string): PhotoDetails | undefined {
  if (project.status !== 'published') return undefined;
  const photo = project.photos.find(entry => entry.photoId === id)?.photo;
  if (!photo) return undefined;
  return structuredClone({
    exif: photo.exif ? Object.fromEntries(Object.entries(photo.exif).filter(([key]) => detailFields.has(key))) : null,
    toneAnalysis: photo.toneAnalysis,
  });
}
