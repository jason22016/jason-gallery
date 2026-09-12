// Afilmory/Afilmory, apps/web/src/modules/metadata/ExifSection.tsx and formatExifData.tsx (Row)
// 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4. See THIRD_PARTY_NOTICES.md.
import { clsxm } from '@afilmory/utils';
import type { PropsWithChildren, ReactNode } from 'react';

export function ExifSection({ title, className, children }: PropsWithChildren<{ title: ReactNode; className?: string }>) {
  return <section className={clsxm('metadata-section', className)}><h3>{title}</h3>{children}</section>;
}

export function ExifRowGroup({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <dl className={clsxm('metadata-rows', className)}>{children}</dl>;
}

export function Row({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null || value === '') return null;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return <div><dt>{label}</dt><dd>{text}</dd></div>;
}

export function Rows({ values, className }: { values: readonly (readonly [string, unknown])[]; className?: string }) {
  return <ExifRowGroup className={className}>{values.map(([label, value]) => <Row key={label} label={label} value={value}/>)}</ExifRowGroup>;
}
