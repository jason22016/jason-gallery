import type { APIRoute } from 'astro';
import { robotsTXT } from '../website/seo';

export const GET: APIRoute = ({ site }) => new Response(robotsTXT(site), {
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
});
