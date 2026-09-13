import type { ViewerPhoto } from '../../viewer/photos';
import { EllipsisWithTooltip } from '../ui/EllipsisWithTooltip';

export function MapPhotoList({ photos, selectedPhotoId, onOpen }: { photos: readonly ViewerPhoto[]; selectedPhotoId?: string | null; onOpen: (photo: ViewerPhoto) => void }) {
  return <ul className="map-photo-list">{photos.map(photo => <li key={photo.id}><button aria-current={photo.id === selectedPhotoId ? 'location' : undefined} onClick={() => onOpen(photo)}>
    <img src={photo.thumbnail} alt="" loading="lazy" decoding="async" /><span><EllipsisWithTooltip>{photo.title}</EllipsisWithTooltip>
      <small><EllipsisWithTooltip>{photo.location?.locationName || photo.location?.city || `${photo.location!.latitude.toFixed(3)}, ${photo.location!.longitude.toFixed(3)}`}</EllipsisWithTooltip></small>
    </span></button></li>)}</ul>;
}
