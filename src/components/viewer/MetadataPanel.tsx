// Layout adapted from Afilmory/Afilmory, apps/web/src/modules/metadata/ExifPanel.tsx
// 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4. See THIRD_PARTY_NOTICES.md.
import { useEffect, useState } from 'react';
import { altitude, aperture, captureZone, unit } from './metadata';
import { formatBytes, type PhotoDetails, type ViewerPhoto } from './photos';
import { ExifSection, Rows } from './ExifSection';
import { HistogramChart } from './HistogramChart';
import { MiniMap } from './MiniMap';
import { CarbonIsoOutline, TablerAperture, MaterialSymbolsShutterSpeed, MaterialSymbolsExposure,
  StreamlineImageAccessoriesLensesPhotosCameraShutterPicturePhotographyPicturesPhotoLens } from './CaptureIcons';
const cache = new Map<string, PhotoDetails>();
const recipeOrder = ['FilmMode', 'DynamicRange', 'WhiteBalance', 'HighlightTone', 'ShadowTone', 'Saturation', 'Sharpness', 'NoiseReduction', 'Clarity', 'ColorChromeEffect', 'ColorChromeFxBlue', 'WhiteBalanceFineTune', 'GrainEffectRoughness', 'GrainEffectSize'];
const recipeEntries = (recipe: object) => Object.entries(recipe).sort(([a], [b]) => {
  const rank = (key: string) => recipeOrder.includes(key) ? recipeOrder.indexOf(key) : recipeOrder.length;
  return rank(a) - rank(b);
});
export default function MetadataPanel({ photo }: { photo: ViewerPhoto }) {
  const [resource, setResource] = useState<{ url: string; details: PhotoDetails } | null>(null);
  const details = resource?.url === photo.detailsUrl ? resource.details : null;
  const [load, setLoad] = useState<{ url: string; status: 'loading' | 'ready' | 'error' }>({ url: photo.detailsUrl, status: 'loading' });
  const status = load.url === photo.detailsUrl ? load.status : 'loading';
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const setStatus = (status: 'loading' | 'ready' | 'error') => setLoad({ url: photo.detailsUrl, status });
    setResource(null); setStatus('loading');
    const cached = cache.get(photo.detailsUrl);
    if (cached) { setResource({ url: photo.detailsUrl, details: cached }); setStatus('ready'); return; }
    void fetch(photo.detailsUrl, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Metadata unavailable');
      const result: PhotoDetails = await response.json();
      if (!controller.signal.aborted) { cache.set(photo.detailsUrl, result); setResource({ url: photo.detailsUrl, details: result }); setStatus('ready'); }
    }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [photo.detailsUrl, attempt]);
  const exif = details?.exif;
  const tone = details?.toneAnalysis;
  return <div className="metadata-content">
    <ExifSection title="基本信息"><Rows values={[
      ['文件名', photo.filename], ['格式', photo.format.toUpperCase()], ['尺寸', `${photo.width} × ${photo.height}`], ['文件大小', formatBytes(photo.size)], ['像素', `${(photo.width * photo.height / 1e6).toFixed(1)} MP`],
      ['色彩空间', exif?.ColorSpace], ['评分', exif?.Rating ? '★'.repeat(Math.min(5, Math.max(0, exif.Rating))) : null], ['拍摄时间', photo.date ? photo.date.replace('T', ' ') : '未记录'], ['时区', captureZone(exif)], ['艺术家', exif?.Artist], ['软件', exif?.Software],
    ]}/></ExifSection>
    {photo.exposure.length > 0 && <ExifSection title="拍摄参数"><div className="exposure-grid">{photo.exposure.map((value, i) => { const Icon = value.startsWith('ISO') ? CarbonIsoOutline : value.startsWith('ƒ/') ? TablerAperture : value.endsWith(' s') ? MaterialSymbolsShutterSpeed : StreamlineImageAccessoriesLensesPhotosCameraShutterPicturePhotographyPicturesPhotoLens; return <span key={`${i}:${value}`}><Icon aria-hidden="true"/>{value}</span>; })}{exif?.ExposureCompensation != null && <span><MaterialSymbolsExposure aria-hidden="true"/>{unit(exif.ExposureCompensation, 'EV')}</span>}</div></ExifSection>}
    {(photo.caption || photo.description) && <ExifSection title="照片说明"><p className="photo-caption">{photo.caption || photo.description}</p>{photo.caption && photo.description && photo.description !== photo.caption && <p className="photo-caption">{photo.description}</p>}</ExifSection>}
    {!!photo.tags.length && <ExifSection title="标签"><ul className="metadata-tags">{photo.tags.map(tag => <li key={tag}>{tag}</li>)}</ul></ExifSection>}
    {tone && <ExifSection title="影调分析"><Rows values={[
      ['影调类型', ({ 'low-key': '低调', 'high-key': '高调', normal: '正常', 'high-contrast': '高对比' })[tone.toneType]],
    ]}/><Rows className="metadata-tone-grid" values={[['亮度', `${Math.round(tone.brightness)}%`], ['对比度', `${Math.round(tone.contrast)}%`], ['阴影占比', `${Math.round(tone.shadowRatio * 100)}%`], ['高光占比', `${Math.round(tone.highlightRatio * 100)}%`],
    ]}/></ExifSection>}
    <ExifSection title="直方图"><HistogramChart thumbnailUrl={photo.thumbnail}/></ExifSection>
    {(photo.camera || photo.lens) && <ExifSection title="设备信息"><Rows values={[
      ['相机', photo.camera], ['镜头', photo.lens], ['镜头厂商', exif?.LensMake && !photo.lens.includes(exif.LensMake) ? exif.LensMake : null], ['焦距', unit(exif?.FocalLength, 'mm')], ['35mm 等效', unit(exif?.FocalLengthIn35mmFormat, 'mm')], ['最大光圈', aperture(exif?.MaxApertureValue)],
    ]}/></ExifSection>}
    {exif && <ExifSection title="拍摄模式"><Rows values={[
      ['曝光程序', exif.ExposureProgram], ['曝光模式', exif.ExposureMode], ['测光模式', exif.MeteringMode], ['白平衡', exif.WhiteBalance], ['闪光灯', exif.Flash], ['光源', exif.LightSource], ['场景', exif.SceneCaptureType],
    ]}/></ExifSection>}
    {exif?.FujiRecipe && <ExifSection title="胶片模拟配方"><Rows values={recipeEntries(exif.FujiRecipe).map(([key, value]) => [({ FilmMode: '胶片模式', GrainEffectRoughness: '颗粒强度', GrainEffectSize: '颗粒大小', ColorChromeEffect: '色彩效果', ColorChromeFxBlue: '蓝色效果', WhiteBalance: '白平衡', WhiteBalanceFineTune: '白平衡微调', DynamicRange: '动态范围', HighlightTone: '高光色调', ShadowTone: '阴影色调', Saturation: '饱和度', Sharpness: '锐度', NoiseReduction: '降噪', Clarity: '清晰度', ColorTemperature: '色温', DevelopmentDynamicRange: '显影动态范围', DynamicRangeSetting: '动态范围设置' } as Record<string, string>)[key] || key, value])}/></ExifSection>}
    {photo.location && <ExifSection title="拍摄位置"><Rows values={[
      ['国家', photo.location.country], ['城市', photo.location.city], ['地点', photo.location.locationName], ['纬度', unit(photo.location.latitude, '°')], ['经度', unit(photo.location.longitude, '°')], ['海拔', altitude(exif)],
    ]}/><MiniMap latitude={photo.location.latitude} longitude={photo.location.longitude}/><a className="metadata-map-link" href={`https://www.openstreetmap.org/?mlat=${photo.location.latitude}&mlon=${photo.location.longitude}#map=14/${photo.location.latitude}/${photo.location.longitude}`} target="_blank" rel="noreferrer">在地图中查看 ↗</a></ExifSection>}
    {exif && <ExifSection title="技术参数"><Rows values={[
      ['亮度', exif.BrightnessValue], ['曝光补偿', unit(exif.ExposureCompensation, 'EV')], ['快门速度', unit(exif.ShutterSpeedValue, 's')], ['光圈值', aperture(exif.ApertureValue)], ['感光方式', exif.SensingMethod], ['焦平面 X 分辨率（原始值）', exif.FocalPlaneXResolution], ['焦平面 Y 分辨率（原始值）', exif.FocalPlaneYResolution], ['版权', exif.Copyright],
    ]}/></ExifSection>}
    {status === 'loading' && <p className="muted" role="status">正在加载详细信息…</p>}
    {status === 'error' && <p className="muted" role="status">详细信息暂时不可用。<button onClick={event => { event.currentTarget.closest('dialog')?.querySelector<HTMLButtonElement>('.viewer-close')?.focus(); setAttempt(n => n + 1); }}>重试</button></p>}
    {status === 'ready' && !exif && <p className="muted">此照片没有 EXIF 信息。</p>}
  </div>;
}
