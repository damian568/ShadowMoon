/**
 * Shared helpers for the unit tests. Nothing here touches the network:
 * `fetch` is replaced by `mockFetch`, and the providers' polite request throttling is made instant.
 */
import type { Manga, Page, Provider, SearchOptions } from '../providers/types';

/** Make `setTimeout` fire immediately, so the providers' throttling and retry delays don't slow tests down. */
export function instantTimers() {
  return jest.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout);
}

type Reply = string | { status: number; body?: string };

/**
 * Replace `fetch` with a fake. `routes` are checked in order; a route matches when the URL contains
 * the string (or matches the regex). A reply is HTML text (status 200), `{ status, body }`, or a function
 * returning either. Unmatched URLs get a 404, so a test notices an unexpected request.
 */
export function mockFetch(routes: [string | RegExp, Reply | (() => Reply)][]) {
  const fn = jest.fn(async (url: string) => {
    const hit = routes.find(([m]) => (typeof m === 'string' ? url.includes(m) : m.test(url)));
    const raw = hit ? (typeof hit[1] === 'function' ? hit[1]() : hit[1]) : { status: 404, body: `no route for ${url}` };
    const r = typeof raw === 'string' ? { status: 200, body: raw } : raw;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: async () => r.body ?? '',
      headers: { get: () => null },
    } as unknown as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

export const ALL_RATINGS = ['safe', 'suggestive', 'erotica', 'pornographic'] as const;

export const searchOpts = (over: Partial<SearchOptions> = {}): SearchOptions => ({
  language: 'en',
  ratings: [...ALL_RATINGS],
  ...over,
});

export function fakeManga(id: string, over: Partial<Manga> = {}): Manga {
  return {
    id,
    title: `Title ${id}`,
    description: '',
    coverUrl: '',
    coverUrlLarge: '',
    type: 'manhwa',
    originalLanguage: 'en',
    pubStatus: 'ongoing',
    year: null,
    contentRating: 'safe',
    tags: [],
    authors: [],
    lastChapter: null,
    latestUploadedChapter: null,
    availableLanguages: ['en'],
    chapterNumbersResetOnNewVolume: false,
    ...over,
  };
}

export const pageOf = (items: Manga[], total = items.length, offset = 0, limit = 20): Page<Manga> => ({
  items,
  total,
  offset,
  limit,
});

/** A provider whose methods are jest mocks (empty results by default). */
export function fakeProvider(id: string, over: Partial<Provider> = {}): Provider {
  return {
    id,
    name: id,
    description: '',
    languages: [{ code: 'en', label: 'English' }],
    types: ['manga', 'manhwa', 'manhua'],
    sorts: ['relevance'],
    search: jest.fn(async (o: SearchOptions) => pageOf([], 0, o.offset ?? 0)),
    getManga: jest.fn(async (mangaId: string) => fakeManga(mangaId)),
    getChapters: jest.fn(async () => []),
    getChapterPages: jest.fn(async () => []),
    ...over,
  };
}

/**
 * Encode data the way Astro serializes island props: every value is wrapped as [0, value],
 * arrays as [1, [...]], and the whole thing is JSON with `"` escaped for use in an HTML attribute.
 */
export function astroIsland(component: string, props: Record<string, unknown>): string {
  const enc = (x: unknown): unknown =>
    Array.isArray(x)
      ? [1, x.map(enc)]
      : x && typeof x === 'object'
        ? [0, Object.fromEntries(Object.entries(x).map(([k, v]) => [k, enc(v)]))]
        : [0, x];
  const json = JSON.stringify(Object.fromEntries(Object.entries(props).map(([k, v]) => [k, enc(v)])));
  return `<astro-island component-url="/_astro/${component}.abc123.js" props="${json.replace(/"/g, '&quot;')}"></astro-island>`;
}
