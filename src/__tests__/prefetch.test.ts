import { Image } from 'expo-image';

import { _resetPrefetch, PREFETCH_AHEAD, prefetchPages } from '../utils/prefetch';

jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn() } }));
const prefetch = Image.prefetch as unknown as jest.Mock;

const pages = Array.from({ length: 10 }, (_, i) => `https://cdn.test/${i}.jpg`);
const settle = () => new Promise<void>((r) => setImmediate(() => r()));

beforeEach(() => {
  _resetPrefetch();
  prefetch.mockReset().mockResolvedValue(true);
});

describe('prefetchPages', () => {
  it('downloads the next pages to the disk cache, and only that many', () => {
    prefetchPages(pages, 3);
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith(pages.slice(3, 3 + PREFETCH_AHEAD), 'disk');
  });

  it('does not ask for the same page twice when the reader moves one page at a time', () => {
    prefetchPages(pages, 1); // pages 1-4
    prefetchPages(pages, 2); // only page 5 is new
    expect(prefetch).toHaveBeenLastCalledWith([pages[5]], 'disk');
    prefetchPages(pages, 2); // nothing new
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it('stops at the end of the chapter and ignores a start past it', () => {
    prefetchPages(pages, 8);
    expect(prefetch).toHaveBeenCalledWith([pages[8], pages[9]], 'disk');
    prefetchPages(pages, 50);
    prefetchPages([], 0);
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it('takes a custom count (the first pages of the next chapter)', () => {
    prefetchPages(pages, 0, 3);
    expect(prefetch).toHaveBeenCalledWith(pages.slice(0, 3), 'disk');
  });

  it('forgets pages that failed to download, so a later call tries them again', async () => {
    prefetch.mockResolvedValueOnce(false);
    prefetchPages(pages, 0, 2);
    await settle();
    prefetchPages(pages, 0, 2);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it('also forgets pages when the download throws, and never lets the error escape', async () => {
    prefetch.mockRejectedValueOnce(new Error('offline'));
    expect(() => prefetchPages(pages, 0, 2)).not.toThrow();
    await settle();
    prefetchPages(pages, 0, 2);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });
});
