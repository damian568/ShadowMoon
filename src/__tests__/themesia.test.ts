import { createThemesiaProvider } from '../providers/themesia';
import { fakeManga, ALL_RATINGS, instantTimers, mockFetch, searchOpts } from './helpers';

const BASE = 'https://site.test';
const site = createThemesiaProvider({ id: 'test', name: 'Test Site', description: 'd', base: BASE, iconUrl: 'https://site.test/i.png' });
const comics = createThemesiaProvider({ id: 'test2', name: 'Comics Site', description: 'd', base: BASE, seriesPath: 'comics' });

beforeEach(() => {
  instantTimers();
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures --------------------------------------------------------------

const card = (slug: string, title: string, opts: { type?: string; chapter?: string; path?: string } = {}) => `
  <div class="bsx">
    <a href="${BASE}/${opts.path ?? 'manga'}/${slug}/" title="${title}">
      <div class="limit">${opts.type ? `<span class="type ${opts.type}"></span>` : ''}<img src="https://img.test/${slug}.jpg"></div>
      <div class="bigor"><div class="tt">${title}</div><div class="adds"><div class="epxs">${opts.chapter ?? 'Chapter 5'}</div></div></div>
    </a>
  </div>`;

const listing = (cards: string, next = false) =>
  `<html><body><div class="listupd">${cards}</div>${next ? '<a class="next page-numbers" href="?page=3">Next</a>' : ''}</body></html>`;

const titlePage = (extra = '') => `
  <html><body>
    <div class="thumb"><img src="https://img.test/cover.jpg"></div>
    <h1 class="entry-title" itemprop="name">Test Title</h1>
    <span class="alternative">Alt Name</span>
    <div class="seriestugenre"><a rel="tag">Action</a><a rel="tag">Mature</a></div>
    <table class="infotable">
      <tr><td>Status</td><td>Ongoing</td></tr><tr><td>Type</td><td>Manhwa</td></tr>
      <tr><td>Released</td><td>2023</td></tr><tr><td>Author</td><td>Jane Doe, Joe Bloggs</td></tr>
    </table>
    <div class="entry-content entry-content-single" itemprop="description"><p>Read manhwa Test Title<br />The real synopsis starts here.</p></div>
    <ul>
      <li data-num="2"><div class="chbox"><div class="eph-num"><a href="${BASE}/test-title-chapter-2/"><span class="chapternum">Chapter 2</span><span class="chapterdate">September 10, 2026</span></a></div></div></li>
      <li data-num="1"><div class="chbox"><div class="eph-num"><a href="${BASE}/test-title-chapter-1/"><span class="chapternum">Chapter 1 - The Start</span><span class="chapterdate">September 3, 2026</span></a></div></div></li>
      ${extra}
    </ul>
  </body></html>`;

// --- provider metadata -------------------------------------------------------

describe('provider metadata', () => {
  it('exposes its id, name and icon', () => {
    expect(site).toMatchObject({ id: 'test', name: 'Test Site', iconUrl: 'https://site.test/i.png' });
    expect(site.languages).toEqual([{ code: 'en', label: 'English' }]);
  });
});

// --- search ------------------------------------------------------------------

describe('search: browsing', () => {
  it('parses cards into titles', async () => {
    mockFetch([['/manga/?page=1', listing(card('a-title', 'A Title', { type: 'Manhwa', chapter: 'Chapter 12' }) + card('b-title', 'B Title'))]]);
    const page = await site.search(searchOpts({ order: 'followedCount' }));
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      id: 'a-title',
      title: 'A Title',
      type: 'manhwa',
      coverUrl: 'https://img.test/a-title.jpg',
      lastChapter: '12',
      latestUploadedChapter: 'Chapter 12',
    });
    expect(page.items[1].type).toBe('other'); // the card shows no type
  });

  it('maps the app sort orders to the site\'s', async () => {
    const f = mockFetch([['/manga/', listing('')]]);
    for (const [order, expected] of [
      ['followedCount', 'order=popular'],
      ['latestUploadedChapter', 'order=update'],
      ['rating', 'order=rating'],
      ['createdAt', 'order=latest'],
    ] as const) {
      await site.search(searchOpts({ order }));
      expect(f.mock.calls.at(-1)![0]).toContain(expected);
    }
  });

  it('turns the offset into a page number', async () => {
    const f = mockFetch([['/manga/', listing('')]]);
    await site.search(searchOpts({ offset: 40 }));
    expect(f.mock.calls[0][0]).toContain('page=3');
  });

  it('reports more results when there is a next page, and none when there is not', async () => {
    mockFetch([['/manga/', listing(card('a', 'A'), true)]]);
    const more = await site.search(searchOpts());
    expect(more.total).toBeGreaterThan(more.items.length);
    mockFetch([['/manga/', listing(card('a', 'A'), false)]]);
    const last = await site.search(searchOpts({ offset: 20 }));
    expect(last.total).toBe(21);
  });

  it('asks the site to filter by type (capitalised) and treats untyped cards as that type', async () => {
    const f = mockFetch([['/manga/', listing(card('a', 'A') + card('b', 'B', { type: 'Manhwa' }))]]);
    const page = await site.search(searchOpts({ type: 'manhua' }));
    expect(f.mock.calls[0][0]).toContain('type=Manhua');
    // "A" has no visible type, so it is stamped as the requested type; "B" is a known manhwa and is dropped.
    expect(page.items.map((m) => [m.id, m.type])).toEqual([['a', 'manhua']]);
  });

  it('does not send a type filter for "all"', async () => {
    const f = mockFetch([['/manga/', listing('')]]);
    await site.search(searchOpts({ type: 'all' }));
    expect(f.mock.calls[0][0]).not.toContain('type=');
  });

  it('uses the site\'s own series path (e.g. /comics/)', async () => {
    const f = mockFetch([['/comics/', listing(card('c', 'C', { path: 'comics' }))]]);
    const page = await comics.search(searchOpts());
    expect(f.mock.calls[0][0]).toContain(`${BASE}/comics/?page=1`);
    expect(page.items[0].id).toBe('c');
  });

  it('skips cards that are not series links', async () => {
    mockFetch([['/manga/', listing('<div class="bsx"><a href="https://site.test/blog/x/">News</a></div>' + card('ok', 'Ok'))]]);
    expect((await site.search(searchOpts())).items.map((m) => m.id)).toEqual(['ok']);
  });
});

describe('search: by title', () => {
  it('uses the site search and encodes the query', async () => {
    const f = mockFetch([['?s=', listing(card('x', 'X'))]]);
    await site.search(searchOpts({ title: '  love & war ' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/?s=love%20%26%20war`);
  });

  it('pages through search results', async () => {
    const f = mockFetch([['?s=', listing('')]]);
    await site.search(searchOpts({ title: 'love', offset: 20 }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/page/2/?s=love`);
  });

  it('keeps untyped results (the registry resolves their type) but drops known mismatches', async () => {
    mockFetch([['?s=', listing(card('a', 'A') + card('b', 'B', { type: 'Manga' }) + card('c', 'C', { type: 'Manhwa' }))]]);
    const page = await site.search(searchOpts({ title: 'x', type: 'manhwa' }));
    expect(page.items.map((m) => m.id)).toEqual(['a', 'c']);
  });
});

// --- title details -------------------------------------------------------------

describe('getManga', () => {
  it('reads the details from the title page', async () => {
    const f = mockFetch([['/manga/test-title/', titlePage()]]);
    const m = await site.getManga('test-title');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga/test-title/`);
    expect(m).toMatchObject({
      id: 'test-title',
      title: 'Test Title',
      altTitle: 'Alt Name',
      coverUrl: 'https://img.test/cover.jpg',
      type: 'manhwa',
      pubStatus: 'ongoing',
      year: 2023,
      tags: ['Action', 'Mature'],
      authors: ['Jane Doe', 'Joe Bloggs'],
      lastChapter: '2',
    });
  });

  it('derives a content rating from the genres', async () => {
    mockFetch([['/manga/test-title/', titlePage()]]);
    expect((await site.getManga('test-title')).contentRating).toBe('suggestive'); // "Mature"
  });

  it('drops the "Read manhwa <title>" line that opens the synopsis', async () => {
    mockFetch([['/manga/test-title/', titlePage()]]);
    expect((await site.getManga('test-title')).description).toBe('The real synopsis starts here.');
  });

  it('reads the status from a badge when there is no info table', async () => {
    mockFetch([
      [
        '/manga/b/',
        `<h1 class="entry-title">B</h1><div class="imptdt"><div class="status"><span></span> <i>Completed</i></div></div>
         <div class="imptdt"><h1> Type </h1> <i>Manhua</i></div>`,
      ],
    ]);
    const m = await site.getManga('b');
    expect(m.pubStatus).toBe('completed');
    expect(m.type).toBe('manhua');
  });

  it('url-encodes the id and fails clearly when the page has no title', async () => {
    const f = mockFetch([['/manga/', '<html><body>nothing</body></html>']]);
    await expect(site.getManga('weird slug')).rejects.toThrow('Could not read this title from Test Site.');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga/weird%20slug/`);
  });
});

// --- chapters --------------------------------------------------------------------

describe('getChapters', () => {
  const locked = `<li data-num="3"><a data-bs-toggle="modal" data-bs-target="#lockedChapterModal" data-id="9" data-coin="50" data-title="Chapter 3"><span class="chapternum">Chapter 3</span></a></li>`;

  it('lists chapters in reading order with ids, keys and subtitles', async () => {
    mockFetch([['/manga/test-title/', titlePage()]]);
    const list = await site.getChapters(fakeManga('test-title'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(['1', '2']);
    expect(list[0]).toMatchObject({ id: 'test-title-chapter-1', key: '1', title: 'The Start', externalUrl: null });
    expect(list[1]).toMatchObject({ id: 'test-title-chapter-2', key: '2', title: null });
    expect(new Date(list[1].readableAt).getFullYear()).toBe(2026);
  });

  it('lists paid chapters as locked and sends them to the series page', async () => {
    mockFetch([['/manga/test-title/', titlePage(locked)]]);
    const list = await site.getChapters(fakeManga('test-title'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(['1', '2', '3']);
    expect(list[2]).toMatchObject({ id: 'locked/3', externalUrl: `${BASE}/manga/test-title/` });
    expect(list.filter((c) => c.externalUrl)).toHaveLength(1);
  });

  it('ignores duplicate chapter numbers and links that are not chapters', async () => {
    const dup = `<li data-num="2"><a href="${BASE}/test-title-chapter-2-v2/"><span class="chapternum">Chapter 2</span></a></li><li data-num="x"><span>no link</span></li>`;
    mockFetch([['/manga/test-title/', titlePage(dup)]]);
    const list = await site.getChapters(fakeManga('test-title'), 'en');
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.chapter === '2')!.id).toBe('test-title-chapter-2'); // the first one wins
  });

  it('returns an empty list when the title has no chapters yet', async () => {
    mockFetch([['/manga/empty/', '<h1 class="entry-title">Empty</h1>']]);
    await expect(site.getChapters(fakeManga('empty'), 'en')).resolves.toEqual([]);
  });
});

// --- pages -------------------------------------------------------------------------

describe('getChapterPages', () => {
  const reader = (json: string) => `<html><script>ts_reader.run(${json});</script></html>`;

  it('reads the image list embedded as JSON', async () => {
    const f = mockFetch([
      ['/test-title-chapter-1/', reader('{"post_id":1,"sources":[{"source":"S1","images":["https:\\/\\/cdn.test\\/1.jpg","https:\\/\\/cdn.test\\/2.jpg"]}]}')],
    ]);
    await expect(site.getChapterPages('test-title-chapter-1', false)).resolves.toEqual(['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg']);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/test-title-chapter-1/`);
  });

  it('uses the first source that has images', async () => {
    mockFetch([['/c/', reader('{"sources":[{"images":[]},{"images":["https:\\/\\/cdn.test\\/x.jpg"]}]}')]]);
    await expect(site.getChapterPages('c', false)).resolves.toEqual(['https://cdn.test/x.jpg']);
  });

  it('falls back to the reader <img> tags', async () => {
    mockFetch([['/c/', '<img src="https://cdn.test/a.jpg" class="ts-main-image"><img src="https://cdn.test/b.jpg" class="ts-main-image">']]);
    await expect(site.getChapterPages('c', false)).resolves.toEqual(['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg']);
  });

  it('fails clearly when there are no pages (e.g. a locked chapter)', async () => {
    mockFetch([['/c/', '<p>This chapter is locked.</p>']]);
    await expect(site.getChapterPages('c', false)).rejects.toThrow('No pages found for this chapter.');
  });

  it('surfaces site errors with the site name', async () => {
    mockFetch([['/c/', { status: 403 }]]);
    await expect(site.getChapterPages('c', false)).rejects.toThrow(/Test Site blocked the request/);
  });
});

// ensure the helper constant is part of the public surface other tests rely on
it('uses all four content ratings by default in tests', () => {
  expect(ALL_RATINGS).toHaveLength(4);
});

// --- a site that does not allow its own search page to be used (e.g. Rokari Comics) ----------------

describe('search without the site search (local index)', () => {
  const makeSite = () => createThemesiaProvider({ id: 'local', name: 'Local Site', description: 'd', base: BASE, siteSearch: false });

  const twoPages = () =>
    mockFetch([
      ['/manga/?page=1', listing(card('a-love-story', 'A Love Story') + card('duke-bride', "The Duke's Bride"), true)],
      ['/manga/?page=2', listing(card('love-and-war', 'Love and War') + card('a-love-story', 'A Love Story'), false)],
    ]);

  it('builds the list from the browse pages, then filters it by every word in the title', async () => {
    const f = twoPages();
    const site = makeSite();
    expect((await site.search(searchOpts({ title: 'LOVE' }))).items.map((m) => m.id)).toEqual(['a-love-story', 'love-and-war']);
    expect((await site.search(searchOpts({ title: 'love war' }))).items.map((m) => m.id)).toEqual(['love-and-war']);
    expect((await site.search(searchOpts({ title: 'nothing like this' }))).items).toEqual([]);
    expect(f.mock.calls.map((c) => c[0])).toEqual([`${BASE}/manga/?page=1&order=popular`, `${BASE}/manga/?page=2&order=popular`]);
  });

  it('never uses the forbidden ?s= search page', async () => {
    const f = twoPages();
    await makeSite().search(searchOpts({ title: 'love' }));
    for (const [url] of f.mock.calls) expect(url).not.toContain('?s=');
  });

  it('reads the list only once for several searches, even at the same time', async () => {
    const f = twoPages();
    const site = makeSite();
    await Promise.all([site.search(searchOpts({ title: 'a' })), site.search(searchOpts({ title: 'b' })), site.search(searchOpts({ title: 'duke' }))]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('pages the matches and reports their number as the total', async () => {
    twoPages();
    const site = makeSite();
    const first = await site.search(searchOpts({ title: 'love' }));
    expect(first.total).toBe(2);
    expect((await site.search(searchOpts({ title: 'love', offset: 20 }))).items).toEqual([]);
  });

  it('keeps the browse pages working as before (no search text)', async () => {
    const f = twoPages();
    const page = await makeSite().search(searchOpts({ order: 'followedCount' }));
    expect(f.mock.calls[0][0]).toContain('/manga/?page=1&order=popular');
    expect(page.items).toHaveLength(2);
  });

  it('surfaces an error when the first page cannot be loaded, and keeps what it has if a later page fails', async () => {
    mockFetch([['/manga/', { status: 403 }]]);
    await expect(makeSite().search(searchOpts({ title: 'x' }))).rejects.toThrow(/blocked the request/);
    mockFetch([
      ['/manga/?page=1', listing(card('a-love-story', 'A Love Story'), true)],
      ['/manga/?page=2', { status: 500 }],
    ]);
    expect((await makeSite().search(searchOpts({ title: 'love' }))).items.map((m) => m.id)).toEqual(['a-love-story']);
  });

  it('a site with its own search still uses it', async () => {
    const f = mockFetch([['?s=', listing(card('x', 'X'))]]);
    await site.search(searchOpts({ title: 'love' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/?s=love`);
  });
});

describe('adult-only sites', () => {
  const adultSite = () => createThemesiaProvider({ id: 'adult', name: 'Adult Site', description: 'd', base: BASE, adultOnly: true });

  it('marks every title as adult, so it only shows when mature titles are allowed', async () => {
    mockFetch([['/manga/', listing(card('a', 'A') + card('b', 'B'))]]);
    const hidden = await adultSite().search(searchOpts({ ratings: ['safe', 'suggestive'] }));
    expect(hidden.items).toEqual([]);
    mockFetch([['/manga/', listing(card('a', 'A') + card('b', 'B'))]]);
    const shown = await adultSite().search(searchOpts({ ratings: ['safe', 'suggestive', 'erotica', 'pornographic'] }));
    expect(shown.items.map((m) => [m.id, m.contentRating])).toEqual([['a', 'pornographic'], ['b', 'pornographic']]);
  });

  it('marks the title page as adult even without an adult tag', async () => {
    mockFetch([['/manga/test-title/', titlePage()]]);
    expect((await adultSite().getManga('test-title')).contentRating).toBe('pornographic');
  });

  it('leaves other sites unchanged', async () => {
    mockFetch([['/manga/', listing(card('a', 'A'))]]);
    expect((await site.search(searchOpts({ ratings: ['safe'] }))).items).toHaveLength(1);
  });
});
