import type { ViewerPhoto } from '../../viewer/photos';

export interface MarkerCandidate { photo: ViewerPhoto; coordinates: [number, number] }
interface NativeMarker {
  setLngLat(coordinates: [number, number]): unknown;
  remove(): unknown;
}
export interface PhotoMarkerEntry {
  photo: ViewerPhoto;
  element: HTMLElement;
  marker: NativeMarker;
  coordinates: [number, number];
}

export class PhotoMarkerRegistry {
  private entries = new Map<string, PhotoMarkerEntry>();
  constructor(private create: (candidate: MarkerCandidate) => PhotoMarkerEntry) {}

  sync(candidates: readonly MarkerCandidate[], selectedId: string | null) {
    const desired = new Map(candidates.map(candidate => [candidate.photo.id, candidate]));
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (!desired.has(id)) { entry.marker.remove(); this.entries.delete(id); changed = true; }
    }
    for (const [id, candidate] of desired) {
      let entry = this.entries.get(id);
      if (!entry) { entry = this.create(candidate); this.entries.set(id, entry); changed = true; }
      if (entry.photo !== candidate.photo) { entry.photo = candidate.photo; changed = true; }
      if (entry.coordinates.some((coordinate, index) => coordinate !== candidate.coordinates[index])) {
        entry.marker.setLngLat(candidate.coordinates);
        entry.coordinates = candidate.coordinates;
      }
      const selected = String(id === selectedId);
      if (entry.element.dataset.selected !== selected) entry.element.dataset.selected = selected;
    }
    return changed ? [...this.entries.values()] : null;
  }

  values() { return this.entries.values(); }

  clear() {
    for (const entry of this.entries.values()) entry.marker.remove();
    this.entries.clear();
  }
}
