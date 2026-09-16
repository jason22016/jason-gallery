import type { APIRoute } from 'astro';
import { loadProjects } from '../projects';
import { sitemapXML } from '../website/seo';

export const GET: APIRoute = ({ site }) => new Response(
  sitemapXML(site, loadProjects().listProjects().map(project => project.slug)),
  { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
);
