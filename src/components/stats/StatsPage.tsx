import { Spring } from '@afilmory/utils';
import { animate, domMax, LazyMotion, m, MotionConfig, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PhotographyStats, PhotographyStatsScope } from '../../statistics';
import type { PhotographyStatsPageData } from '../../website/photography-stats';
import { SiteNavigation } from '../SiteNavigation';
import Panel from '../gallery/Panel';
import { PageHeaderFrame } from '../gallery/PageHeader';
import { globalGalleryHref } from '../gallery/url-state';
import { Icon } from '../gallery/ui/Icon';
import { LinearDivider } from '../gallery/ui/LinearDivider';
import { useReducedMotion } from '../gallery/ui/useReducedMotion';
import { FocalLengthChart } from './FocalLengthChart';
import { DistributionBars, ProportionBar, RankedBars, TimelineChart, TimeOfDayChart } from './StatsVisualizations';
import { statsFocalIntervalFromSearch, statsFocalIntervalURL, statsGalleryState, statsPeriodURL, statsResultFromSearch, statsScopeURL } from './url-state';
import './StatsPage.css';

const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  window.addEventListener('stats-url-change', notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener('stats-url-change', notify);
  };
};
const currentSearch = () => window.location.search;
const serverSearch = () => null;
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const exposureNumber = new Intl.NumberFormat('en', { maximumSignificantDigits: 5, useGrouping: false });
const dateLabel = (date: string | null) => date ? date.slice(0, 10).replaceAll('-', ' / ') : 'Not recorded';
const mediaLabels = { hdr: 'HDR', sdr: 'SDR', 'live-photo': 'Live Photo', 'motion-photo': 'Motion Photo', still: 'Still', landscape: 'Landscape', portrait: 'Portrait', square: 'Square' };
const shutterLabel = (seconds: number) => seconds < 1 && Number.isFinite(1 / seconds) ? `1/${exposureNumber.format(1 / seconds)} s` : `${exposureNumber.format(seconds)} s`;
const apertureLabel = (value: number) => `ƒ/${number.format(value)}`;
const isoLabel = (value: number) => `ISO ${integer.format(value)}`;
const hourLabel = (value: number) => `${String(value).padStart(2, '0')}:00`;
const mediaLabel = (value: keyof typeof mediaLabels) => mediaLabels[value];

function writeURL(url: URL) {
  if (url.href === location.href) return;
  history.pushState(history.state, '', url);
  window.dispatchEvent(new Event('stats-url-change'));
}

function AnimatedCount({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const count = useMotionValue(value);
  const label = useTransform(count, latest => integer.format(Math.round(latest)));
  useEffect(() => {
    if (reduced) { count.set(value); return; }
    const animation = animate(count, value, Spring.presets.smooth);
    return () => animation.stop();
  }, [count, reduced, value]);
  return <span><span className="sr-only">{integer.format(value)}</span><m.span aria-hidden="true">{label}</m.span></span>;
}

function Overview({ stats, mapHref }: { stats: PhotographyStats; mapHref: string }) {
  return <section className="stats-overview" aria-labelledby="overview-heading">
    <h2 id="overview-heading" className="stats-eyebrow">Overview</h2>
    <dl className="stats-overview-values">
      <div><dt>Photos</dt><dd data-stat="photos" data-value={stats.photoCount}><AnimatedCount value={stats.photoCount} /></dd><dd className="stats-overview-caption">Unique photographs</dd></div>
      <div><dt>Projects</dt><dd data-stat="projects" data-value={stats.projectCount}><AnimatedCount value={stats.projectCount} /></dd><dd className="stats-overview-caption">Published projects</dd></div>
      <div><dt>Geotagged</dt><dd data-stat="geotagged" data-value={stats.geotagged.count}><AnimatedCount value={stats.geotagged.count} /></dd><dd className="stats-overview-caption">{number.format(stats.geotagged.percentage)}% of photographs</dd><dd className="stats-overview-caption"><a className="stats-context-link stats-map-link" href={mapHref}>View on Map <Icon name="arrow-right" /></a></dd></div>
      <div className="stats-date-range"><dt>Date Range</dt><dd data-stat="date-range" data-value={`${stats.captureDateRange.start ?? ''}/${stats.captureDateRange.end ?? ''}`}>
        <span>{dateLabel(stats.captureDateRange.start)}</span>{stats.captureDateRange.end && <><span className="stats-date-to">to</span><span>{dateLabel(stats.captureDateRange.end)}</span></>}
      </dd><dd className="stats-overview-caption">{stats.captureDateRange.missingCount ? `${integer.format(stats.captureDateRange.missingCount)} without a capture date` : 'Recorded capture dates'}</dd></div>
    </dl>
  </section>;
}

function ScopeOptions({ data, selected, onChange, onSelect }: { data: PhotographyStatsPageData; selected: PhotographyStatsScope | undefined; onChange: (scope: PhotographyStatsScope) => void; onSelect: (scope: PhotographyStatsScope) => void }) {
  const options = [data.all, ...data.projects];
  return <div className="stats-scope-options sort-options" role="radiogroup" aria-label="Statistics scope">
    {options.map((result, index) => {
      const key = result.scope.type === 'project' ? `project:${result.scope.slug}` : 'all';
      const active = selected?.type === result.scope.type && (selected?.type === 'all' || (result.scope.type === 'project' && selected?.slug === result.scope.slug));
      return <button type="button" role="radio" aria-checked={active} tabIndex={active || (!selected && index === 0) ? 0 : -1} key={key}
        onClick={() => onSelect(result.scope)} onKeyDown={event => {
          const delta = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
          if (!delta && !['Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + delta + options.length) % options.length;
          onChange(options[next]!.scope);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
        }}>
        <span>{result.project?.title ?? 'All Photos'}</span><small aria-hidden="true">{integer.format(result.stats.photoCount)}</small>{active && <Icon name="check" className="selected-check" />}
      </button>;
    })}
  </div>;
}

export default function StatsPage({ data }: { data: PhotographyStatsPageData }) {
  const search = useSyncExternalStore(subscribe, currentSearch, serverSearch);
  const result = search === null ? undefined : statsResultFromSearch(search, data);
  const scope = result?.project?.slug ?? (result ? 'all' : 'unavailable');
  const period = new URLSearchParams(search ?? '').get('period') === 'year' ? 'year' : 'month';
  const focalInterval = statsFocalIntervalFromSearch(search ?? '');
  const [panel, setPanel] = useState(false);
  const [panelRequest, setPanelRequest] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const stats = result?.stats;
  const galleryState = useMemo(() => result ? statsGalleryState(result) : undefined, [result]);
  return <LazyMotion features={domMax}><MotionConfig reducedMotion={reduced ? 'always' : 'never'}><div className="stats-page" data-stats-ready={search !== null} data-stats-scope={scope} data-reduced-motion={reduced}>
    <PageHeaderFrame>
      <div className="gallery-heading"><SiteNavigation current="stats" state={galleryState} compact /><a className="stats-home" href="/">Jason Gallery</a></div><span className="stats-header-label">Photography Stats</span>
    </PageHeaderFrame>
    <div className="stats-content">
      <header className="stats-intro">
        <p className="stats-eyebrow">A photographic record</p>
        <h1>Photography Stats</h1>
        <p className="stats-intro-description">The cameras, the light, the hours.<br />A different way to look at the photographs.</p>
        <div className="stats-scope-line"><span className="stats-eyebrow">Scope</span><button ref={anchor} className="stats-scope-trigger" type="button" aria-label="Statistics scope" aria-haspopup="dialog" aria-expanded={panel} disabled={search === null} onClick={() => { setPanelRequest(request => request + 1); setPanel(true); }}>
          <span>{search === null ? 'Reading statistics…' : result?.project?.title ?? (result ? 'All Photos' : 'Project unavailable')}</span><Icon name="down" />
        </button></div>
        <p className="sr-only" role="status">{search !== null && (result ? `${result.project?.title ?? 'All Photos'}: ${stats!.photoCount} photos` : 'Project unavailable')}</p>
      </header>
      {search === null ? <p className="stats-state" role="status">Reading statistics…</p> : !stats ? <section className="stats-state" aria-labelledby="stats-unavailable"><h2 id="stats-unavailable">Project unavailable</h2><p>This link does not identify a published project. Choose a scope to continue.</p><button type="button" onClick={() => writeURL(statsScopeURL(new URL(location.href), data.all.scope))}>All Photos</button></section> : <>
        <Overview stats={stats} mapHref={globalGalleryHref('map', galleryState)} />
        {!stats.photoCount && <p className="stats-empty-collection" role="status"><span>No published photos yet</span>. Statistics will appear when photographs are published.</p>}
        <LinearDivider />
        <section className="stats-section" aria-labelledby="equipment-heading"><header className="stats-section-heading"><span className="stats-eyebrow">01 / Equipment</span><h2 id="equipment-heading">Cameras &amp; Lenses</h2></header><div className="stats-two-column">
          <RankedBars id="cameras" title="Cameras" distribution={stats.cameras} exploreHrefs={result!.explore.cameras} />
          <RankedBars id="lenses" title="Lenses" distribution={stats.lenses} exploreHrefs={result!.explore.lenses} />
        </div></section>
        <LinearDivider />
        <section className="stats-section" aria-labelledby="focal-heading"><header className="stats-section-heading"><span className="stats-eyebrow">02 / Perspective</span><h2 id="focal-heading">Focal Length</h2><p>As shown in the gallery: 35mm equivalent where recorded, otherwise the recorded focal length.</p></header>
          <FocalLengthChart distribution={stats.focalLength} interval={focalInterval} onIntervalChange={next => writeURL(statsFocalIntervalURL(new URL(location.href), next))} />
        </section>
        <LinearDivider />
        <section className="stats-section" aria-labelledby="exposure-heading"><header className="stats-section-heading"><span className="stats-eyebrow">03 / Light</span><h2 id="exposure-heading">Exposure</h2></header><div className="stats-three-column">
          <DistributionBars id="aperture" title="Aperture" distribution={stats.aperture} formatValue={apertureLabel} />
          <DistributionBars id="iso" title="ISO" distribution={stats.iso} formatValue={isoLabel} />
          <DistributionBars id="shutter-speed" title="Shutter Speed" distribution={stats.shutterSpeed} formatValue={shutterLabel} />
        </div></section>
        <LinearDivider />
        <section className="stats-section" aria-labelledby="when-heading"><header className="stats-section-heading"><span className="stats-eyebrow">04 / Rhythm</span><h2 id="when-heading">When</h2><p>Capture dates and hours, as recorded by the camera.</p></header>
          <div className="stats-period-control" role="group" aria-label="Timeline interval">{(['month', 'year'] as const).map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => writeURL(statsPeriodURL(new URL(location.href), value))}>{value === 'month' ? 'Month' : 'Year'}</button>)}</div>
          {period === 'month' ? <TimelineChart id="timeline" title="By month" distribution={stats.months} /> : <TimelineChart id="timeline" title="By year" distribution={stats.years} />}
          <TimeOfDayChart id="shooting-hours" title="Time of Day" distribution={stats.shootingHours} formatValue={hourLabel} />
        </section>
        <LinearDivider />
        <section className="stats-section" aria-labelledby="media-heading"><header className="stats-section-heading"><span className="stats-eyebrow">05 / Format</span><h2 id="media-heading">Media</h2></header><div className="stats-three-column">
          <ProportionBar id="dynamic-range" title="HDR / SDR" distribution={stats.dynamicRange} formatValue={mediaLabel} />
          <ProportionBar id="media" title="Live / Motion Photo" distribution={stats.media} formatValue={mediaLabel} />
          <ProportionBar id="orientation" title="Landscape / Portrait" distribution={stats.orientation} formatValue={mediaLabel} />
        </div></section>
        <LinearDivider /><footer className="stats-footer"><p>Each photograph counts once within its scope. Distributions use photographs with recorded metadata; missing values are shown separately.</p><span>Jason Gallery</span></footer>
      </>}
    </div>
    {panel && <Panel key={panelRequest} title="Statistics scope" kind="settings" anchor={anchor.current} onClose={() => setPanel(false)}><ScopeOptions data={data} selected={result?.scope} onChange={next => writeURL(statsScopeURL(new URL(location.href), next))} onSelect={next => { writeURL(statsScopeURL(new URL(location.href), next)); setPanel(false); }} /></Panel>}
  </div></MotionConfig></LazyMotion>;
}
