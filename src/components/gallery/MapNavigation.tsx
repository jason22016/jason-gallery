// MiniMap link semantics adapted from Afilmory/Afilmory, apps/web/src/modules/metadata/MiniMap.tsx
// 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4. See THIRD_PARTY_NOTICES.md.
import { createContext, useContext, type ReactNode } from 'react';

export const MapNavigationContext = createContext<{ href: string; navigate: () => void } | null>(null);

export function MapPhotoLink({ className, children }: { className: string; children?: ReactNode }) {
  const navigation = useContext(MapNavigationContext);
  if (!navigation) return null;
  return <a className={className} href={navigation.href} aria-label={children ? undefined : '在地图中查看'} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigation.navigate();
  }}>{children}</a>;
}
