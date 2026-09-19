import type { APIRoute, GetStaticPaths } from 'astro';
import { loadProjects } from '../../../../projects';
import type { PhotoDetails } from '../../../../components/viewer/photos';
import { projectPhotoDetails } from '../../../../website/photo-details';
export const getStaticPaths = (() => loadProjects().listProjects().flatMap(project => project.photos.map(({ photo }) => ({
  params: { slug: project.slug, id: photo.id },
  props: { details: projectPhotoDetails(project, photo.id) },
})))) satisfies GetStaticPaths;
export const GET: APIRoute = ({ props }) => new Response(JSON.stringify(props.details as PhotoDetails), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
