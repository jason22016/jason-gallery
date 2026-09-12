// Afilmory/Afilmory, apps/web/src/modules/metadata/HistogramChart.tsx
// 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4. See THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { Spring } from '@afilmory/utils';

export const BIN_COUNT = 128

const CHANNELS = ['red', 'green', 'blue', 'luminance'] as const

type Channel = (typeof CHANNELS)[number]

type HistogramBins = Record<Channel, number[]>

const CHANNEL_RGB: Record<Channel, string> = {
  red: '255, 105, 97',
  green: '52, 199, 89',
  blue: '64, 156, 255',
  luminance: '255, 255, 255',
}

const CHANNEL_ALPHA: Record<Channel, number> = {
  red: 0.7,
  green: 0.7,
  blue: 0.7,
  luminance: 0.3,
}

export const calculateHistogram = (imageData: ImageData): HistogramBins => {
  const bins: HistogramBins = {
    red: Array.from({ length: BIN_COUNT }).fill(0) as number[],
    green: Array.from({ length: BIN_COUNT }).fill(0) as number[],
    blue: Array.from({ length: BIN_COUNT }).fill(0) as number[],
    luminance: Array.from({ length: BIN_COUNT }).fill(0) as number[],
  }

  const { data } = imageData
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    bins.red[r >> 1]++
    bins.green[g >> 1]++
    bins.blue[b >> 1]++
    const luminance = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    bins.luminance[luminance >> 1]++
  }

  return bins
}

const createRenderer = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  const width = canvas.clientWidth, height = canvas.clientHeight
  if (!width || !height) return null
  const tokens = getComputedStyle(canvas)
  const dpr = window.devicePixelRatio || 1

  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)

  // 1px-wide gradient strips, stretched per bar via drawImage — avoids
  // creating a gradient per bar per animation frame
  const strips = {} as Record<Channel, HTMLCanvasElement>
  for (const channel of CHANNELS) {
    const strip = document.createElement('canvas')
    strip.width = 1
    strip.height = Math.max(1, Math.round(height * dpr))
    const stripCtx = strip.getContext('2d')
    if (!stripCtx) {
      return null
    }
    const alpha = CHANNEL_ALPHA[channel]
    const gradient = stripCtx.createLinearGradient(0, 0, 0, strip.height)
    gradient.addColorStop(0, `rgba(${CHANNEL_RGB[channel]}, ${alpha})`)
    gradient.addColorStop(1, `rgba(${CHANNEL_RGB[channel]}, ${alpha * 0.1})`)
    stripCtx.fillStyle = gradient
    stripCtx.fillRect(0, 0, 1, strip.height)
    strips[channel] = strip
  }

  const highlightGradient = ctx.createLinearGradient(0, 0, 0, height * 0.2)
  highlightGradient.addColorStop(0, tokens.getPropertyValue('--viewer-histogram-highlight').trim())
  highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

  return (histogram: HistogramBins) => {
    ctx.clearRect(0, 0, width, height)

    ctx.fillStyle = tokens.getPropertyValue('--color-material-ultra-thin').trim()
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = tokens.getPropertyValue('--viewer-histogram-grid').trim()
    ctx.lineWidth = 0.5
    for (let i = 1; i <= 3; i++) {
      const y = (height / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    const maxVal = Math.max(...histogram.luminance, ...histogram.red, ...histogram.green, ...histogram.blue)

    if (maxVal > 0) {
      const barWidth = width / BIN_COUNT
      const drawBars = (data: number[], strip: HTMLCanvasElement) => {
        for (const [i, datum] of data.entries()) {
          const barHeight = (datum / maxVal) * height
          if (barHeight <= 0) {
            continue
          }
          ctx.drawImage(strip, i * barWidth, height - barHeight, barWidth * 0.8, barHeight)
        }
      }

      drawBars(histogram.luminance, strips.luminance)

      ctx.globalCompositeOperation = 'screen'
      drawBars(histogram.red, strips.red)
      drawBars(histogram.green, strips.green)
      drawBars(histogram.blue, strips.blue)
      ctx.globalCompositeOperation = 'source-over'
    }

    ctx.strokeStyle = tokens.getPropertyValue('--color-fill-secondary').trim()
    ctx.lineWidth = 1
    ctx.strokeRect(-0.5, -0.5, width + 1, height + 1)

    ctx.fillStyle = highlightGradient
    ctx.fillRect(0, 0, width, height * 0.2)
  }
}

export function HistogramChart({ thumbnailUrl }: { thumbnailUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentBins = useRef<HistogramBins | null>(null);
  const drawRef = useRef<ReturnType<typeof createRenderer>>(null);
  const [histogram, setHistogram] = useState<HistogramBins | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const reduced = useReducedMotion();

  useEffect(() => {
    let active = true;
    setStatus('loading');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!active) return;
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas unavailable');
        const maxSize = 300;
        const scale = Math.min(1, maxSize / img.naturalWidth, maxSize / img.naturalHeight);
        const width = Math.max(1, Math.floor(img.naturalWidth * scale));
        const height = Math.max(1, Math.floor(img.naturalHeight * scale));
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        setHistogram(calculateHistogram(ctx.getImageData(0, 0, width, height)));
        setStatus('ready');
      } catch { setStatus('error'); }
    };
    img.onerror = () => { if (active) setStatus('error'); };
    img.src = thumbnailUrl;
    return () => { active = false; img.onload = null; img.onerror = null; };
  }, [thumbnailUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      drawRef.current = createRenderer(canvas);
      if (currentBins.current) drawRef.current?.(currentBins.current);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => { observer.disconnect(); drawRef.current = null; };
  }, []);

  useEffect(() => {
    if (!histogram) return;
    const previous = currentBins.current;
    const paint = (bins: HistogramBins) => { currentBins.current = bins; drawRef.current?.(bins); };
    if (!previous || reduced) { paint(histogram); return; }
    const interpolate = (from: number[], to: number[], progress: number) => from.map((n, i) => n + (to[i] - n) * progress);
    const animation = animate(0, 1, { ...Spring.presets.smooth, onUpdate: progress => {
      paint({ red: interpolate(previous.red, histogram.red, progress), green: interpolate(previous.green, histogram.green, progress),
        blue: interpolate(previous.blue, histogram.blue, progress), luminance: interpolate(previous.luminance, histogram.luminance, progress) });
    }, onComplete: () => paint(histogram) });
    return () => animation.stop();
  }, [histogram, reduced]);

  return <div className="viewer-histogram" data-histogram-state={status}>
    <div className="viewer-histogram-plot" aria-busy={status === 'loading'}>
      <canvas ref={canvasRef} className="histogram" role="img" aria-label="RGB 与亮度分布直方图，128 个区间"/>
      {status !== 'ready' && <div className="viewer-histogram-status" role="status">{status === 'loading' ? '正在分析…' : '图像无法解码或不允许跨域读取'}</div>}
    </div>
    <p className="histogram-note"><span className="histogram-legend" aria-hidden="true"><span>R</span><span>G</span><span>B</span><span>L</span></span><span>基于缩略图预览</span></p>
  </div>;
}
