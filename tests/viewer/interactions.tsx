import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { rgbaToThumbHash } from 'thumbhash';
import '../../src/styles/global.css';
import '../../src/styles/gallery.css';
import PhotoViewer from '../../src/components/viewer/PhotoViewer';
import type { ViewerPhoto } from '../../src/components/viewer/photos';
const hash = [...rgbaToThumbHash(1, 1, new Uint8Array([90, 120, 145, 255]))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const photos: ViewerPhoto[] = Array.from({ length: 180 }, (_, i) => ({
  id: `photo-${i}`, src: `/viewer-${i % 2 ? 'landscape' : 'portrait'}.jpg?photo=${i}`, thumbnail: '/ordinary.jpg', thumbHash: hash,
  width: i % 2 ? 960 : 640, height: i % 2 ? 640 : 960, alt: `Photo ${i}`, title: `Photo ${i}`, filename: `photo-${i}.jpg`,
  description: '', date: '', tags: [], camera: '', lens: '', exposure: [], format: 'jpeg', size: 100,
  location: null, detailsUrl: '/metadata.json', isHDR: false,
}));
function Fixture() {
  const [index, setIndex] = useState(0), [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button ref={trigger} data-viewer-trigger="photo-0" style={{ margin: 100, width: 120, height: 180, padding: 0 }} onClick={() => { setIndex(0); setOpen(true); }}><img src="/ordinary.jpg" style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Open viewer"/></button>
    {open && <PhotoViewer photos={photos} projectTitle="Interaction fixture" index={index} trigger={trigger.current}
      onIndex={value => { setIndex(value); history.replaceState(null, '', `?photo=photo-${value}`); }} onClose={() => { setOpen(false); trigger.current?.focus(); }}/ >}
  </>;
}
createRoot(document.querySelector('#root')!).render(<Fixture/>);
