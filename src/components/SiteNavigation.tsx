import { Icon } from './gallery/ui/Icon';
import type { GalleryState } from './gallery/filters';
import { globalGalleryHref } from './gallery/url-state';

export function SiteNavigation({ current, compact = false, state }: { current?: 'projects' | 'explore' | 'map' | 'stats'; compact?: boolean; state?: GalleryState }) {
  const links = <nav className="site-navigation" aria-label="网站导航">
    <a href="/" aria-current={current === 'projects' ? 'page' : undefined}>Projects</a>
    <a href={globalGalleryHref('explore', state)} aria-current={current === 'explore' ? 'page' : undefined}>Explore</a>
    <a href={globalGalleryHref('map', state)} aria-current={current === 'map' ? 'page' : undefined}>Map</a>
    <a href="/stats/" aria-current={current === 'stats' ? 'page' : undefined}>Stats</a>
  </nav>;
  return compact ? <details className="site-navigation-menu" onKeyDown={event => {
    if (event.key === 'Escape') {
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus();
    }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }}>
    <summary className="gallery-action" aria-label="网站导航" title="Projects / Explore / Map / Stats"><Icon name="list-ordered" /></summary>
    {links}
  </details> : links;
}
