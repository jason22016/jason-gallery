// Afilmory/Afilmory, apps/web/src/modules/inspector/InspectorPanel.tsx and metadata/ExifPanel.tsx
// 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4. See THIRD_PARTY_NOTICES.md.
import { AnimatePresence, m, useIsPresent } from 'motion/react';
import { Spring } from '@afilmory/utils';
import { useLayoutEffect, useRef } from 'react';
import MetadataPanel from './MetadataPanel';
import { ActionButton } from './ActionButton';
import { ViewerIcon } from './ViewerIcon';
import { ViewerAttribution } from './ViewerAttribution';
import type { ViewerPhoto } from './photos';

type Props = { photo: ViewerPhoto; open: boolean; visible: boolean; reduced: boolean; onClose: () => void };

export function DesktopInspector(props: Props) {
  return <m.div className="viewer-inspector-slot" initial={false} animate={{ width: props.open ? 320 : 0 }} transition={props.reduced ? { duration: 0 } : Spring.presets.smooth}>
    <AnimatePresence>{props.open && <InspectorSurface key="inspector" {...props}/>}</AnimatePresence>
  </m.div>;
}

function InspectorSurface({ photo, visible, reduced, onClose }: Props) {
  const present = useIsPresent();
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { content.current?.scrollTo(0, 0); }, [photo.id]);
  return <m.aside className="viewer-inspector viewer-desktop-inspector" aria-label="照片信息" inert={!present || !visible}
    initial={reduced ? false : { opacity: 0, x: 100 }} animate={{ opacity: visible ? 1 : 0, x: visible || reduced ? 0 : 100 }}
    exit={{ opacity: 0, x: reduced ? 0 : 100 }} transition={reduced ? { duration: 0 } : Spring.presets.smooth}>
    <div className="inspector-glow" aria-hidden="true"/>
    <header><span className="inspector-header-label"><ViewerIcon name="information-line"/> 照片信息</span><ActionButton onClick={onClose} aria-label="收起照片信息" title="收起照片信息 (I)"><ViewerIcon name="layout-right-line"/></ActionButton></header>
    <div ref={content} className="inspector-desktop-content"><MetadataPanel photo={photo}/><ViewerAttribution/></div>
  </m.aside>;
}
