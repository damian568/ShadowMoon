import { fakeManga, instantTimers, mockFetch, searchOpts } from './helpers';

type VortexModule = typeof import('../providers/vortex');

const BASE = 'https://vortexscans.org';

// The provider caches the whole listing in module state, so load a fresh copy for every test.
let p: VortexModule['vortexProvider'];
beforeEach(() => {
  jest.resetModules();
  instantTimers();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh module copy is the point
  p = (require('../providers/vortex') as VortexModule).vortexProvider;
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures --------------------------------------------------------------

const card = (slug: string, title: string, type = 'Manhwa') =>
  `<a href="/series/${slug}" class="relative block" title="${title}"><div><img src="https://s.test/upload/2025/${slug}.png" alt="${title}"><span class="b"><span class="c">${type}</span></span></div></a>`;

/** A listing page: series cards, a chapter row (must be ignored) and pagination links. */
const listPage = (cards: string[], lastPage = 2) => `
  <html><body>
    ${cards.join('')}
    <a href="/series/alpha-hero/chapter-12" class="row">Chapter 12</a>
    <a href="/series/zzz"><span>no image here</span></a>
    ${Array.from({ length: lastPage }, (_, i) => `<a href="/series?page=${i + 1}">${i + 1}</a>`).join('')}
  </body></html>`;

const twoPages = () =>
  mockFetch([
    ['/series/?page=1', listPage([card('alpha-hero', 'Alpha Hero'), card('beta-mage', 'Beta Mage', 'Manhua')])],
    ['/series/?page=2', listPage([card('gamma-hero', "Gamma Hero's Tale", 'Manga'), card('alpha-hero', 'Alpha Hero')])],
  ]);

// --- listing and search -------------------------------------------------------

describe('browsing', () => {
  it('loads every listing page once and de-duplicates titles', async () => {
    const f = twoPages();
    const page = await p.search(searchOpts());
    expect(f.mock.calls.map((c) => c[0])).toEqual([`${BASE}/series/?page=1`, `${BASE}/series/?page=2`]);
    expect(page.items.map((m) => m.id)).toEqual(['alpha-hero', 'beta-mage', 'gamma-hero']);
    expect(page.total).toBe(3);
  });

  it('reads title, cover and type from each card, and skips chapter rows and image-less links', async () => {
    twoPages();
    const [alpha, beta, gamma] = (await p.search(searchOpts())).items;
    expect(alpha).toMatchObject({ title: 'Alpha Hero', type: 'manhwa', coverUrl: 'https://s.test/upload/2025/alpha-hero.png' });
    expect(beta.type).toBe('manhua');
    expect(gamma.type).toBe('manga');
  });

  it('always uses the https trailing-slash URL (the other form redirects to http)', async () => {
    const f = twoPages();
    await p.search(searchOpts());
    for (const [url] of f.mock.calls) expect(url).toMatch(/^https:\/\/vortexscans\.org\/series\/\?page=\d+$/);
  });

  it('pages the cached list in chunks of 30', async () => {
    const many = Array.from({ length: 35 }, (_, i) => card(`s${i}`, `Series ${i}`));
    mockFetch([['/series/?page=1', listPage(many, 1)]]);
    const first = await p.search(searchOpts());
    const second = await p.search(searchOpts({ offset: 30 }));
    expect(first.items).toHaveLength(30);
    expect(second.items).toHaveLength(5);
    expect(first.total).toBe(35);
  });

  it('keeps what it loaded when a later page fails', async () => {
    mockFetch([
      ['/series/?page=1', listPage([card('alpha-hero', 'Alpha Hero')], 3)],
      ['/series/?page=2', { status: 500 }],
    ]);
    const page = await p.search(searchOpts());
    expect(page.items.map((m) => m.id)).toEqual(['alpha-hero']);
  });

  it('filters by type, keeping titles whose type is unknown', async () => {
    twoPages();
    expect((await p.search(searchOpts({ type: 'manhua' }))).items.map((m) => m.id)).toEqual(['beta-mage']);
  });

  it('hides titles above the allowed content ratings', async () => {
    twoPages();
    expect((await p.search(searchOpts({ ratings: ['safe'] }))).items).toHaveLength(3); // all cards are "safe" by default
  });
});

describe('searching by title', () => {
  it('filters the cached list: case-insensitive, every word must match', async () => {
    const f = twoPages();
    expect((await p.search(searchOpts({ title: 'HERO' }))).items.map((m) => m.id)).toEqual(['alpha-hero', 'gamma-hero']);
    expect((await p.search(searchOpts({ title: 'gamma hero' }))).items.map((m) => m.id)).toEqual(['gamma-hero']);
    expect((await p.search(searchOpts({ title: 'hero gamma' }))).items.map((m) => m.id)).toEqual(['gamma-hero']);
    expect((await p.search(searchOpts({ title: 'nothing here' }))).items).toEqual([]);
    expect(f).toHaveBeenCalledTimes(2); // the list was fetched once, not per search
  });

  it('reports the number of matches as the total and pages through them', async () => {
    twoPages();
    const first = await p.search(searchOpts({ title: 'hero' }));
    expect(first.total).toBe(2);
    expect((await p.search(searchOpts({ title: 'hero', offset: 30 }))).items).toEqual([]);
  });

  it('shares one load between concurrent searches', async () => {
    const f = twoPages();
    await Promise.all([p.search(searchOpts({ title: 'a' })), p.search(searchOpts({ title: 'b' })), p.search(searchOpts())]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('surfaces an error when the first page cannot be loaded', async () => {
    mockFetch([['/series/', { status: 403 }]]);
    await expect(p.search(searchOpts({ title: 'x' }))).rejects.toThrow(/Vortex Scans blocked the request/);
  });
});

// --- details, chapters, pages ----------------------------------------------------

describe('getManga', () => {
  const titlePage = `
    <html><head><meta name="description" content="A hero rises & falls."></head><body>
      <img src="https://s.test/upload/settings/logo/site.png">
      <h1>The Hero’s Ballad</h1>
      <img src="https://i0.wp.com/s.test/upload/series/featured/abc/cover.png">
      <div>Status</div><div>ONGOING</div><div>Type</div><div>Manhwa</div><div>Chapters</div><div>16</div>
      <a href="/series/the-hero's-ballad/chapter-15">Chapter 15</a>
      <a href="/series/the-hero's-ballad/chapter-2">Chapter 2</a>
      <a href="/series/the-hero's-ballad/chapter-10">Chapter 10</a>
    </body></html>`;

  it('reads the details (the cover is the featured image, not the site logo)', async () => {
    const f = mockFetch([["/series/the-hero's-ballad", titlePage]]);
    const m = await p.getManga("the-hero's-ballad");
    expect(f.mock.calls[0][0]).toBe(`${BASE}/series/the-hero's-ballad`);
    expect(m).toMatchObject({
      id: "the-hero's-ballad",
      title: 'The Hero’s Ballad',
      type: 'manhwa',
      pubStatus: 'ongoing',
      description: 'A hero rises & falls.',
      coverUrl: 'https://i0.wp.com/s.test/upload/series/featured/abc/cover.png',
      lastChapter: '15',
    });
  });

  it('fails clearly on a page without a title', async () => {
    mockFetch([['/series/', '<p>Oops! Nothing here.</p>']]);
    await expect(p.getManga('x')).rejects.toThrow('Could not read this title from Vortex Scans.');
  });
});

describe('getChapters', () => {
  it('lists unique chapters in reading order', async () => {
    mockFetch([
      [
        '/series/alpha-hero',
        `<a href="/series/alpha-hero/chapter-2">Chapter 2about 2 months</a>
         <a href="/series/alpha-hero/chapter-1">Chapter 1 3 days ago</a>
         <a href="/series/alpha-hero/chapter-1">Start Reading</a>
         <a href="/series/alpha-hero/chapter-10">Chapter 10</a>
         <a href="/series/other/chapter-3">Chapter 3</a>`,
      ],
    ]);
    const list = await p.getChapters(fakeManga('alpha-hero'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(['1', '2', '10']);
    expect(list[0]).toMatchObject({ id: 'alpha-hero/chapter-1', key: '1', externalUrl: null });
  });
});

describe('getChapterPages', () => {
  it('returns chapter images and skips cover art and duplicates', async () => {
    const f = mockFetch([
      [
        '/series/alpha-hero/chapter-1',
        `<img src="https://s.test/upload/series/featured/abc/cover.png">
         <img src="https://s.test/upload/series/alpha-hero/h1/page-1.webp">
         <img src="https://s.test/upload/series/alpha-hero/h1/page-2.webp">
         <img src="https://s.test/upload/series/alpha-hero/h1/page-1.webp">
         <img src="https://s.test/assets/logo.png">`,
      ],
    ]);
    await expect(p.getChapterPages('alpha-hero/chapter-1', false)).resolves.toEqual([
      'https://s.test/upload/series/alpha-hero/h1/page-1.webp',
      'https://s.test/upload/series/alpha-hero/h1/page-2.webp',
    ]);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/series/alpha-hero/chapter-1`);
  });

  it('url-encodes the series slug', async () => {
    const f = mockFetch([['/series/', '<img src="https://s.test/upload/series/x/h/p.webp">']]);
    await p.getChapterPages("the-hero's-ballad/chapter-1", false);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/series/the-hero's-ballad/chapter-1`);
  });

  it('explains that the chapter may be locked when no pages are found', async () => {
    mockFetch([['/series/', '<img src="https://s.test/upload/series/featured/abc/cover.png">']]);
    await expect(p.getChapterPages('alpha-hero/chapter-9', false)).rejects.toThrow(/may be locked/);
  });
});
