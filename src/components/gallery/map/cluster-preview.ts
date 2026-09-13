import { captureDate } from '../../viewer/metadata';

export const unknownCaptureDay = 99999999;

export function clusterMarkerSize(pointCount: number) {
  return Math.min(64, Math.max(40, 32 + Math.log(Math.max(1, pointCount)) * 8));
}

export function clusterCaptureProperties(date: string) {
  const recorded = captureDate({ DateTimeOriginal: date });
  const day = recorded ? Number(recorded.slice(0, 10).replaceAll('-', '')) : 0;
  return { capture_start: day || unknownCaptureDay, capture_end: day };
}

export const clusterDateProperties = {
  capture_start: ['min', ['get', 'capture_start']],
  capture_end: ['max', ['get', 'capture_end']],
};

export function clusterDateRange(firstDay: number, lastDay: number) {
  if (firstDay === unknownCaptureDay || !lastDay) return '';
  const format = (day: number) => {
    const value = String(day).padStart(8, '0');
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`)
      .toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return firstDay === lastDay ? format(firstDay) : `${format(firstDay)} — ${format(lastDay)}`;
}

export function clusterCoordinates([longitude, latitude]: readonly number[]) {
  const normalized = ((longitude! + 180) % 360 + 360) % 360 - 180;
  return `${Math.abs(latitude!).toFixed(4)}°${latitude! < 0 ? 'S' : 'N'}, ${Math.abs(normalized).toFixed(4)}°${normalized < 0 ? 'W' : 'E'}`;
}
