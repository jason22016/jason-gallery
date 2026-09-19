import { Icon } from './gallery/ui/Icon';

export function SiteNavigation({ current, compact = false }: { current?: 'projects' | 'explore'; compact?: boolean }) {
  const links = <nav className="site-navigation" aria-label="网站导航">
    <a href="/" aria-current={current === 'projects' ? 'page' : undefined}>Projects</a>
    <a href="/explore/" aria-current={current === 'explore' ? 'page' : undefined}>Explore</a>
    <span aria-disabled="true" title="尚未开放">Map</span>
  </nav>;
  return compact ? <details className="site-navigation-menu" onKeyDown={event => {
    if (event.key === 'Escape') {
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus();
    }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }}>
    <summary className="gallery-action" aria-label="网站导航" title="Projects / Explore / Map"><Icon name="list-ordered" /></summary>
    {links}
  </details> : links;
}
