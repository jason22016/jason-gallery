import { z } from 'zod';
import type { PhotoManifestItem } from '../photo-engine/index';

export type PhotoId = PhotoManifestItem['id'];

const nonBlank = z.string().refine(value => value.trim().length > 0, 'Must not be blank');
const photoId: z.ZodType<PhotoId> = nonBlank;

// Check the calendar explicitly: Date.parse normalizes some impossible dates.
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

const date = z.string().refine(isCalendarDate, 'Expected a valid calendar date YYYY-MM-DD (0001–9999)');
const period = z.strictObject({ start: date, end: date.optional() }).superRefine((value, ctx) => {
  if (value.end && isCalendarDate(value.start) && isCalendarDate(value.end) && value.end < value.start) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'Must be on or after period.start' });
  }
});

export const ProjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: nonBlank,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a lowercase kebab-case route segment'),
  title: nonBlank,
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  coverPhotoId: photoId,
  photos: z.array(z.strictObject({
    photoId,
    caption: z.string().optional(),
    alt: z.string().optional(),
  })).min(1, 'Project must contain at least one photo'),
  tags: z.array(nonBlank).optional(),
  period: period.optional(),
  order: z.number().finite(),
  status: z.enum(['draft', 'published']),
}).superRefine((project, ctx) => {
  const ids = new Set<PhotoId>();
  project.photos.forEach((photo, index) => {
    if (ids.has(photo.photoId)) {
      ctx.addIssue({ code: 'custom', path: ['photos', index, 'photoId'], message: `Duplicate photo ID "${photo.photoId}" in Project` });
    }
    ids.add(photo.photoId);
  });
  if (!ids.has(project.coverPhotoId)) {
    ctx.addIssue({ code: 'custom', path: ['coverPhotoId'], message: 'Cover must belong to this Project' });
  }
});

export type Project = z.infer<typeof ProjectSchema>;
