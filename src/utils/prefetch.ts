import { Image } from 'expo-image';

/** How many pages ahead of the one being read are downloaded in advance. */
export const PREFETCH_AHEAD = 4;

// Addresses already asked for, so scrolling back and forth never downloads the same page twice.
const requested = new Set<string>();
const MAX_REMEMBERED = 600;

/**
 * Download `count` pages starting at `from` into the disk cache (not into memory), so they are ready when the reader
 * scrolls to them. Pages already requested are skipped; ones that fail are forgotten so a later call tries again.
 */
export function prefetchPages(pages: readonly string[], from: number, count: number = PREFETCH_AHEAD): void {
  const urls = pages.slice(Math.max(0, from), Math.max(0, from) + count).filter((u) => u && !requested.has(u));
  if (urls.length === 0) return;
  if (requested.size > MAX_REMEMBERED) requested.clear();
  for (const u of urls) requested.add(u);
  const forget = () => urls.forEach((u) => requested.delete(u));
  Image.prefetch(urls, 'disk')
    .then((ok) => {
      if (!ok) forget();
    })
    .catch(forget);
}

/** For tests: forget what was already requested. */
export function _resetPrefetch() {
  requested.clear();
}
