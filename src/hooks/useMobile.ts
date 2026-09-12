// Adapted from Afilmory/Afilmory, apps/web/src/hooks/useMobile.ts
// Upstream 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4, Copyright (c) 2025 Afilmory Team.
// See THIRD_PARTY_NOTICES.md for the local adaptations.
import { useWindowViewport } from '@afilmory/viewer-motion';
export const useMobile = () => {
  const { width } = useWindowViewport();
  return width < 1024 && width !== 0;
};
export const isMobile = () => window.innerWidth < 1024 && window.innerWidth !== 0;
