import { useSyncExternalStore } from 'react';

const mediaQuery = '(prefers-reduced-motion: reduce)';
let media: MediaQueryList | undefined;
let snapshotMedia: MediaQueryList | undefined;
const getMedia = () => media ??= window.matchMedia(mediaQuery);
// Snapshot reads must not update the subscribed query before its change event is delivered.
const getSnapshot = () => (snapshotMedia ??= window.matchMedia(mediaQuery)).matches;
const subscribe = (onChange: () => void) => {
  const query = getMedia();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
export const useReducedMotion = () => useSyncExternalStore(subscribe, getSnapshot, () => false);
