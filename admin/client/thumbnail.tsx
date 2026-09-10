import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { subscribeThumbnail, observeThumbnails, thumbnailFailures, retryThumbnails, markThumbnailBroken, type ImageState } from './thumbnail-loader';
export function Thumbnail({src,alt,style,loading='lazy'}:{src?:string;alt?:string;style?:CSSProperties;loading?:'lazy'|'eager'}) {
  const ref=useRef<HTMLImageElement>(null),[state,setState]=useState<ImageState>({});
  useEffect(()=>{
    setState({}); if(!src)return;
    let release:(()=>void)|undefined;
    const load=()=>{release??=subscribeThumbnail(src,setState);};
    if(!('IntersectionObserver' in window)){load();return()=>release?.();}
    if(loading==='eager')load();
    const observer=new IntersectionObserver(items=>{if(items.some(i=>i.isIntersecting)){load();observer.disconnect();}},{rootMargin:'200px'});
    if(ref.current)observer.observe(ref.current);
    return()=>{observer.disconnect();release?.();};
  },[src,loading]);
  return <img ref={ref} src={state.url} onError={()=>{if(src&&state.url)markThumbnailBroken(src);}} alt={state.error?`${alt??'照片'}：${state.error}`:alt} style={style} data-thumbnail-status={state.error?'error':state.url?'ready':'loading'} />;
}
export function ThumbnailStatus() {
  const [,update]=useState(0);
  useEffect(()=>observeThumbnails(()=>update(n=>n+1)),[]);
  const failures=thumbnailFailures();
  return failures.length ? <div className="notice" role="status"><span>{failures.length} 张缩略图加载失败。{failures.some(f=>f.status===401)?'请重新登录后重试。':failures[0].error}</span><button className="text-button" onClick={retryThumbnails}>重试失败缩略图</button></div> : null;
}
