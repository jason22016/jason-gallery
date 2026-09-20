import { captureDate } from '../components/viewer/metadata';

const decimal = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Accept complete positive decimal/rational values, never a parseFloat prefix. */
function positiveNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('/').map(part => part.trim());
  if (parts.length > 2 || parts.some(part => !decimal.test(part))) return null;
  const [numerator, denominator = 1] = parts.map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const result = numerator! / denominator;
  return Number.isFinite(result) && result > 0 ? result : null;
}

export function focalLengthValue(value: unknown): number | null {
  return positiveNumber(typeof value === 'string' ? value.trim().replace(/\s*mm$/i, '') : value);
}

export function apertureValue(value: unknown): number | null {
  return positiveNumber(typeof value === 'string' ? value.trim().replace(/^[fƒ]\s*\/\s*/i, '') : value);
}

export function isoValue(value: unknown): number | null {
  const number = positiveNumber(typeof value === 'string' ? value.trim().replace(/^ISO\s*/i, '') : value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

export function shutterSpeedValue(value: unknown): number | null {
  return positiveNumber(typeof value === 'string' ? value.trim().replace(/\s*(?:s|sec|seconds?)$/i, '') : value);
}

/** Reuse the Gallery's Make/Model and LensModel strings, retaining their spelling. */
export function equipmentValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text && !/^(?:unknown|undefined|null|nan|n\/?a|none|[-—])$/i.test(text) ? text : null;
}

export function captureWallClock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = captureDate({ DateTimeOriginal: value });
  if (!date) return null;
  // Validation above may inspect the offset; aggregation never converts the recorded clock.
  return date.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
