import { EllipsisWithTooltip } from './ui/EllipsisWithTooltip';
import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { useReducedMotion } from './ui/useReducedMotion';
import { getViewerTransitionTriggerProps } from '@afilmory/viewer-motion';
import { memo, useState, type MouseEvent } from 'react';
import type { RenderComponentProps } from 'masonic';
import { CarbonIsoOutline, MaterialSymbolsShutterSpeed, StreamlineImageAccessoriesLensesPhotosCameraShutterPicturePhotographyPicturesPhotoLens as LensIcon, TablerAperture } from '../viewer/CaptureIcons';
import PhotoThumbnail from './PhotoThumbnail';
import { useLivePhoto } from './media/useLivePhoto';
import type { GalleryItem } from './photos';

export const MasonryPhotoItem = memo(function MasonryPhotoItem({ data: { photo, index, onOpen }, width }: RenderComponentProps<GalleryItem>) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const live = useLivePhoto(photo, imageLoaded);
  const reduced = useReducedMotion();
  const calculatedHeight = width / photo.aspectRatio;
  const description = photo.caption || photo.description;
  const capture = photo.capture;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); live.stop(); onOpen(photo, event.currentTarget);
  };
  return <m.a initial={false} whileHover={!live.isMobile && !reduced ? "hover" : "rest"} className="photo-link masonry-photo group" href={photo.src} style={{ width, height: calculatedHeight }}
    {...getViewerTransitionTriggerProps(photo.id)} data-viewer-trigger={photo.id} data-photo-id={photo.id} data-gallery-index={index}
    aria-label={`查看照片：${photo.alt}`} onClick={open} onMouseEnter={live.enter} onMouseLeave={live.stop}>
    <m.span className="masonry-media" variants={{ hover: { scale: 1.05 }, rest: { scale: 1 } }} animate={reduced ? { scale: 1 } : undefined} transition={Spring.presets.smooth}>
    <PhotoThumbnail photo={photo} eager={index < 8} onReady={setImageLoaded} />
    {photo.video && <video ref={live.videoRef} className="live-photo-video" data-playing={live.playing} muted playsInline preload="auto" onEnded={live.stop} aria-hidden="true" />}
    </m.span>
    <span className="photo-badges">
      {photo.video && <span className="photo-badge live-photo-badge" data-state={live.state} data-playing={live.playing}
        title={live.state === 'error' ? '实况预览暂不可用' : live.isMobile ? '实况照片' : '悬停播放实况照片'}>
        <i className={`gallery-icon i-mingcute-${live.state === 'loading' ? 'loading' : 'live-photo'}-line`} aria-hidden="true" />
        <span>{live.state === 'loading' ? '正在加载' : 'LIVE'}</span>
        {live.state === 'error' && <span className="live-photo-error" role="status" aria-label="实况预览暂不可用">!</span>}
      </span>}
      {photo.isHDR && <span className="photo-badge hdr-badge"><i className="gallery-icon i-mingcute-sun-line" aria-hidden="true" />HDR</span>}
    </span>
    {imageLoaded && <>
      <span className="photo-hover-gradient" />
      <span className="photo-hover">
        <span className="photo-summary">
          <strong className="photo-title"><EllipsisWithTooltip>{photo.title}</EllipsisWithTooltip></strong>
          {description && <EllipsisWithTooltip className="photo-description" multiline>{description}</EllipsisWithTooltip>}
          <span className="photo-file-info"><span>{photo.format.toUpperCase()}</span><span>•</span><span>{photo.width} × {photo.height}</span><span>•</span><span>{(photo.size / 1024 / 1024).toFixed(1)}MB</span></span>
          {!!photo.tags.length && <span className="photo-tags" title={photo.tags.join(' · ')}>{photo.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}
        </span>
        {calculatedHeight >= 200 && Object.values(capture).some(Boolean) && <span className="photo-exif">
          {capture.focalLength && <span title="35mm 等效焦距（缺失时显示实际焦距）"><LensIcon aria-hidden="true" /><span>{capture.focalLength}</span></span>}
          {capture.aperture && <span><TablerAperture aria-hidden="true" /><span>{capture.aperture}</span></span>}
          {capture.shutter && <span><MaterialSymbolsShutterSpeed aria-hidden="true" /><span>{capture.shutter}</span></span>}
          {capture.iso && <span><CarbonIsoOutline aria-hidden="true" /><span>{capture.iso}</span></span>}
        </span>}
      </span>
    </>}
  </m.a>;
});
