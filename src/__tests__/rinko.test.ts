import { rinkoProvider as p } from '../providers/rinko';
import { fakeManga, instantTimers, mockFetch, searchOpts } from './helpers';

const BASE = 'https://rinkocomics.com';

beforeEach(() => {
  instantTimers();
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures --------------------------------------------------------------

const card = (slug: string, title: string, genres: string[] = ['Drama'], author = 'fidel') => `
  <article class="ac-card" data-id="1">
    <a href="${BASE}/comic/${slug}/" class="ac-thumb"><img src="${BASE}/wp-content/uploads/${slug}.webp" alt="${title}"></a>
    <div class="ac-card-body">
      <h2 class="ac-title"><a href="${BASE}/comic/${slug}/">${title}</a></h2>
      <div class="ac-genres">${genres.map((g) => `<a href="${BASE}/comics_genres/${g.toLowerCase()}/" rel="tag">${g}</a>`).join('')}</div>
      <div class="ac-meta"><span class="ac-date">November 5, 2026</span><span class="ac-author">${author}</span></div>
    </div>
  </article>`;

const listing = (cards: string[], lastPage = 1) =>
  `<html><body>${cards.join('')}<nav>${Array.from({ length: lastPage - 1 }, (_, i) => `<a class="page-numbers" href="${BASE}/comic/page/${i + 2}/">${i + 2}</a>`).join('')}</nav></body></html>`;

const row = (slug: string, n: number, opts: { price?: number; date?: string } = {}) => {
  const price = opts.price ?? 0;
  return `<li class="chapter ${price ? 'locked-chapter' : ''}" data-price="${price}" data-reason="${price ? 'login_required' : 'free'}" data-permalink="${BASE}/chapter/${slug}-chapter-${n}/">
    <a href="${price ? '#' : `${BASE}/chapter/${slug}-chapter-${n}/`}">Chapter ${n} ${opts.date ?? 'Nov 5, 2026'} 0 ${price}</a></li>`;
};

const comicPage = (slug: string, rows: string[], total: number, extra = '') => `
  <html><head><meta property="og:image" content="${BASE}/wp-content/uploads/cover-716x1024.webp"><meta property="og:description" content="Meta synopsis."></head><body>
    <h1>My Comic</h1>
    <div class="comic-status">Status ongoing</div>
    <p class="comic-synopsis">The real synopsis.</p>
    ${extra}
    <div class="comic-page-chapters"><h3>Chapters (${total}) Newest First</h3><ul>${rows.join('')}</ul></div>
  </body></html>`;

// --- search ------------------------------------------------------------------

describe('browsing and searching', () => {
  it('parses the listing cards', async () => {
    const f = mockFetch([['/comic/', listing([card('a-title', 'A Title', ['Drama', 'Romance']), card('b-title', 'B Title')])]]);
    const page = await p.search(searchOpts());
    expect(f.mock.calls[0][0]).toBe(`${BASE}/comic/`);
    expect(page.items[0]).toMatchObject({
      id: 'a-title',
      title: 'A Title',
      tags: ['Drama', 'Romance'],
      authors: ['fidel'],
      coverUrl: `${BASE}/wp-content/uploads/a-title.webp`,
      type: 'other',
    });
    expect(page.items).toHaveLength(2);
  });

  it('pages with /comic/page/N/ (20 per page) and reports when there is a next page', async () => {
    const f = mockFetch([['/comic/', listing([card('a', 'A')], 3)]]);
    const first = await p.search(searchOpts());
    await p.search(searchOpts({ offset: 40 }));
    expect(f.mock.calls.map((c) => c[0])).toEqual([`${BASE}/comic/`, `${BASE}/comic/page/3/`]);
    expect(first.total).toBeGreaterThan(first.items.length);
    mockFetch([['/comic/', listing([card('a', 'A')], 3)]]);
    const last = await p.search(searchOpts({ offset: 40 }));
    expect(last.total).toBe(41); // page 3 of 3: nothing after it
  });

  it('searches with the WordPress search restricted to comics, and pages it', async () => {
    const f = mockFetch([['?s=', listing([card('x', 'X')])]]);
    await p.search(searchOpts({ title: '  love & war ' }));
    await p.search(searchOpts({ title: 'love', offset: 20 }));
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/?s=love%20%26%20war&post_type=comic`,
      `${BASE}/page/2/?s=love&post_type=comic`,
    ]);
  });

  it('returns nothing for a search with no matches', async () => {
    mockFetch([['?s=', '<html><body><p>No results</p></body></html>']]);
    await expect(p.search(searchOpts({ title: 'zzz' }))).resolves.toMatchObject({ items: [], total: 0 });
  });

  it('hides titles above the allowed content ratings and skips cards without a comic link', async () => {
    mockFetch([['/comic/', listing([card('a', 'A'), card('b', 'B', ['Adult']), card('c', 'C', ['Ecchi'])]) + '<article class="ac-card"><a href="/about/">x</a></article>']]);
    expect((await p.search(searchOpts({ ratings: ['safe'] }))).items.map((m) => m.id)).toEqual(['a']);
    expect((await p.search(searchOpts())).items.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});

// --- details -----------------------------------------------------------------

describe('getManga', () => {
  it('reads the details', async () => {
    const f = mockFetch([['/comic/my-comic/', comicPage('my-comic', [row('my-comic', 3), row('my-comic', 2)], 3, `<a href="${BASE}/comics_genres/drama/">Drama</a>`)]]);
    const m = await p.getManga('my-comic');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/comic/my-comic/`);
    expect(m).toMatchObject({
      id: 'my-comic',
      title: 'My Comic',
      pubStatus: 'ongoing',
      description: 'The real synopsis.',
      tags: ['Drama'],
      lastChapter: '3',
      coverUrl: `${BASE}/wp-content/uploads/cover-716x1024.webp`,
      coverUrlLarge: `${BASE}/wp-content/uploads/cover.webp`,
    });
  });

  it('falls back to the page description, and fails clearly without a title', async () => {
    mockFetch([['/comic/x/', '<h1>X</h1><meta property="og:description" content=" Fallback. ">']]);
    expect((await p.getManga('x')).description).toBe('Fallback.');
    mockFetch([['/comic/', '<p>nope</p>']]);
    await expect(p.getManga('y')).rejects.toThrow('Could not read this title from Rinko Comics.');
  });
});

// --- chapters ----------------------------------------------------------------

describe('getChapters', () => {
  const ten = (slug: string, from: number) => Array.from({ length: 10 }, (_, i) => row(slug, from - i));

  it('rebuilds the older chapters the page does not show, when the numbering is consecutive', async () => {
    mockFetch([['/comic/my-comic/', comicPage('my-comic', ten('my-comic', 20), 20)]]);
    const list = await p.getChapters(fakeManga('my-comic'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    expect(list[0]).toMatchObject({ id: 'my-comic-chapter-1', key: '1', externalUrl: null });
    expect(list[19]).toMatchObject({ id: 'my-comic-chapter-20', externalUrl: null });
  });

  it('lists chapters that need a login or coins as locked and sends them to the website', async () => {
    const rows = [row('my-comic', 20, { price: 100 }), row('my-comic', 19, { price: 100 }), ...Array.from({ length: 8 }, (_, i) => row('my-comic', 18 - i))];
    mockFetch([['/comic/my-comic/', comicPage('my-comic', rows, 20)]]);
    const list = await p.getChapters(fakeManga('my-comic'), 'en');
    const locked = list.filter((c) => c.externalUrl);
    expect(locked.map((c) => c.chapter)).toEqual(['19', '20']);
    expect(locked[0].externalUrl).toBe(`${BASE}/chapter/my-comic-chapter-19/`);
  });

  it('does not invent chapters when the count does not match the numbering', async () => {
    mockFetch([['/comic/my-comic/', comicPage('my-comic', ten('my-comic', 30), 40)]]); // highest 30, count 40
    const list = await p.getChapters(fakeManga('my-comic'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(Array.from({ length: 10 }, (_, i) => String(21 + i)));
  });

  it('does nothing extra when every chapter is already listed', async () => {
    mockFetch([['/comic/my-comic/', comicPage('my-comic', [row('my-comic', 3), row('my-comic', 2), row('my-comic', 1)], 3)]]);
    expect((await p.getChapters(fakeManga('my-comic'), 'en')).map((c) => c.chapter)).toEqual(['1', '2', '3']);
  });

  it('reads dates, handles decimal chapter numbers, and drops duplicates', async () => {
    const rows = [row('my-comic', 3, { date: 'Nov 5, 2026' }), `<li class="chapter" data-price="0" data-permalink="${BASE}/chapter/my-comic-chapter-2-5/">Chapter 2.5 Oct 1, 2026</li>`, row('my-comic', 3)];
    mockFetch([['/comic/my-comic/', comicPage('my-comic', rows, 3)]]);
    const list = await p.getChapters(fakeManga('my-comic'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(['2.5', '3']);
    expect(list[1].readableAt).toBe('2026-11-05T00:00:00.000Z');
    expect(list[0].id).toBe('my-comic-chapter-2-5');
  });

  it('returns an empty list when there are no chapters yet', async () => {
    mockFetch([['/comic/my-comic/', '<h1>My Comic</h1>']]);
    await expect(p.getChapters(fakeManga('my-comic'), 'en')).resolves.toEqual([]);
  });
});

describe('getChapterPages', () => {
  it('returns the page images from the site CDN, in order and without duplicates', async () => {
    const f = mockFetch([
      [
        '/chapter/my-comic-chapter-1/',
        `<img src="${BASE}/wp-content/uploads/logo.webp">
         <img class="chapter-image lazy-image" data-src="https://cdn.rinkocomics.com/c/1/01.webp">
         <img class="chapter-image lazy-image" data-src="https://cdn.rinkocomics.com/c/1/02.webp">
         <img class="chapter-image lazy-image" data-src="https://cdn.rinkocomics.com/c/1/01.webp">`,
      ],
    ]);
    await expect(p.getChapterPages('my-comic-chapter-1', false)).resolves.toEqual([
      'https://cdn.rinkocomics.com/c/1/01.webp',
      'https://cdn.rinkocomics.com/c/1/02.webp',
    ]);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/chapter/my-comic-chapter-1/`);
  });

  it('says the chapter may need an account when there are no images', async () => {
    mockFetch([['/chapter/', '<p>Please log in</p>']]);
    await expect(p.getChapterPages('x', false)).rejects.toThrow(/may need an account or coins/);
  });
});
