import { useSyncExternalStore } from 'react';

let media: MediaQueryList | undefined;
const getMedia = () => media ??= window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribe = (onChange: () => void) => {
  const query = getMedia();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => getMedia().matches, () => false);
