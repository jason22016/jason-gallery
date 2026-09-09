import type { APIRoute, GetStaticPaths } from 'astro';
import { loadProjects } from '../../../../projects';
import type { PhotoDetails } from '../../../../components/viewer/photos';
const detailFields = new Set(['DateTimeOriginal', 'ColorSpace', 'zone', 'tz', 'Artist', 'Software', 'FocalLength', 'FocalLengthIn35mmFormat', 'MaxApertureValue', 'ExposureProgram', 'ExposureMode', 'MeteringMode', 'WhiteBalance', 'Flash', 'LightSource', 'SceneCaptureType', 'FujiRecipe', 'GPSAltitude', 'BrightnessValue', 'ExposureCompensation', 'ShutterSpeedValue', 'ApertureValue', 'SensingMethod', 'FocalPlaneXResolution', 'FocalPlaneYResolution', 'Copyright']);
export const getStaticPaths = (() => loadProjects().listProjects().flatMap(project => project.photos.map(({ photo }) => ({
  params: { slug: project.slug, id: photo.id },
  props: { details: { exif: photo.exif ? Object.fromEntries(Object.entries(photo.exif).filter(([key]) => detailFields.has(key))) : null, toneAnalysis: photo.toneAnalysis } },
})))) satisfies GetStaticPaths;
export const GET: APIRoute = ({ props }) => new Response(JSON.stringify(props.details as PhotoDetails), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
