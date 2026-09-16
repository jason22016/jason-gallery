import type { APIRoute } from 'astro';
import sharp from 'sharp';

/** Self-contained fallback for an empty portfolio; no private photos or remote fonts. */
export const GET: APIRoute = async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#161616"/>
    <path d="M80 110h70M80 110v70M1120 520h-70M1120 520v-70" stroke="#c5bea9" stroke-width="3" fill="none"/>
    <text x="120" y="310" fill="#ffffff" font-family="sans-serif" font-size="80" font-weight="600">Jason Gallery.</text>
    <text x="125" y="378" fill="#c5bea9" font-family="sans-serif" font-size="24" letter-spacing="7">PHOTOGRAPHY</text>
  </svg>`;
  const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg' } });
};
