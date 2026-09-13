/** Keep editor lists and public galleries in the same display order. */
export function compareProjectOrder(a: { order: number; slug: string }, b: { order: number; slug: string }): number {
  return a.order < b.order ? -1 : a.order > b.order ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}
