import { useEffect, useMemo, useState } from 'react';
import type { StatsDistribution } from '../../statistics/types';
import { FOCAL_INTERVAL_PRESETS, groupFocalLengths, MAX_FOCAL_INTERVAL, validFocalInterval } from './focal-length';
import { DistributionBars } from './StatsVisualizations';

const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

export function FocalLengthChart({ distribution, interval, onIntervalChange }: {
  distribution: StatsDistribution<number>;
  interval: number;
  onIntervalChange: (interval: number) => void;
}) {
  const [draft, setDraft] = useState(String(interval));
  const grouped = useMemo(() => groupFocalLengths(distribution, interval), [distribution, interval]);
  const labels = useMemo(() => ({
    value: (start: number) => start + interval > start && Number.isFinite(start + interval)
      ? `${number.format(start)}–<${number.format(start + interval)} mm` : `${number.format(start)} mm`,
    tick: (start: number) => start + interval > start && Number.isFinite(start + interval)
      ? `${number.format(start)}–${number.format(start + interval)}` : number.format(start),
  }), [interval]);
  useEffect(() => setDraft(String(interval)), [interval]);

  const apply = (next: number) => {
    if (!validFocalInterval(next)) return;
    setDraft(String(next));
    onIntervalChange(next);
  };

  return <div className="stats-focal-length">
    <div className="stats-focal-controls">
      <span className="stats-eyebrow">Interval</span>
      <div className="stats-period-control stats-focal-presets" role="group" aria-label="Focal length interval">
        {FOCAL_INTERVAL_PRESETS.map(value => <button key={value} type="button" aria-pressed={interval === value} onClick={() => apply(value)}>{value} mm</button>)}
      </div>
      <form className="stats-focal-custom" onSubmit={event => { event.preventDefault(); apply(Number(draft)); }}>
        <label htmlFor="focal-interval-custom">Custom</label>
        <div className="stats-focal-input">
          <input id="focal-interval-custom" type="number" inputMode="numeric" min={1} max={MAX_FOCAL_INTERVAL} step={1} required
            aria-label="Custom focal length interval (mm)" value={draft} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') setDraft(String(interval)); }} />
          <span aria-hidden="true">mm</span>
        </div>
        <button type="submit">Apply</button>
      </form>
    </div>
    <DistributionBars id="focal-length" title="Focal length distribution" distribution={grouped} formatValue={labels.value} formatTick={labels.tick}
      description={`${interval} mm intervals · upper bounds excluded. Only ranges with photos are shown.`} />
  </div>;
}
