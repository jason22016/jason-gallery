import { useEffect, useRef, useState, type ReactNode } from 'react';
import { altitude, aperture, captureZone, unit } from './metadata';
import { Camera, Aperture, Timer, Focus } from 'lucide-react';
import { formatBytes, type PhotoDetails, type ViewerPhoto } from './photos';
const cache = new Map<string, PhotoDetails>();
const textValue = (value: unknown): string => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
function Rows({ values }: { values: readonly (readonly [string, unknown])[] }) {
  return <dl className="metadata-rows">{values.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{textValue(value)}</dd></div>)}</dl>;
}
function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="metadata-section"><h3>{title}</h3>{children}</section>; }
export default function MetadataPanel({ photo }: { photo: ViewerPhoto }) {
  const [details, setDetails] = useState<PhotoDetails | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDetails(null); setStatus('loading');
    const cached = cache.get(photo.detailsUrl);
    if (cached) { setDetails(cached); setStatus('ready'); return; }
    void fetch(photo.detailsUrl, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Metadata unavailable');
      const result: PhotoDetails = await response.json();
      if (!controller.signal.aborted) { cache.set(photo.detailsUrl, result); setDetails(result); setStatus('ready'); }
    }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [photo.detailsUrl, attempt]);
  const exif = details?.exif;
  const tone = details?.toneAnalysis;
  return <div className="metadata-content" key={photo.id}>
    <Section title="基本信息"><Rows values={[
      ['文件名', photo.filename], ['格式', photo.format.toUpperCase()], ['尺寸', `${photo.width} × ${photo.height}`], ['文件大小', formatBytes(photo.size)], ['像素', `${(photo.width * photo.height / 1e6).toFixed(1)} MP`],
      ['色彩空间', exif?.ColorSpace], ['拍摄时间', photo.date ? photo.date.replace('T', ' ') : '未记录'], ['时区', captureZone(exif)], ['艺术家', exif?.Artist], ['软件', exif?.Software],
    ]}/></Section>
    {photo.exposure.length > 0 && <Section title="拍摄参数"><div className="exposure-grid">{photo.exposure.map((value, i) => { const Icon = value.startsWith('ISO') ? Camera : value.startsWith('ƒ/') ? Aperture : value.endsWith(' s') ? Timer : Focus; return <span key={`${i}:${value}`}><Icon size={15}/>{value}</span>; })}</div></Section>}
    {(photo.caption || photo.description) && <Section title="照片说明"><p className="photo-caption">{photo.caption || photo.description}</p></Section>}
    {!!photo.tags.length && <Section title="标签"><ul className="tags">{photo.tags.map(tag => <li key={tag}>{tag}</li>)}</ul></Section>}
    {tone && <Section title="影调分析"><Rows values={[
      ['影调类型', ({ 'low-key': '低调', 'high-key': '高调', normal: '正常', 'high-contrast': '高对比' })[tone.toneType]], ['亮度', `${Math.round(tone.brightness)}%`], ['对比度', `${Math.round(tone.contrast)}%`], ['阴影占比', `${Math.round(tone.shadowRatio * 100)}%`], ['高光占比', `${Math.round(tone.highlightRatio * 100)}%`],
    ]}/></Section>}
    <Section title="直方图"><Histogram photo={photo}/></Section>
    {(photo.camera || photo.lens) && <Section title="设备信息"><Rows values={[
      ['相机', photo.camera], ['镜头', photo.lens], ['焦距', unit(exif?.FocalLength, 'mm')], ['35mm 等效', unit(exif?.FocalLengthIn35mmFormat, 'mm')], ['最大光圈', aperture(exif?.MaxApertureValue)],
    ]}/></Section>}
    {exif && <Section title="拍摄模式"><Rows values={[
      ['曝光程序', exif.ExposureProgram], ['曝光模式', exif.ExposureMode], ['测光模式', exif.MeteringMode], ['白平衡', exif.WhiteBalance], ['闪光灯', exif.Flash], ['光源', exif.LightSource], ['场景', exif.SceneCaptureType],
    ]}/></Section>}
    {exif?.FujiRecipe && <Section title="胶片模拟配方"><Rows values={Object.entries(exif.FujiRecipe).map(([key, value]) => [({ FilmMode: '胶片模式', GrainEffectRoughness: '颗粒强度', GrainEffectSize: '颗粒大小', ColorChromeEffect: '色彩效果', ColorChromeFxBlue: '蓝色效果', WhiteBalance: '白平衡', WhiteBalanceFineTune: '白平衡微调', DynamicRange: '动态范围', HighlightTone: '高光色调', ShadowTone: '阴影色调', Saturation: '饱和度', Sharpness: '锐度', NoiseReduction: '降噪', Clarity: '清晰度', ColorTemperature: '色温', DevelopmentDynamicRange: '显影动态范围', DynamicRangeSetting: '动态范围设置' } as Record<string, string>)[key] || key, value])}/></Section>}
    {photo.location && <Section title="拍摄位置"><Rows values={[
      ['国家', photo.location.country], ['城市', photo.location.city], ['地点', photo.location.locationName], ['纬度', unit(photo.location.latitude, '°')], ['经度', unit(photo.location.longitude, '°')], ['海拔', altitude(exif)],
    ]}/><a className="metadata-map-link" href={`https://www.openstreetmap.org/?mlat=${photo.location.latitude}&mlon=${photo.location.longitude}#map=14/${photo.location.latitude}/${photo.location.longitude}`} target="_blank" rel="noreferrer">在地图中查看 ↗</a></Section>}
    {exif && <Section title="技术参数"><Rows values={[
      ['亮度', exif.BrightnessValue], ['曝光补偿', unit(exif.ExposureCompensation, 'EV')], ['快门速度', unit(exif.ShutterSpeedValue, 's')], ['光圈值', aperture(exif.ApertureValue)], ['感光方式', exif.SensingMethod], ['焦平面 X 分辨率（原始值）', exif.FocalPlaneXResolution], ['焦平面 Y 分辨率（原始值）', exif.FocalPlaneYResolution], ['版权', exif.Copyright],
    ]}/></Section>}
    {status === 'loading' && <p className="muted" role="status">正在加载详细信息…</p>}
    {status === 'error' && <p className="muted" role="status">详细信息暂时不可用。<button onClick={event => { event.currentTarget.closest('dialog')?.querySelector<HTMLButtonElement>('.viewer-close')?.focus(); setAttempt(n => n + 1); }}>重试</button></p>}
    {status === 'ready' && !exif && <p className="muted">此照片没有 EXIF 信息。</p>}
  </div>;
}
function Histogram({ photo }: { photo: ViewerPhoto }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'original' | 'thumbnail' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    const image = new Image(); image.crossOrigin = 'anonymous';
    let thumbnail = false;
    setState('loading');
    const fallback = () => { if (!active) return; if (!thumbnail) { thumbnail = true; image.src = photo.thumbnail; } else setState('error'); };
    image.onload = () => {
      if (!active) return;
      try {
        const sample = document.createElement('canvas'); sample.width = 256; sample.height = Math.max(1, Math.round(256 * image.naturalHeight / image.naturalWidth));
        if (sample.height > 256) { sample.width = Math.max(1, Math.round(256 * image.naturalWidth / image.naturalHeight)); sample.height = 256; }
        const context = sample.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0, sample.width, sample.height);
        const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
        const channels = Array.from({ length: 3 }, () => new Array<number>(64).fill(0));
        for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) channels[c]![Math.floor(pixels[i + c]! / 4)]!++;
        const max = Math.max(1, ...channels.flat());
        const plot = canvas.current?.getContext('2d'); if (!plot) return;
        plot.clearRect(0, 0, 280, 100);
        channels.forEach((bins, c) => { plot.beginPath(); plot.moveTo(0, 100); bins.forEach((n, i) => plot.lineTo(i * 280 / 63, 96 - Math.sqrt(n / max) * 88)); plot.lineTo(280, 100); plot.closePath(); plot.fillStyle = ['#ec66667a', '#63ba887a', '#6b96e47a'][c]!; plot.fill(); });
        setState(thumbnail ? 'thumbnail' : 'original');
      } catch { fallback(); }
    };
    image.onerror = fallback; image.src = photo.src;
    return () => { active = false; image.onload = null; image.onerror = null; image.src = ''; };
  }, [photo.src, photo.thumbnail]);
  return <><canvas className="histogram" ref={canvas} width={280} height={100} role="img" aria-label="RGB 亮度分布直方图"/><p className="histogram-note">{state === 'loading' ? '正在分析…' : state === 'error' ? '图像无法解码或不允许跨域读取' : state === 'thumbnail' ? '基于缩略图预览' : '基于浏览器解码图像'}</p></>;
}
