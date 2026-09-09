import type { ProjectIndex } from '../../src/projects/index';

// Compile-only checks: mutation must also be rejected before runtime.
export function readonlyContract(index: ProjectIndex): void {
  const projects = index.listProjects();
  // @ts-expect-error Query arrays are readonly.
  projects.push(projects[0]);
  // @ts-expect-error Project metadata is readonly.
  projects[0].title = 'changed';
  // @ts-expect-error Nested photo references are readonly.
  projects[0].photos[0].caption = 'changed';
  // @ts-expect-error Photo Engine data is recursively readonly.
  projects[0].photos[0].photo.tags.push('changed');
  // @ts-expect-error Cover data is readonly.
  projects[0].cover.width = 1;
  // @ts-expect-error Public index cannot switch to draft data.
  index.listProjects({ status: 'draft' });
}
