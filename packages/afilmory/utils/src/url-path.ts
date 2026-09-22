// Paths are raw filenames: preserve separators and encode literal percent signs
// without decoding sequences such as "%20" into a different filename.
export const encodePathSegments = (path: string): string => path.split('/').map(encodeURIComponent).join('/')
