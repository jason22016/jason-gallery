import { createRoot } from 'react-dom/client';
import ProjectGallery from '../../src/components/gallery/ProjectGallery';
import PhotoGallery from '../../src/components/gallery/PhotoGallery';
import type { GalleryPhoto } from '../../src/components/gallery/photos';
import { PanelLifecycleFixture } from './PanelLifecycleFixture';
import '../../src/styles/global.css';
import '../../src/components/gallery/GalleryTokens.css';
import '../../src/components/gallery/GalleryIcons.css';
import '../../src/styles/gallery.css';
void fetch('/photos.json').then(response => response.json()).then((data: GalleryPhoto[]) => {
  const params = new URLSearchParams(location.search);
  createRoot(document.getElementById('root')!).render(params.has('panel-lifecycle') ? <PanelLifecycleFixture /> : params.has('global')
    ? <PhotoGallery photos={data} title="Explore" />
    : <ProjectGallery photos={data} project={{ title: 'Project — 长标题的照片选集', slug: 'gallery-fixture', summary: 'Gallery parity test' }} />);
});
