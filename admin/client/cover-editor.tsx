import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clamp, coverGeometry, coverImageStyle, DEFAULT_COVER_CROP, type CoverCrop } from '../../src/projects/cover';
import type { PreviewPhoto } from './model';
import { Thumbnail } from './thumbnail';

export function CoverPreview({ item, crop, className = '' }: { item: PreviewPhoto; crop?: CoverCrop; className?: string }) {
  const p = item.photo;
  return <div className={`cover-frame ${className}`}><Thumbnail src={p.thumbnailUrl} alt={`封面预览：${p.title}`} style={coverImageStyle(p.width, p.height, crop)} /></div>;
}

export function CoverEditor({ item, initial, apply, close }: { item: PreviewPhoto; initial?: CoverCrop; apply: (crop: CoverCrop) => void; close: () => void }) {
  const [crop, setCrop] = useState<CoverCrop>(() => ({ ...(initial ?? DEFAULT_COVER_CROP) }));
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const p = item.photo;
  const zoom = (value: number) => setCrop(c => ({ ...c, zoom: clamp(value, 1, 5) }));
  useEffect(() => {
    const node = frame.current;
    if (!node || !loaded) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientHeight : 1);
      setCrop(c => ({ ...c, zoom: clamp(c.zoom * Math.exp(-delta * 0.002), 1, 5) }));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [loaded]);
  const pan = (dx: number, dy: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    setCrop(c => {
      const g = coverGeometry(p.width, p.height, c);
      return { ...c, x: g.width > 1 ? clamp(c.x - dx / (box.width * (g.width - 1))) : c.x,
        y: g.height > 1 ? clamp(c.y - dy / (box.height * (g.height - 1))) : c.y };
    });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(e.pointerId);
    if (!previous) return;
    const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 0) setCrop(c => ({ ...c, zoom: clamp(c.zoom * after / before, 1, 5) }));
    } else pan(next.x - previous.x, next.y - previous.y);
  };
  return <div className="cover-editor">
    <p className="muted" id="cover-instructions">封面比例固定为 5:6。拖动图片调整位置，用滑杆、滚轮或双指缩放。方向键也可移动图片。</p>
    <div ref={frame} className="cover-frame cover-crop-area" tabIndex={0} role="group" aria-label="封面裁剪区域" aria-describedby="cover-instructions"
      onPointerDown={e => { if (!loaded || e.button !== 0) return; e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
      onPointerMove={move} onPointerUp={e => pointers.current.delete(e.pointerId)} onPointerCancel={e => pointers.current.delete(e.pointerId)} onLostPointerCapture={e => pointers.current.delete(e.pointerId)}
      onKeyDown={e => {
        if (!loaded) return;
        const keys: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
        if (keys[e.key]) { e.preventDefault(); pan(...keys[e.key]); }
      }}>
      <Thumbnail src={p.thumbnailUrl} alt={p.title} loading="eager" onLoad={() => setLoaded(true)} style={coverImageStyle(p.width, p.height, crop)} />
      <div className="cover-grid" aria-hidden="true" />
    </div>
    {!loaded && <p className="muted" role="status">正在加载封面图片；加载失败时请重试缩略图。</p>}
    <div className="cover-zoom"><button className="secondary" aria-label="缩小封面图片" disabled={!loaded || crop.zoom <= 1} onClick={() => zoom(crop.zoom - 0.1)}>−</button>
      <label>缩放<input aria-label="封面缩放" type="range" min="1" max="5" step="0.01" value={crop.zoom} disabled={!loaded} onChange={e => zoom(Number(e.target.value))} /></label>
      <button className="secondary" aria-label="放大封面图片" disabled={!loaded || crop.zoom >= 5} onClick={() => zoom(crop.zoom + 0.1)}>+</button><output>{Math.round(crop.zoom * 100)}%</output>
    </div>
    <div className="dialog-actions"><button className="text-button" onClick={() => setCrop({ ...DEFAULT_COVER_CROP })}>重置位置与缩放</button><button className="secondary" onClick={close}>取消</button><button className="primary" disabled={!loaded} onClick={() => apply(crop)}>应用封面裁剪</button></div>
    <p className="muted">应用后请保存 Project，发布网站后封面会更新。</p>
  </div>;
}
