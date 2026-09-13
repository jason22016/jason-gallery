import type { ViewerPhoto } from '../../viewer/photos';

export interface ClusterCandidate {
  clusterId: number;
  pointCount: number;
  coordinates: [number, number];
  firstDay: number;
  lastDay: number;
}
interface ClusterSource {
  getClusterLeaves(id: number, limit: number, offset: number): Promise<{ properties: { [key: string]: unknown } | null }[]>;
  getClusterExpansionZoom(id: number): Promise<number>;
}
export interface ClusterMarkerEntry extends ClusterCandidate {
  element: HTMLElement;
  marker: { setLngLat(coordinates: [number, number]): unknown; remove(): unknown };
  photos: readonly ViewerPhoto[];
  previewFailed: boolean;
}

export class ClusterMarkerRegistry {
  private entries = new Map<number, ClusterMarkerEntry>();
  private pending = new Map<ClusterMarkerEntry, Map<number, Promise<void>>>();
  private requestedCounts = new WeakMap<ClusterMarkerEntry, number>();
  private generation = 0;
  private expansionRequest = 0;

  constructor(
    private source: ClusterSource,
    private photos: () => ReadonlyMap<string, ViewerPhoto>,
    private create: (candidate: ClusterCandidate) => ClusterMarkerEntry,
    private onChange: (entries: ClusterMarkerEntry[]) => void,
    private easeTo: (options: { center: [number, number]; zoom: number }) => void,
    private onExpansionError: () => void,
  ) {}

  sync(candidates: readonly ClusterCandidate[]) {
    const desired = new Map(candidates.map(candidate => [candidate.clusterId, candidate]));
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (!desired.has(id)) {
        entry.marker.remove(); this.entries.delete(id); this.pending.delete(entry); changed = true;
      }
    }
    for (const [id, candidate] of desired) {
      let entry = this.entries.get(id);
      if (!entry) {
        entry = this.create(candidate); this.entries.set(id, entry); changed = true;
        void this.load(entry, 4);
      }
      if (entry.coordinates.some((coordinate, index) => coordinate !== candidate.coordinates[index])) {
        entry.marker.setLngLat(candidate.coordinates); entry.coordinates = candidate.coordinates;
      }
      if (entry.pointCount !== candidate.pointCount || entry.firstDay !== candidate.firstDay || entry.lastDay !== candidate.lastDay) {
        Object.assign(entry, candidate); changed = true;
      }
    }
    return changed ? [...this.entries.values()] : null;
  }

  load(entry: ClusterMarkerEntry, limit = 6): Promise<void> {
    const count = Math.min(limit, entry.pointCount);
    if (this.entries.get(entry.clusterId) !== entry || entry.photos.length >= count) return Promise.resolve();
    let requests = this.pending.get(entry);
    if (!requests) { requests = new Map(); this.pending.set(entry, requests); }
    for (const [requested, promise] of requests) if (requested >= count) return promise;
    this.requestedCounts.set(entry, Math.max(count, this.requestedCounts.get(entry) ?? 0));
    const generation = this.generation;
    const current = () => generation === this.generation && this.entries.get(entry.clusterId) === entry;
    const request = this.source.getClusterLeaves(entry.clusterId, count, 0).then(leaves => {
      if (!current()) return;
      const photos = this.photos();
      const result = leaves.flatMap(leaf => {
        const photo = photos.get(String(leaf.properties?.id));
        return photo ? [photo] : [];
      });
      if (result.length >= entry.photos.length) entry.photos = result;
      if (this.requestedCounts.get(entry) === count) entry.previewFailed = result.length !== count;
      this.onChange([...this.entries.values()]);
    }).catch(() => {
      if (!current() || this.requestedCounts.get(entry) !== count) return;
      entry.previewFailed = true; this.onChange([...this.entries.values()]);
    }).finally(() => {
      requests!.delete(count);
      if (!requests!.size && this.pending.get(entry) === requests) this.pending.delete(entry);
    });
    requests.set(count, request);
    return request;
  }

  async expand(entry: ClusterMarkerEntry) {
    if (this.entries.get(entry.clusterId) !== entry) return;
    const generation = this.generation, request = ++this.expansionRequest;
    const current = () => generation === this.generation && request === this.expansionRequest && this.entries.get(entry.clusterId) === entry;
    try {
      const zoom = await this.source.getClusterExpansionZoom(entry.clusterId);
      if (current()) this.easeTo({ center: entry.coordinates, zoom });
    } catch { if (current()) this.onExpansionError(); }
  }

  clear() {
    this.generation++; this.expansionRequest++;
    for (const entry of this.entries.values()) entry.marker.remove();
    this.entries.clear(); this.pending.clear();
  }
}
