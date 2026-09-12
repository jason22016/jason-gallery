import { TablerAperture } from '../../viewer/CaptureIcons';
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  if (name === 'aperture') return <TablerAperture className={`gallery-capture-icon ${className}`} aria-hidden="true" />;
  return <i className={`gallery-icon i-mingcute-${name}-line ${className}`} aria-hidden="true" />;
}
