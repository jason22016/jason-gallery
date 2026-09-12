import type { LoadingState } from '../../lib/image-loader-manager';

const formatSize = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

export function LoadingIndicator({ loading, size, untracked = false }: { loading: LoadingState; size: number; untracked?: boolean }) {
  const total = loading.totalBytes && loading.totalBytes > 0 ? loading.totalBytes : Number.isFinite(size) && size > 0 ? size : undefined;
  const loaded = loading.loadedBytes ?? 0;
  const percent = untracked ? undefined : loading.loadingProgress === 100 ? 100 : total ? Math.min(99, Math.max(0, Math.floor(loaded / total * 100))) : undefined;
  const label = loading.isQueueWaiting ? '等待处理' : loading.isConverting ? '正在转换' : percent === 100 ? '正在显示' : '加载中';
  return <div className="viewer-status" role="status" aria-live="off">
    <span className="loading-dot" aria-hidden="true"/>
    <div className="viewer-loading-details">
      <div className="viewer-loading-heading"><strong>{label}</strong><span>{percent === undefined ? '—%' : `${percent}%`}</span></div>
      <div className="viewer-loading-bytes">{untracked ? '—' : formatSize(loaded)} / {total ? formatSize(total) : '总量未知'}</div>
    </div>
  </div>;
}
