// Adapted from Afilmory/Afilmory, apps/web/src/modules/viewer/MobilePhotoInspectorSheet.tsx
// Upstream 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4, Copyright (c) 2025 Afilmory Team.
// See THIRD_PARTY_NOTICES.md for the local adaptations.
import { createInspectorSheetPresentation, resolveInspectorSheetHeight, useWindowViewport } from '@afilmory/viewer-motion';
import { m, useTransform, type MotionValue } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { X, Info } from 'lucide-react';
import MetadataPanel from './MetadataPanel';
import { ViewerAttribution } from './ViewerAttribution';
import type { ViewerPhoto } from './photos';
export function MobilePhotoInspectorSheet({ currentPhoto, isInteractive, progress, onClose,
  createPresentation = createInspectorSheetPresentation, resolveHeight = resolveInspectorSheetHeight,
}: { currentPhoto: ViewerPhoto; isInteractive: boolean; progress: MotionValue<number>; onClose: () => void;
  createPresentation?: typeof createInspectorSheetPresentation; resolveHeight?: typeof resolveInspectorSheetHeight }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { height: viewportHeight } = useWindowViewport();
  const sheetHeight = useMemo(() => resolveHeight(viewportHeight || 844), [resolveHeight, viewportHeight]);
  useEffect(() => { sheetRef.current?.querySelector('.inspector-sheet-content')?.scrollTo(0, 0); }, [currentPhoto.id, isInteractive]);
  useEffect(() => {
    if (!isInteractive) {
      const { activeElement } = document
      if (activeElement instanceof HTMLElement && sheetRef.current?.contains(activeElement)) {
        activeElement.blur()
      }
    }
  }, [isInteractive])

  const handleClose = useCallback(() => {
    const { activeElement } = document
    if (activeElement instanceof HTMLElement && sheetRef.current?.contains(activeElement)) {
      activeElement.blur()
    }

    onClose()
  }, [onClose])

  const getSheetPresentation = () => createPresentation({ progress: progress.get(), sheetHeight })
  const sheetY = useTransform(() => getSheetPresentation().y)
  const sheetOpacity = useTransform(() => getSheetPresentation().opacity)
  const sheetScale = useTransform(() => getSheetPresentation().scale)

  return <m.div className="mobile-inspector-sheet" aria-hidden={!isInteractive} inert={!isInteractive}
    style={{ y: sheetY, opacity: sheetOpacity }}>
    <m.div ref={sheetRef} className="viewer-inspector inspector-sheet-surface" role="region" aria-label="照片信息"
      style={{ height: sheetHeight, scale: sheetScale, transformOrigin: '50% 100%', pointerEvents: isInteractive ? 'auto' : 'none' }}>
      <div className="inspector-sheet-glow"/>
      <header><div className="inspector-sheet-handle"/><span><Info size={16}/> 照片信息</span>
        <button className="icon-button" type="button" onClick={handleClose} aria-label="收起照片信息"><X size={20}/></button>
      </header>
      <div className="inspector-sheet-content">{isInteractive && <><MetadataPanel key={currentPhoto.id} photo={currentPhoto}/><ViewerAttribution/></>}</div>
    </m.div>
  </m.div>;
}
