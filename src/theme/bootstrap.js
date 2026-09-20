// Runs before styles/paint so a saved preference never flashes the opposite theme.
(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('jason-gallery:theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* Theme switching also works when storage is unavailable. */ }
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = preference === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
})();
