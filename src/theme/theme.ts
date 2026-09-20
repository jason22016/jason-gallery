import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
type Theme = Exclude<ThemePreference, 'system'>;
type ThemeState = { preference: ThemePreference; resolved: Theme; transitioning: boolean };
export const THEME_STORAGE_KEY = 'jason-gallery:theme';
export const THEME_DURATION = 800;
const listeners = new Set<() => void>();
let state: ThemeState | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let device: MediaQueryList;
let reducedMotion: MediaQueryList;

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Optional preference storage. */ }
  return 'system';
}

function publish() { for (const listener of listeners) listener(); }

function finishTransition() {
  clearTimeout(timer);
  delete document.documentElement.dataset.themeTransition;
  if (state?.transitioning) {
    state = { ...state, transitioning: false };
    publish();
  }
}

function apply(preference: ThemePreference, animate = true) {
  const resolved = preference === 'system' ? (device.matches ? 'dark' : 'light') : preference;
  const changed = !!state && resolved !== state.resolved;
  const transitioning = changed ? animate && !reducedMotion.matches : !!state?.transitioning;
  const root = document.documentElement;
  if (changed) {
    clearTimeout(timer);
    if (transitioning) {
      root.dataset.themeTransition = resolved;
      timer = setTimeout(finishTransition, THEME_DURATION);
    } else delete root.dataset.themeTransition;
  }
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  const browserColor = document.querySelector('meta[name="theme-color"]');
  browserColor?.setAttribute('content', resolved === 'dark' ? (document.body?.classList.contains('gallery-page') ? '#1c1c1e' : '#161616') : '#f7f8fa');
  state = { preference, resolved, transitioning };
  publish();
}

export function initializeTheme() {
  if (typeof window === 'undefined' || state) return;
  device = window.matchMedia('(prefers-color-scheme: dark)');
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  apply(readPreference(), false);
  device.addEventListener('change', () => { if (state?.preference === 'system') apply('system'); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) finishTransition(); });
  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) apply(readPreference());
  });
  window.addEventListener('pageshow', event => { if (event.persisted) apply(readPreference(), false); });
}

export function setThemePreference(preference: ThemePreference) {
  initializeTheme();
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch { /* Keep the current page usable without storage. */ }
  apply(preference);
}

function subscribe(listener: () => void) {
  initializeTheme();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function snapshot() { initializeTheme(); return state; }
export function useTheme() { return useSyncExternalStore(subscribe, snapshot, () => null); }
