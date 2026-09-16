// Current public address. SITE_URL overrides this when the domain changes.
export const DEFAULT_SITE_URL = 'https://jason-gallery.pages.dev';

/** Never infer canonical URLs from requests or temporary deployment hosts. */
export function resolveSiteURL(value: string | undefined, required = false): string | undefined {
  const input = value?.trim();
  if (!input) {
    if (required) throw new Error('SITE_URL is required for production publishing. Set the public HTTPS origin.');
    return undefined;
  }
  const invalid = () => new Error('SITE_URL must be a public HTTPS origin without credentials, port, path, query or fragment.');
  let url: URL;
  try { url = new URL(input); } catch { throw invalid(); }
  const host = url.hostname;
  if (!/^https:\/\/[^/?#\\\s]+\/?$/i.test(input) || url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash || !host.includes('.') || host.endsWith('.') ||
      /^[\d.]+$/.test(host) || host.includes(':') ||
      /(^|\.)(localhost|local|test|invalid|example)$/.test(host) || /(^|\.)example\.(com|net|org)$/.test(host)) throw invalid();
  return url.origin;
}
