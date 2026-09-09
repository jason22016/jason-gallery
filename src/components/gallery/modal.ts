// Reference counting also covers the handoff from the loading dialog to the viewer.
const locks = new Set<symbol>();
let previousOverflow = '';
export function lockPageScroll() {
  const token = Symbol();
  if (locks.size === 0) previousOverflow = document.body.style.overflow;
  locks.add(token); document.body.style.overflow = 'hidden';
  return () => { locks.delete(token); if (locks.size === 0) document.body.style.overflow = previousOverflow; };
}
