import { useEffect, useRef } from 'react';
import { setThemePreference, useTheme, type ThemePreference } from '../theme/theme';
import '../styles/theme.css';

const phases = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '🌑'];
const options: { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'system', label: '跟随系统', icon: '🌓' },
  { value: 'light', label: '浅色', icon: '🌕' },
  { value: 'dark', label: '深色', icon: '🌑' },
];

export function ThemeControl() {
  const theme = useTheme();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  const preference = theme?.preference ?? 'system';
  const label = theme?.resolved === 'dark' ? '切换至浅色' : '切换至深色';
  return <div className="theme-control" data-theme-control data-viewer-interactive>
    <button type="button" className="theme-toggle" aria-label="切换明暗主题" title={`${label} · ${preference === 'system' ? '跟随系统' : '手动选择'}`}
      onClick={() => {
        const current = theme?.resolved ?? document.documentElement.dataset.theme;
        setThemePreference(current === 'dark' ? 'light' : 'dark');
      }}>
      <span className="theme-moon" aria-hidden="true">
        <span className="theme-moon-rest"><span className="theme-moon-light">🌕</span><span className="theme-moon-dark">🌑</span></span>
        <span className="theme-moon-orbit">{phases.map((phase, index) => <span key={index}>{phase}</span>)}</span>
      </span>
    </button>
    <details ref={menu} className="theme-menu" onKeyDown={event => {
      if (event.key === 'Escape' && event.currentTarget.open) {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
      <summary aria-label="主题设置" title="主题设置"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></summary>
      <div className="theme-options" role="group" aria-label="外观模式">
        {options.map(option => <button type="button" key={option.value} aria-pressed={preference === option.value} onClick={() => {
          setThemePreference(option.value);
          if (menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); }
        }}><span aria-hidden="true">{option.icon}</span><span>{option.label}</span><span className="theme-option-check" aria-hidden="true">{preference === option.value ? '✓' : ''}</span></button>)}
      </div>
    </details>
  </div>;
}
