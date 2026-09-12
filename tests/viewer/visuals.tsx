import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { rgbaToThumbHash } from 'thumbhash';
import '../../src/styles/global.css';
import '../../src/styles/gallery.css';
import PhotoViewer from '../../src/components/viewer/PhotoViewer';
import type { ViewerPhoto } from '../../src/components/viewer/photos';

const hash = (red: number, green: number, blue: number) => [...rgbaToThumbHash(1, 1, new Uint8Array([red, green, blue, 255]))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const photos: ViewerPhoto[] = Array.from({ length: 3 }, (_, i) => ({
  id: `visual-${i}`, src: `/viewer-${i === 1 ? 'landscape' : 'portrait'}.jpg`, thumbnail: `/ordinary.jpg?background=${i}`,
  thumbHash: [hash(80, 120, 160), hash(180, 90, 60), null][i]!, width: i === 1 ? 960 : 640, height: i === 1 ? 640 : 960,
  alt: `Visual photo ${i}`, title: `Visual photo ${i}`, filename: `visual-${i}.jpg`, description: '保留 Jason 的说明与完整元数据。',
  date: '2024-03-02T12:00:00+08:00', tags: ['城市', '光影', '长标签依然可以完整阅读并且不会横向溢出'], camera: 'FUJIFILM X-T5', lens: 'XF35mmF1.4 R',
  exposure: ['35 mm', 'ƒ/1.4', '1/125 s', 'ISO 100'], format: 'jpeg', size: 1048576,
  location: { latitude: 0, longitude: 0, city: 'GPS origin fixture' }, detailsUrl: `/visual-metadata.json?photo=${i}`, isHDR: false,
}));

function Fixture() {
  const [index, setIndex] = useState(0), [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button ref={trigger} data-viewer-trigger="visual-0" style={{ margin: 80, width: 120, height: 180, padding: 0 }} onClick={() => { setIndex(0); setOpen(true); }}><img src="/ordinary.jpg" alt="Open visual viewer"/></button>
    {open && <PhotoViewer photos={photos} projectTitle="Visual fixture" index={index} trigger={trigger.current} onIndex={setIndex} onClose={() => { setOpen(false); trigger.current?.focus(); }}/>}</>;
}
createRoot(document.querySelector('#root')!).render(<Fixture/>);
