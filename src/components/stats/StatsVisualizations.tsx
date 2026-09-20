import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { StatsBucket, StatsDistribution } from '../../statistics/types';
import { Icon } from '../gallery/ui/Icon';
import { useReducedMotion } from '../gallery/ui/useReducedMotion';
import './StatsVisualizations.css';

export interface StatsVisualizationProps<T extends string | number> {
  id: string;
  title: string;
  distribution: StatsDistribution<T>;
  formatValue?: (value: T) => string;
  formatTick?: (value: T) => string;
  description?: string;
  emptyLabel?: string;
  onSelectionChange?: (bucket: StatsBucket<T> | null) => void;
  exploreHrefs?: Readonly<Record<string, string>>;
}

type Visualization = 'ranked' | 'distribution' | 'timeline' | 'time-of-day' | 'proportion';

const finiteCount = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const finitePercentage = (value: number) => Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
const countText = (value: number) => finiteCount(value).toLocaleString('en-US');
const percentText = (value: number) => `${finitePercentage(value).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
const keyFor = (value: string | number) => `${typeof value}:${value}`;
const calendarIndex = (value: string | number) => typeof value === 'number'
  ? Number.isInteger(value) ? value : NaN
  : /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1 : NaN;

function StatsChartView<T extends string | number>({
  id, title, distribution, formatValue = String, formatTick = formatValue, description, emptyLabel, onSelectionChange, exploreHrefs, variant,
}: StatsVisualizationProps<T> & { variant: Visualization }) {
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const selectionChange = useRef(onSelectionChange);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const buckets = useMemo(() => variant === 'ranked'
    ? [...distribution.buckets].sort((a, b) => finiteCount(b.count) - finiteCount(a.count))
    : distribution.buckets, [distribution, variant]);
  const activeKey = hovered ?? focused ?? selected;
  const active = buckets.find(bucket => keyFor(bucket.value) === activeKey);
  const retained = exploreHrefs ? buckets.find(bucket => keyFor(bucket.value) === inspected) : undefined;
  const detail = active ?? retained ?? distribution.mostUsed;
  const exploreHref = detail && exploreHrefs && Object.hasOwn(exploreHrefs, String(detail.value)) ? exploreHrefs[String(detail.value)] : undefined;
  const maxCount = finiteCount(distribution.mostUsed?.count ?? 0) || 1;
  const sampleCount = finiteCount(distribution.sampleCount);
  const missingCount = finiteCount(distribution.missingCount);
  const transition = reduced ? { duration: 0 } : Spring.presets.smooth;
  const vertical = variant === 'distribution' || variant === 'timeline' || variant === 'time-of-day';
  const calendarPositions = useMemo(() => variant === 'timeline' ? buckets.map(bucket => calendarIndex(bucket.value)) : [], [buckets, variant]);
  const calendarStart = calendarPositions[0] ?? 0;
  const calendarSpan = (calendarPositions.at(-1) ?? 0) - calendarStart + 1;
  const calendarSpacing = variant === 'timeline' && calendarPositions.every(Number.isFinite) && calendarSpan > 0 && calendarSpan <= 120;
  const columnCount = calendarSpacing ? calendarSpan : buckets.length;
  const missingPeriodLabel = (index: number) => typeof buckets[0]?.value === 'number'
    ? String(calendarStart + index)
    : `${String(Math.floor((calendarStart + index) / 12)).padStart(4, '0')}-${String((calendarStart + index) % 12 + 1).padStart(2, '0')}`;

  useEffect(() => { selectionChange.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => {
    setSelected(null);
    setHovered(null);
    setFocused(null);
    setInspected(null);
    selectionChange.current?.(null);
  }, [distribution]);

  const clear = () => {
    setSelected(null);
    setHovered(null);
    setFocused(null);
    setInspected(null);
    onSelectionChange?.(null);
  };
  const select = (bucket: StatsBucket<T>) => {
    const key = keyFor(bucket.value);
    const next = selected === key ? null : key;
    setSelected(next);
    setHovered(null);
    if (exploreHrefs) setInspected(next);
    onSelectionChange?.(next ? bucket : null);
  };
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = steps[event.key];
    if (step === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buckets.length - 1 : (index + step + buckets.length) % buckets.length;
    root.current?.querySelectorAll<HTMLButtonElement>('[data-stats-value]')[next]?.focus({ preventScroll: true });
    root.current?.querySelectorAll<HTMLButtonElement>('[data-stats-value]')[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  };

  const renderBucket = (bucket: StatsBucket<T>, index: number) => {
    const key = keyFor(bucket.value);
    const label = formatValue(bucket.value);
    const count = finiteCount(bucket.count);
    const percentage = finitePercentage(bucket.percentage);
    const pressed = selected === key;
    const height = Math.min(100, count / maxCount * 100);
    const style: CSSProperties | undefined = variant === 'time-of-day'
      ? { gridColumn: Math.min(24, Math.max(1, Number(bucket.value) + 1)), gridRow: 1 }
      : calendarSpacing ? { gridColumn: calendarIndex(bucket.value) - calendarStart + 1, gridRow: 1 } : undefined;
    return <m.button
      type="button"
      className={`stats-chart-bucket stats-chart-bucket-${variant}`}
      key={key}
      style={style}
      layout={!reduced && variant === 'ranked' ? 'position' : false}
      transition={transition}
      data-stats-value={String(bucket.value)}
      data-stats-count={count}
      data-stats-percentage={percentage}
      data-highlighted={activeKey === key || undefined}
      aria-label={`${label}: ${countText(count)} ${count === 1 ? 'photo' : 'photos'}, ${percentText(percentage)} of recorded data`}
      aria-describedby={activeKey === key ? `${id}-detail` : undefined}
      aria-pressed={pressed}
      onPointerEnter={event => { if (event.pointerType !== 'touch') { setHovered(key); if (exploreHrefs) setInspected(key); } }}
      onFocus={() => { setFocused(key); if (exploreHrefs) setInspected(key); }}
      onClick={() => select(bucket)}
      onKeyDown={event => navigate(event, index)}
    >
      {variant === 'ranked' && <span className="stats-ranked-label">{label}</span>}
      {variant !== 'proportion' && <span className="stats-chart-count">{countText(count)}</span>}
      {variant !== 'proportion' && <span className="stats-chart-track" aria-hidden="true">
        <m.span
          className="stats-chart-fill"
          initial={false}
          animate={vertical ? { scaleY: height / 100 } : { scaleX: height / 100 }}
          transition={transition}
        />
      </span>}
      {variant !== 'ranked' && <span className="stats-chart-value">{formatTick(bucket.value)}</span>}
      {variant === 'ranked' && <span className="stats-ranked-percentage">{percentText(percentage)}</span>}
      {variant === 'proportion' && <span className="stats-proportion-count">{countText(count)} · {percentText(percentage)}</span>}
    </m.button>;
  };

  return <section
    ref={root}
    className={`stats-chart stats-chart-${variant}`}
    data-stats-chart={id}
    data-stats-visualization={variant}
    data-stats-samples={sampleCount}
    data-stats-missing={missingCount}
    data-reduced-motion={reduced}
    data-timeline-spacing={variant === 'timeline' ? calendarSpacing ? 'calendar' : 'recorded' : undefined}
    aria-labelledby={`${id}-title`}
    onPointerLeave={() => setHovered(null)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); clear(); } }}
  >
    <header className="stats-chart-heading">
      <h3 id={`${id}-title`}>{title}</h3>
      {description && <p>{description}</p>}
    </header>
    {buckets.length && sampleCount > 0 ? <>
      {variant === 'proportion' && <div className="stats-proportion-strip">
        {buckets.map((bucket, index) => <m.button
          key={keyFor(bucket.value)}
          className="stats-proportion-segment"
          type="button"
          tabIndex={-1}
          aria-label={`Select ${formatValue(bucket.value)}: ${countText(bucket.count)} photos, ${percentText(bucket.percentage)}`}
          aria-pressed={selected === keyFor(bucket.value)}
          aria-describedby={activeKey === keyFor(bucket.value) ? `${id}-detail` : undefined}
          data-stats-segment={String(bucket.value)}
          data-segment-index={index}
          data-selected={selected === keyFor(bucket.value) || undefined}
          data-highlighted={activeKey === keyFor(bucket.value) || undefined}
          initial={false}
          animate={{ width: `${finitePercentage(bucket.percentage)}%` }}
          transition={transition}
          onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(keyFor(bucket.value)); }}
          onFocus={() => setFocused(keyFor(bucket.value))}
          onClick={() => select(bucket)}
          onKeyDown={event => navigate(event, index)}
        ><span /></m.button>)}
      </div>}
      <div className="stats-chart-scroll">
        <div className="stats-chart-plot" style={vertical && variant !== 'time-of-day' ? { gridTemplateColumns: `repeat(${columnCount}, minmax(44px, 1fr))` } : undefined}>
          {variant === 'time-of-day' && Array.from({ length: 24 }, (_, hour) => distribution.buckets.some(bucket => Number(bucket.value) === hour) ? null : <span
            key={`hour-${hour}`}
            className="stats-hour-guide"
            aria-hidden="true"
            style={{ gridColumn: hour + 1, gridRow: 1 }}
          ><span className="stats-hour-guide-track" /><span>{String(hour).padStart(2, '0')}</span></span>)}
          {calendarSpacing && Array.from({ length: calendarSpan }, (_, index) => calendarPositions.includes(calendarStart + index) ? null : <span
            key={`period-${index}`}
            className="stats-period-guide"
            aria-hidden="true"
            style={{ gridColumn: index + 1, gridRow: 1 }}
          ><span className="stats-period-guide-track" /><span>{missingPeriodLabel(index)}</span></span>)}
          {buckets.map(renderBucket)}
        </div>
      </div>
      {variant === 'timeline' && !calendarSpacing && <p className="stats-timeline-spacing">Recorded periods only; gaps are omitted.</p>}
      <div className="stats-chart-detail-surface">
        <div
          id={`${id}-detail`}
          className="stats-chart-detail"
          role={active ? 'tooltip' : 'status'}
          aria-live={active ? 'off' : 'polite'}
          data-selected={active !== undefined && selected === keyFor(active.value) || undefined}
        >
          {detail && <>
            <span className="stats-detail-value">{formatValue(detail.value)}</span>
            <span className="stats-detail-count">{countText(detail.count)} {detail.count === 1 ? 'photo' : 'photos'} <span>· {percentText(detail.percentage)} of recorded data</span></span>
            <span className="stats-detail-hint">{selected === keyFor(detail.value) ? 'Selected · tap again or press Escape to clear' : active ? 'Tap or press Enter to keep this detail' : retained ? 'Last viewed · select a value for details' : 'Most used · select a value for details'}</span>
          </>}
        </div>
        {detail && exploreHref && <a
          className="stats-context-link stats-explore-link"
          href={exploreHref}
          aria-label={`Explore ${formatValue(detail.value)} photos`}
          onFocus={() => setFocused(keyFor(detail.value))}
        >View in Explore <Icon name="arrow-right" /></a>}
      </div>
    </> : <p className="stats-chart-empty" data-stats-empty>
      {sampleCount + missingCount === 0 ? 'No photos in this scope yet.' : emptyLabel ?? `No recorded ${title.toLowerCase()} data.`}
    </p>}
    <p className="stats-chart-coverage">
      <span>{countText(sampleCount)} {sampleCount === 1 ? 'photo' : 'photos'} with data</span>
      <span>{percentText(distribution.coveragePercentage)} coverage</span>
      {missingCount > 0 && <span>{countText(missingCount)} missing</span>}
    </p>
  </section>;
}

const StatsChart = memo(StatsChartView) as typeof StatsChartView;

export function RankedBars<T extends string | number>(props: StatsVisualizationProps<T>) {
  return <StatsChart {...props} variant="ranked" />;
}

export function DistributionBars<T extends string | number>(props: StatsVisualizationProps<T>) {
  return <StatsChart {...props} variant="distribution" />;
}

export function TimelineChart<T extends string | number>(props: StatsVisualizationProps<T>) {
  return <StatsChart {...props} variant="timeline" />;
}

export function TimeOfDayChart(props: StatsVisualizationProps<number>) {
  return <StatsChart {...props} formatValue={props.formatValue ?? (hour => `${String(hour).padStart(2, '0')}:00`)} variant="time-of-day" />;
}

export function ProportionBar<T extends string | number>(props: StatsVisualizationProps<T>) {
  return <StatsChart {...props} variant="proportion" />;
}
