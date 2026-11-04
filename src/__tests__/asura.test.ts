import { asuraProvider as p } from '../providers/asura';
import { fakeManga, astroIsland, instantTimers, mockFetch, searchOpts } from './helpers';

const BASE = 'https://asurascans.com';

beforeEach(() => {
  instantTimers();
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures --------------------------------------------------------------

const series = (slug: string, over: Record<string, unknown> = {}) => ({
  title: `Title ${slug}`,
  alt_titles: ['日本語タイトル', `Alt ${slug}`],
  description: '  A synopsis.  ',
  cover: `https://cdn.test/covers/${slug}.9ead-400.webp`,
  status: 'Ongoing',
  type: 'manhwa',
  author: 'Au Thor',
  artist: 'Ar Tist',
  chapter_count: 40,
  last_chapter_at: '2026-11-03T17:25:01Z',
  public_url: `/comics/${slug}-ab12`,
  genres: [{ id: 1, name: 'Action' }, { id: 2, name: 'Fantasy' }],
  latest_chapters: [{ number: 40 }, { number: 39 }],
  ...over,
});

const browsePage = (items: unknown[], totalCount = items.length) =>
  `<html><body>${astroIsland('BrowseFilters', { totalCount, initialSeries: items })}</body></html>`;

// --- search ------------------------------------------------------------------

describe('search', () => {
  it('reads the embedded series data', async () => {
    mockFetch([['/browse', browsePage([series('solo')], 362)]]);
    const page = await p.search(searchOpts());
    expect(page.total).toBe(362);
    expect(page.items[0]).toEqual({
      id: 'solo-ab12',
      title: 'Title solo',
      altTitle: 'Alt solo', // the first plain-ASCII alternative title
      description: 'A synopsis.',
      coverUrl: 'https://cdn.test/covers/solo.9ead-400.webp',
      coverUrlLarge: 'https://cdn.test/covers/solo.9ead.webp',
      type: 'manhwa',
      originalLanguage: 'en',
      pubStatus: 'ongoing',
      year: null,
      contentRating: 'safe',
      tags: ['Action', 'Fantasy'],
      authors: ['Au Thor', 'Ar Tist'],
      lastChapter: '40',
      latestUploadedChapter: '2026-11-03T17:25:01Z',
      availableLanguages: ['en'],
      chapterNumbersResetOnNewVolume: false,
    });
  });

  it('browses by sort order, defaulting to the latest updates', async () => {
    const f = mockFetch([['/browse', browsePage([])]]);
    for (const order of ['followedCount', 'rating', 'latestUploadedChapter', undefined] as const) {
      await p.search(searchOpts({ order }));
    }
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/browse?page=1&sort=popular`,
      `${BASE}/browse?page=1&sort=rating`,
      `${BASE}/browse?page=1&sort=update`,
      `${BASE}/browse?page=1&sort=update`,
    ]);
  });

  it('searches by title (no sort) and filters by type on the server', async () => {
    const f = mockFetch([['/browse', browsePage([])]]);
    await p.search(searchOpts({ title: ' solo ', type: 'manhua' }));
    const url = new URL(f.mock.calls[0][0]);
    expect(url.searchParams.get('search')).toBe('solo');
    expect(url.searchParams.get('type')).toBe('manhua');
    expect(url.searchParams.has('sort')).toBe(false);
  });

  it('does not send a type for "all" or "other"', async () => {
    const f = mockFetch([['/browse', browsePage([])]]);
    await p.search(searchOpts({ type: 'all' }));
    await p.search(searchOpts({ type: 'other' }));
    for (const [url] of f.mock.calls) expect(url).not.toContain('type=');
  });

  it('turns the offset into a page number (20 per page)', async () => {
    const f = mockFetch([['/browse', browsePage([])]]);
    await p.search(searchOpts({ offset: 40 }));
    expect(f.mock.calls[0][0]).toContain('page=3');
  });

  it('hides titles above the allowed content ratings', async () => {
    mockFetch([
      ['/browse', browsePage([series('safe-one'), series('ecchi-one', { genres: [{ name: 'Ecchi' }] }), series('adult-one', { genres: [{ name: 'Adult' }] })])],
    ]);
    expect((await p.search(searchOpts({ ratings: ['safe'] }))).items.map((m) => m.id)).toEqual(['safe-one-ab12']);
    expect((await p.search(searchOpts({ ratings: ['safe', 'suggestive'] }))).items).toHaveLength(2);
  });

  it('falls back to the number of titles when the page gives no total', async () => {
    mockFetch([['/browse', `<html>${astroIsland('BrowseFilters', { initialSeries: [series('a'), series('b')] })}</html>`]]);
    expect((await p.search(searchOpts({ offset: 20 }))).total).toBe(22);
  });

  it('copes with a page that has no embedded data', async () => {
    mockFetch([['/browse', '<html><body>nothing</body></html>']]);
    await expect(p.search(searchOpts())).resolves.toMatchObject({ items: [], offset: 0, limit: 20 });
  });

  it('skips entries without a usable link and keeps the rest', async () => {
    mockFetch([['/browse', browsePage([series('a', { public_url: undefined }), series('b')])]]);
    expect((await p.search(searchOpts())).items.map((m) => m.id)).toEqual(['b-ab12']);
  });

  it('ignores placeholder authors', async () => {
    mockFetch([['/browse', browsePage([series('a', { author: 'N/A', artist: 'Ar Tist' })])]]);
    expect((await p.search(searchOpts())).items[0].authors).toEqual(['Ar Tist']);
  });
});

// --- title page -----------------------------------------------------------------

const chapterList = (chapters: unknown[]) => astroIsland('ChapterListReact', { coverUrl: 'https://cdn.test/covers/solo.9ead-400.webp', chapters });
const ch = (number: number, over: Record<string, unknown> = {}) => ({
  number,
  page_count: 20,
  is_premium: false,
  published_at: '2026-10-01T00:00:00Z',
  ...over,
});

describe('getManga', () => {
  const titlePage = `
    <html><head><meta name="description" content="The Earth is under threat."></head><body>
      <h1 class="text-xl"> Solo Leveling: Ragnarok </h1>
      <div>Status hiatus Type manhwa Author Dangdo Artist Redice Studio Action Adventure Fantasy</div>
      <a href="/genres/action">Action</a><a href="/genres/fantasy">Fantasy</a>
      ${chapterList([ch(71), ch(5), ch(70)])}
    </body></html>`;

  it('reads the details from the page and its embedded data', async () => {
    const f = mockFetch([['/comics/solo-ab12', titlePage]]);
    const m = await p.getManga('solo-ab12');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/comics/solo-ab12`);
    expect(m).toMatchObject({
      id: 'solo-ab12',
      title: 'Solo Leveling: Ragnarok',
      description: 'The Earth is under threat.',
      pubStatus: 'hiatus',
      type: 'manhwa',
      authors: ['Dangdo', 'Redice Studio'],
      tags: ['Action', 'Fantasy'],
      coverUrl: 'https://cdn.test/covers/solo.9ead-400.webp',
      coverUrlLarge: 'https://cdn.test/covers/solo.9ead.webp',
      lastChapter: '71', // the highest number, whatever the list order
    });
  });

  it('fails clearly on a page without a title', async () => {
    mockFetch([['/comics/', '<p>nope</p>']]);
    await expect(p.getManga('x')).rejects.toThrow('Could not read this title from Asura Scans.');
  });
});

describe('getChapters', () => {
  const FUTURE = '2999-01-01T00:00:00Z';
  const PAST = '2000-01-01T00:00:00Z';

  it('lists chapters in reading order with ids, page counts and dates', async () => {
    mockFetch([['/comics/solo-ab12', `<h1>T</h1>${chapterList([ch(3), ch(1, { page_count: 0 }), ch(2, { page_count: 18 })])}`]]);
    const list = await p.getChapters(fakeManga('solo-ab12'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(['1', '2', '3']);
    expect(list[1]).toMatchObject({ id: 'solo-ab12/2', key: '2', pages: 18, externalUrl: null, readableAt: '2026-10-01T00:00:00Z' });
    expect(list[0].pages).toBe(1); // unknown page count is still "readable"
  });

  it('flags premium and still-early-access chapters as locked and links them to the website', async () => {
    mockFetch([
      [
        '/comics/solo-ab12',
        `<h1>T</h1>${chapterList([
          ch(1),
          ch(2, { is_premium: true }),
          ch(3, { early_access_until: FUTURE }),
          ch(4, { early_access_until: PAST }),
        ])}`,
      ],
    ]);
    const list = await p.getChapters(fakeManga('solo-ab12'), 'en');
    expect(list.map((c) => c.externalUrl)).toEqual([
      null,
      `${BASE}/comics/solo-ab12/chapter/2`,
      `${BASE}/comics/solo-ab12/chapter/3`,
      null, // early access has already ended
    ]);
  });

  it('sorts fractional chapters numerically and drops duplicates', async () => {
    mockFetch([['/comics/solo-ab12', `<h1>T</h1>${chapterList([ch(10), ch(2.5), ch(2), ch(10, { page_count: 99 })])}`]]);
    const list = await p.getChapters(fakeManga('solo-ab12'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(['2', '2.5', '10']);
    expect(list[2].pages).toBe(20); // the first duplicate wins
  });

  it('returns an empty list when the page has no chapter data', async () => {
    mockFetch([['/comics/solo-ab12', '<h1>T</h1>']]);
    await expect(p.getChapters(fakeManga('solo-ab12'), 'en')).resolves.toEqual([]);
  });
});

describe('getChapterPages', () => {
  it('returns chapter images only (not covers or icons), without duplicates', async () => {
    const f = mockFetch([
      [
        '/comics/solo-ab12/chapter/68',
        `<img src="https://cdn.asurascans.com/asura-images/covers/solo.webp">
         <img src="https://cdn.asurascans.com/asura-images/chapters/solo/68/001.webp?v=1">
         <img src="https://cdn.asurascans.com/asura-images/chapters/solo/68/002.webp?v=1">
         <img src="https://cdn.asurascans.com/asura-images/chapters/solo/68/001.webp?v=1">
         <img src="/images/logo.webp">`,
      ],
    ]);
    await expect(p.getChapterPages('solo-ab12/68', false)).resolves.toEqual([
      'https://cdn.asurascans.com/asura-images/chapters/solo/68/001.webp?v=1',
      'https://cdn.asurascans.com/asura-images/chapters/solo/68/002.webp?v=1',
    ]);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/comics/solo-ab12/chapter/68`);
  });

  it('says the chapter may be locked when there are no images', async () => {
    mockFetch([['/chapter/', '<p>Unlock this chapter</p>']]);
    await expect(p.getChapterPages('solo-ab12/71', false)).rejects.toThrow(/may be locked/);
  });
});
