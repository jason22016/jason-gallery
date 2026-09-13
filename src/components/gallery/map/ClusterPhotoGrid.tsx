import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { PhotoMarkerImage } from './PhotoMarkerImage';
import { Icon } from '../ui/Icon';
import { clusterCoordinates, clusterDateRange } from './cluster-preview';
import type { ClusterMarkerEntry } from './cluster-marker-registry';

export function ClusterPhotoGrid({ cluster, reduced }: { cluster: ClusterMarkerEntry; reduced: boolean }) {
  const displayPhotos = cluster.photos.slice(0, 6);
  const remainingCount = Math.max(0, cluster.pointCount - 6);
  const date = clusterDateRange(cluster.firstDay, cluster.lastDay);
  return <div className="cluster-photo-grid" data-preview-cluster={cluster.clusterId}>
    <header><h3>{cluster.pointCount} 张照片</h3><span>点击聚类放大</span></header>
    <div className="cluster-photo-grid-images">
      {displayPhotos.map((photo, index) => <m.div key={photo.id} className="cluster-photo-cell" data-cluster-photo={photo.id}
        initial={reduced ? false : { opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }}
        transition={reduced ? { duration: 0 } : { ...Spring.presets.smooth, delay: index * .05 }} role="img" aria-label={photo.title || photo.id}>
        <PhotoMarkerImage key={photo.thumbnail} photo={photo} />
      </m.div>)}
      {remainingCount > 0 && <m.div className="cluster-photo-more" data-cluster-remaining={remainingCount}
        initial={reduced ? false : { opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }}
        transition={reduced ? { duration: 0 } : { ...Spring.presets.smooth, delay: displayPhotos.length * .05 }}>
        <strong>+{remainingCount}</strong><span>更多照片</span>
      </m.div>}
    </div>
    {cluster.previewFailed && <p role="status">缩略图暂时不可用，仍可点击聚类放大。</p>}
    <div className="cluster-photo-metadata">
      <div><Icon name="map-pin" /><span className="cluster-photo-coordinates">{clusterCoordinates(cluster.coordinates)}</span></div>
      {date && <div data-cluster-date><Icon name="calendar" /><span>{date}</span></div>}
    </div>
  </div>;
}
