import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../ui/useReducedMotion';
import { useMobile } from '../../../hooks/useMobile';
import type { GalleryPhoto } from '../photos';

export function useLivePhoto(photo: GalleryPhoto, imageLoaded: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const generation = useRef(0);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [playing, setPlaying] = useState(false);
  const isMobile = useMobile();
  const reducedMotion = useReducedMotion();
  const stop = useCallback(() => {
    hovered.current = false;
    generation.current++;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setPlaying(false);
    const video = videoRef.current;
    if (video) { video.pause(); if (video.readyState) video.currentTime = 0; }
  }, []);
  const enter = useCallback(() => {
    if (isMobile || reducedMotion || !photo.video) return;
    hovered.current = true;
    if (state !== 'ready' || playing || hoverTimerRef.current) return;
    const current = ++generation.current;
    hoverTimerRef.current = setTimeout(async () => {
      hoverTimerRef.current = null;
      const video = videoRef.current;
      if (!video || !hovered.current) return;
      try {
        video.currentTime = 0;
        await video.play();
        if (current === generation.current && hovered.current) setPlaying(true);
        else video.pause();
      } catch {
        if (current === generation.current) { setState('error'); setPlaying(false); }
      }
    }, 200);
  }, [isMobile, reducedMotion, photo.video, state, playing]);
  useEffect(() => {
    if (isMobile || reducedMotion) stop();
    else if (state === 'ready' && hovered.current) enter();
  }, [isMobile, reducedMotion, state, enter, stop]);
  useEffect(() => {
    const video = videoRef.current;
    const source = photo.video;
    if (!source || !imageLoaded || !video) return;
    const controller = new AbortController();
    let objectURL: string | undefined;
    setState('loading');
    const ready = () => { if (!controller.signal.aborted) { clearTimeout(timeout); setState('ready'); } };
    const error = () => { clearTimeout(timeout); controller.abort(); stop(); setState('error'); };
    const timeout = setTimeout(() => { error(); controller.abort(); }, 20000);
    video.addEventListener('canplay', ready);
    video.addEventListener('error', error);
    const load = async () => {
      let url: string | null = source.type === 'live-photo' ? source.videoUrl : null;
      if (source.type === 'motion-photo') {
        const { extractMotionPhotoVideo } = await import('./motion-photo-extractor');
        url = await extractMotionPhotoVideo(photo.src, {
          motionPhotoOffset: source.offset, motionPhotoVideoSize: source.size, presentationTimestampUs: source.presentationTimestamp,
        }, controller.signal);
        objectURL = url ?? undefined;
      } else if (/\.mov(?:[?#]|$)/i.test(source.videoUrl) && !video.canPlayType('video/quicktime')) {
        const { transmuxMovToMp4 } = await import('./mp4-utils');
        const result = await transmuxMovToMp4(source.videoUrl, { signal: controller.signal });
        url = result.videoUrl ?? null;
        objectURL = url ?? undefined;
      }
      if (controller.signal.aborted) { if (objectURL) URL.revokeObjectURL(objectURL); return; }
      if (!url) throw new Error('Video unavailable');
      video.src = url;
      video.load();
    };
    void load().catch(() => { if (!controller.signal.aborted) error(); });
    return () => {
      controller.abort(); clearTimeout(timeout); stop();
      video.removeEventListener('canplay', ready); video.removeEventListener('error', error);
      video.removeAttribute('src'); video.load();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [photo.video, photo.src, imageLoaded, stop]);
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', stop);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('blur', stop); stop(); };
  }, [stop]);
  return { videoRef, state, playing, enter, stop, isMobile };
}
