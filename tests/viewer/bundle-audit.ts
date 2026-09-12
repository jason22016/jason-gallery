import assert from 'node:assert/strict';

/** file-type 22 deliberately keeps its Node-only FileTypeParser.fromFile method
 * behind a nonliteral runtime import (also in its supported browser entry).
 * The site imports only fileTypeFromBlob. Permit that one dormant method's
 * specifier, while keeping the existing server-code/string leak checks elsewhere.
 * Fail closed if a future dependency changes the method's structure. */
export function browserBundleForAudit(source: string): string {
  return stripFileTypeNodeMethod(source);
}
function stripFileTypeNodeMethod(source: string): string {
  const start = source.search(/async fromFile\([^)]*\)\{/);
  if (start < 0) return source;
  const open = source.indexOf('{', start);
  let depth = 1, end = open + 1;
  for (; end < source.length && depth; end++) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
  }
  const method = source.slice(start, end);
  if (!method.includes('node:fs/promises')) return source;
  assert.equal(depth, 0, 'Unexpected file-type Node method');
  assert(method.includes('.isFile()') && method.includes('.O_NONBLOCK') && method.includes('.fromTokenizer('), 'Unexpected file-type Node method');
  // Remove only the approved specifier, retaining the rest for leak scanning.
  const sanitized = method.replace(/([`'"])node:fs\/promises\1/, '$1FILE_TYPE_NODE_ONLY$1');
  return source.slice(0, start) + sanitized + source.slice(end);
}
