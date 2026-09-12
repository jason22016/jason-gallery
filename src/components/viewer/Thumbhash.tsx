// Adapted from Afilmory/Afilmory, packages/ui/src/thumbhash/index.tsx
// Upstream 1f65cde6672e5231599182620116ac904e39f548; MIT, Copyright (c) 2025 Afilmory Team.
// See THIRD_PARTY_NOTICES.md for the local adaptations.
import { useMemo } from 'react';
import { dataUrlFromThumbhash } from './color';
export function Thumbhash({ thumbHash, className = '' }: { thumbHash: string; className?: string }) {
  const dataURL = useMemo(() => dataUrlFromThumbhash(thumbHash), [thumbHash]);
  return dataURL ? <img src={dataURL} alt="" draggable={false} className={`viewer-thumbhash ${className}`}/> : null;
}
