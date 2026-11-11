/**
 * The chapters to mark as read when one is ticked in the list: that chapter and every chapter shown below it.
 * `shown` is the list in the order it is displayed (newest first, so "below" means older, or the other way round).
 * Returns just the tapped chapter's key when it is not in the list.
 */
export function keysFromHere(shown: readonly { key: string }[], key: string): string[] {
  const i = shown.findIndex((c) => c.key === key);
  return i < 0 ? [key] : shown.slice(i).map((c) => c.key);
}
