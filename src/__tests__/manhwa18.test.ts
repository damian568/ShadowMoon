import { _resetIndex, manhwa18Provider as p } from '../providers/manhwa18';
import { fakeManga, instantTimers, mockFetch, searchOpts } from './helpers';

const BASE = 'https://manhwa18.net';

beforeEach(() => {
  instantTimers();
  _resetIndex();
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures --------------------------------------------------------------

/** A page the way the site serves it: its data as JSON inside the `data-page` attribute. */
const inertia = (props: object) => {
  const json = JSON.stringify({ component: 'X', props });
  const escaped = json.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<html><body><div id="app" data-page="${escaped}"></div></body></html>`;
};

const raw = (slug: string, name: string, over: Record<string, unknown> = {}) => ({
  slug,
  name,
  other_name: '',
  cover_url: `${BASE}/storage/images/raw/${slug}.jpg`,
  thumb_url: `${BASE}/storage/images/thumb/${slug}.jpg`,
  pilot: `<p>About <b>${name}</b>.</p>`,
  genres: [{ name: 'Manhwa' }, { name: 'Drama' }],
  latest_chapter: { name: 'Chapter 12' },
  ...over,
});

const list = (items: object[], page = 1, last = 1, total = items.length) =>
  inertia({ paginate: { current_page: page, data: items, last_page: last, total } });

const titlePage = (chapters: object[], manga: object = raw('my-title', 'My Title', { artists: [{ name: 'Beluga' }, { name: 'Unknown' }], tags: [{ name: 'Older Woman' }] })) =>
  inertia({ manga, chapters });

// --- search ------------------------------------------------------------------

describe('browsing', () => {
  it('reads the list from the embedded data', async () => {
    const f = mockFetch([['/manga-list', list([raw('a', 'A Title'), raw('b', 'B Title')], 1, 3, 70)]]);
    const page = await p.search(searchOpts());
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga-list?page=1`);
    expect(page.items[0]).toMatchObject({
      id: 'a',
      title: 'A Title',
      type: 'manhwa',
      tags: ['Drama'],
      description: 'About A Title.',
      coverUrl: `${BASE}/storage/images/raw/a.jpg`,
      coverUrlLarge: `${BASE}/storage/images/raw/a.jpg`,
      lastChapter: '12',
      contentRating: 'pornographic',
    });
    expect(page.total).toBe(70);
    expect(page.limit).toBe(24);
  });

  it('pages 24 at a time', async () => {
    const f = mockFetch([['/manga-list', list([raw('a', 'A')])]]);
    await p.search(searchOpts({ offset: 48 }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga-list?page=3`);
  });

  it('is an 18+ site: without mature titles it shows nothing and does not ask the site', async () => {
    const f = mockFetch([['/manga-list', list([raw('a', 'A')])]]);
    expect((await p.search(searchOpts({ ratings: ['safe', 'suggestive'] }))).items).toEqual([]);
    expect((await p.search(searchOpts({ ratings: ['safe', 'suggestive'], title: 'a' }))).items).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('filters by type using the genres, and keeps titles with no type', async () => {
    mockFetch([['/manga-list', list([raw('a', 'A'), raw('b', 'B', { genres: [{ name: 'Manga' }] }), raw('c', 'C', { genres: [] })])]]);
    const page = await p.search(searchOpts({ type: 'manhwa' }));
    expect(page.items.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('says clearly when a page has no data', async () => {
    mockFetch([['/manga-list', '<html><body>nothing</body></html>']]);
    await expect(p.search(searchOpts())).rejects.toThrow('Could not read this page from Manhwa18.');
  });
});

describe('searching by title (cached list)', () => {
  const pages = () =>
    mockFetch([
      ['page=1', list([raw('love-story', 'A Love Story'), raw('duke', 'The Duke', { other_name: 'Love of a Duke' })], 1, 2, 3)],
      ['page=2', list([raw('war', 'Love and War'), raw('love-story', 'A Love Story')], 2, 2, 3)],
    ]);

  it('builds the list from every page, then matches every word in the title or other name', async () => {
    const f = pages();
    expect((await p.search(searchOpts({ title: 'LOVE' }))).items.map((m) => m.id)).toEqual(['love-story', 'duke', 'war']);
    expect((await p.search(searchOpts({ title: 'love war' }))).items.map((m) => m.id)).toEqual(['war']);
    expect((await p.search(searchOpts({ title: 'nothing like this' }))).items).toEqual([]);
    expect(f.mock.calls.map((c) => c[0])).toEqual([`${BASE}/manga-list?page=1`, `${BASE}/manga-list?page=2`]);
  });

  it('never uses the forbidden search page', async () => {
    const f = pages();
    await p.search(searchOpts({ title: 'love' }));
    for (const [url] of f.mock.calls) expect(url).not.toContain('search');
  });

  it('reads the list only once, even for searches at the same time', async () => {
    const f = pages();
    await Promise.all([p.search(searchOpts({ title: 'a' })), p.search(searchOpts({ title: 'b' })), p.search(searchOpts({ title: 'duke' }))]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('uses what has loaded so far when the list takes too long, and keeps loading in the background', async () => {
    const now = jest.spyOn(Date, 'now');
    let clock = 1_000_000;
    now.mockImplementation(() => clock);
    const f = mockFetch([
      ['page=1', () => { clock += 11_000; return list([raw('first', 'First Love')], 1, 2, 2); }],
      ['page=2', list([raw('second', 'Second Love')], 2, 2, 2)],
    ]);
    const early = await p.search(searchOpts({ title: 'love' }));
    expect(early.items.map((m) => m.id)).toEqual(['first']);
    await new Promise<void>((r) => setImmediate(() => r())); // let the background loading finish
    await new Promise<void>((r) => setImmediate(() => r()));
    const full = await p.search(searchOpts({ title: 'love' }));
    expect(full.items.map((m) => m.id)).toEqual(['first', 'second']);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('fails clearly when the list cannot be loaded at all', async () => {
    mockFetch([['/manga-list', { status: 500, body: 'error' }]]);
    await expect(p.search(searchOpts({ title: 'love' }))).rejects.toThrow(/Manhwa18/);
  });

  it('pages the matches and reports their number as the total', async () => {
    pages();
    const first = await p.search(searchOpts({ title: 'love' }));
    expect(first.total).toBe(3);
    expect((await p.search(searchOpts({ title: 'love', offset: 24 }))).items).toEqual([]);
  });
});

// --- details and chapters ----------------------------------------------------

const chapterRows = [
  { id: 3, name: 'Chapter 3 - The End', slug: 'chapter-3-the-end', order: 3, created_at: '2026-11-05T07:21:11.000000Z' },
  { id: 2, name: 'Chapter 2.5', slug: 'chapter-2-5', order: 2, created_at: '2026-10-01T00:00:00.000000Z' },
  { id: 1, name: 'Chapter 1', slug: 'chapter-1-472', order: 1, created_at: '2025-08-10T10:31:26.000000Z' },
];

describe('getManga', () => {
  it('reads the details, artists, tags and latest chapter', async () => {
    const f = mockFetch([['/manga/my-title', titlePage(chapterRows)]]);
    const m = await p.getManga('my-title');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga/my-title`);
    expect(m).toMatchObject({
      id: 'my-title',
      title: 'My Title',
      type: 'manhwa',
      authors: ['Beluga'],
      tags: ['Drama', 'Older Woman'],
      lastChapter: '3',
      latestUploadedChapter: 'Chapter 3 - The End',
      contentRating: 'pornographic',
    });
  });

  it('fails clearly when the title is missing', async () => {
    mockFetch([['/manga/', inertia({})]]);
    await expect(p.getManga('x')).rejects.toThrow('Could not read this title from Manhwa18.');
  });
});

describe('getChapters', () => {
  it('lists every chapter oldest first, with numbers, subtitles and dates', async () => {
    mockFetch([['/manga/my-title', titlePage(chapterRows)]]);
    const list = await p.getChapters(fakeManga('my-title'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(['1', '2.5', '3']);
    expect(list[2]).toMatchObject({ id: 'my-title/chapter-3-the-end', title: 'The End', readableAt: '2026-11-05T07:21:11.000Z' });
    expect(list[0].title).toBeNull();
  });

  it('drops duplicate numbers and returns an empty list when there are no chapters', async () => {
    mockFetch([['/manga/my-title', titlePage([...chapterRows, { ...chapterRows[0], slug: 'chapter-3-again' }])]]);
    expect(await p.getChapters(fakeManga('my-title'), 'en')).toHaveLength(3);
    mockFetch([['/manga/my-title', titlePage([])]]);
    expect(await p.getChapters(fakeManga('my-title'), 'en')).toEqual([]);
  });
});

describe('getChapterPages', () => {
  it('returns the images from the page data, in order and without duplicates', async () => {
    const f = mockFetch([
      ['/manga/my-title/chapter-1', inertia({ chapterImages: [{ src: 'https://cdn.test/1.jpg' }, { src: 'https://cdn.test/2.jpg' }, { src: 'https://cdn.test/1.jpg' }] })],
    ]);
    await expect(p.getChapterPages('my-title/chapter-1', false)).resolves.toEqual(['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg']);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga/my-title/chapter-1`);
  });

  it('fails clearly when there are no images', async () => {
    mockFetch([['/manga/', inertia({ chapterImages: [] })]]);
    await expect(p.getChapterPages('a/b', false)).rejects.toThrow('No pages found for this chapter.');
  });
});

describe('metadata', () => {
  it('is named, has an icon and an 18+ description', () => {
    expect(p).toMatchObject({ id: 'manhwa18', name: 'Manhwa18' });
    expect(p.iconUrl).toContain('manhwa18.net');
    expect(p.description).toMatch(/18\+/);
  });
});
