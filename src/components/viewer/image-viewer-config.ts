// Effective ProgressiveImage + webgl-viewer parameters at the pinned upstream commit.
// Keep stable object identities; accessibility may override smooth at the call site.
export const imageViewerConfig = {
  initialScale: 1, minScale: 1, maxScale: 20,
  wheel: { step: 0.1, wheelDisabled: false, touchPadDisabled: false },
  pinch: { step: 0.5, disabled: false },
  doubleClick: { step: 2, disabled: false, mode: 'toggle' as const, animationTime: 200 },
  panning: { disabled: false, velocityDisabled: true },
  limitToBounds: true, centerOnInit: true, smooth: true,
  alignmentAnimation: { sizeX: 0, sizeY: 0, velocityAlignmentTime: 0.2 },
  velocityAnimation: { sensitivity: 1, animationTime: 0.2 },
  debug: false,
};
