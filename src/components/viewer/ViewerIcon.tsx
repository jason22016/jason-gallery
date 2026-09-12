export type ViewerIconName = 'close-line' | 'left-line' | 'right-line' | 'share-2-line' | 'information-line' | 'external-link-line' | 'zoom-in-line' | 'zoom-out-line' | 'refresh-2-line' | 'arrow-up-line' | 'arrow-down-line' | 'layout-right-line';
export function ViewerIcon({ name, size = 16 }: { name: ViewerIconName; size?: number }) {
  return <i aria-hidden="true" className={`viewer-icon i-mingcute-${name}`} style={{ fontSize: size }}/>;
}
