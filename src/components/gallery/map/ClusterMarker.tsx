import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { useState } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../viewer/HoverCard';
import { useReducedMotion } from '../ui/useReducedMotion';
import { ClusterPhotoGrid } from './ClusterPhotoGrid';
import { PhotoMarkerImage } from './PhotoMarkerImage';
import { clusterMarkerSize } from './cluster-preview';
import type { ClusterMarkerEntry } from './cluster-marker-registry';

export function ClusterMarker({ cluster, enableHover, onPreview, onExpand }: {
  cluster: ClusterMarkerEntry;
  enableHover: boolean;
  onPreview: () => void;
  onExpand: () => void;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const size = clusterMarkerSize(cluster.pointCount);
  return <HoverCard open={enableHover && open} openDelay={300} closeDelay={150} onOpenChange={next => {
    setOpen(next); if (next && enableHover) onPreview();
  }}>
    <HoverCardTrigger asChild><m.button type="button" className="cluster-marker" style={{ width: size, height: size }}
      aria-label={`${cluster.pointCount} 张照片，放大展开聚类`} data-point-count={cluster.pointCount}
      initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={reduced ? { duration: 0 } : Spring.presets.snappy}
      whileHover={reduced ? undefined : { scale: 1.05 }} whileFocus={reduced ? undefined : { scale: 1.05 }}
      whileTap={reduced ? undefined : { scale: .95 }} onClick={event => { event.stopPropagation(); setOpen(false); onExpand(); }}>
      <span className="cluster-marker-ring" aria-hidden="true" />
      <span className="cluster-marker-surface" aria-hidden="true">
        <span className="cluster-marker-mosaic">
          {cluster.photos.slice(0, 4).map(photo => <span className="cluster-marker-mosaic-cell" key={photo.id} data-mosaic-photo={photo.id}>
            <PhotoMarkerImage key={photo.thumbnail} photo={photo} />
          </span>)}
        </span>
        <span className="cluster-marker-wash" /><span className="cluster-marker-glass" />
        <strong className="cluster-marker-count">{cluster.pointCount}</strong><span className="cluster-marker-inner" />
      </span>
    </m.button></HoverCardTrigger>
    {enableHover && <HoverCardContent reducedMotion={reduced} className="photo-marker-card photo-marker-card-hover cluster-photo-card"
      side="top" align="center" sideOffset={8} collisionPadding={16} updatePositionStrategy="always" data-card-kind="cluster"
      onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
      <ClusterPhotoGrid cluster={cluster} reduced={reduced} />
    </HoverCardContent>}
  </HoverCard>;
}
