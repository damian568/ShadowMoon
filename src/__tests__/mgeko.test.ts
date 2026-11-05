import { mgekoProvider as p, parseSiteDate } from '../providers/mgeko';
import { fakeManga, instantTimers, mockFetch, searchOpts } from './helpers';

const BASE = 'https://www.mgeko.cc';

beforeEach(() => {
  instantTimers();
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures --------------------------------------------------------------

const card = (slug: string, title: string, over: { author?: string; latest?: string } = {}) => `
  <li class="novel-item">
    <a href="/manga/${slug}/" title="${title}">
      <div class="cover-wrap"><figure class="novel-cover"><img class="lazy" src="/static/img/loading.gif" data-src='/media/manga_covers/${slug}.webp' alt="${title}"></figure></div>
      <h4 class="novel-title text2row"> ${title} </h4>
      ${over.author ? `<h6 class="text1row">Author(S): ${over.author}</h6>` : ''}
      <div class="novel-stats"><strong> Chapters ${over.latest ?? '25-eng-li'}</strong><span>2 days Ago</span></div>
    </a>
  </li>`;

/** A listing/search page: the real list, plus a sidebar slider that must be ignored. */
const listPage = (cards: string[], lastPage = 1) => `
  <html><body>
    <div class="swiper-container"><ul class="swiper-wrapper">${card('sidebar-pick', 'Sidebar Pick')}</ul></div>
    <ul class="novel-list grid col col2 chapters">${cards.join('')}</ul>
    <div class="mg-pagination">${Array.from({ length: lastPage }, (_, i) => `<a href="/jumbo/manga/?results=${i + 1}&filter=All">${i + 1}</a>`).join('')}</div>
  </body></html>`;

// --- search / browse ---------------------------------------------------------

describe('browsing', () => {
  it('reads the real list and ignores the sidebar', async () => {
    mockFetch([['/jumbo/manga/', listPage([card('c9me-solo', 'Solo', { author: 'Muyeongja' }), card('a1b2-other', 'Other', { latest: '12.5-eng-li' })])]]);
    const page = await p.search(searchOpts());
    expect(page.items.map((m) => m.id)).toEqual(['c9me-solo', 'a1b2-other']);
    expect(page.items[0]).toMatchObject({
      title: 'Solo',
      authors: ['Muyeongja'],
      lastChapter: '25',
      latestUploadedChapter: '25-eng-li',
      coverUrl: `${BASE}/media/manga_covers/c9me-solo.webp`,
    });
    expect(page.items[1].lastChapter).toBe('12.5');
  });

  it('pages with ?results=N (50 titles per page)', async () => {
    const f = mockFetch([['/jumbo/manga/', listPage([])]]);
    await p.search(searchOpts());
    await p.search(searchOpts({ offset: 50 }));
    await p.search(searchOpts({ offset: 100 }));
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/jumbo/manga/?results=1&filter=All`,
      `${BASE}/jumbo/manga/?results=2&filter=All`,
      `${BASE}/jumbo/manga/?results=3&filter=All`,
    ]);
  });

  it('asks the site to filter by type and tags the titles with it', async () => {
    const f = mockFetch([['/jumbo/manga/', listPage([card('a', 'A')])]]);
    const page = await p.search(searchOpts({ type: 'manhua' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/jumbo/manga/?results=1&filter=manhua`);
    expect(page.items[0].type).toBe('manhua');
  });

  it('knows when there is a next page from the pagination bar', async () => {
    mockFetch([['/jumbo/manga/', listPage([card('a', 'A')], 5)]]);
    const first = await p.search(searchOpts());
    expect(first.total).toBeGreaterThan(first.items.length);
    mockFetch([['/jumbo/manga/', listPage([card('a', 'A')], 1)]]);
    const only = await p.search(searchOpts());
    expect(only.total).toBe(1);
  });
});

describe('searching by title', () => {
  it('uses /search/ with the encoded text and 30-title pages', async () => {
    const f = mockFetch([['/search/', listPage([card('c9me-solo', 'Solo')])]]);
    await p.search(searchOpts({ title: '  love & war ' }));
    await p.search(searchOpts({ title: 'love', offset: 30 }));
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/search/?search=love%20%26%20war&results=1`,
      `${BASE}/search/?search=love&results=2`,
    ]);
  });

  it('keeps titles whose type is unknown (the registry looks it up) and drops nothing else', async () => {
    mockFetch([['/search/', listPage([card('a', 'A'), card('b', 'B')])]]);
    const page = await p.search(searchOpts({ title: 'x', type: 'manhwa' }));
    expect(page.items.map((m) => [m.id, m.type])).toEqual([['a', 'other'], ['b', 'other']]);
  });

  it('skips cards that are not series links', async () => {
    mockFetch([['/search/', '<ul class="novel-list"><li class="novel-item"><a href="/about/">x</a></li>' + card('ok', 'Ok') + '</ul>']]);
    expect((await p.search(searchOpts({ title: 'x' }))).items.map((m) => m.id)).toEqual(['ok']);
  });
});

// --- details -----------------------------------------------------------------

describe('getManga', () => {
  const titlePage = `
    <html><head><meta property="og:image" content="${BASE}/media/manga_covers/solo.webp"></head><body>
      <h1>Solo Swordmaster</h1>
      <p class="alternative-title">I’m the Only Sword Master • The Lone Sword Master • 나 혼자 소드마스터</p>
      <span class="author">Author: Muyeongja</span>
      <div class="header-stats"><span><strong>25-eng-li</strong> Chapters</span><span><strong>Ongoing</strong> Status</span></div>
      <ul class="categories"><li>Categories</li><li>Action</li><li>Ecchi</li><li>Long Strip</li><li>Manhwa</li></ul>
      <p class="description">Solo Swordmaster is a Manga/Manhwa/Manhua in english language, Action series, english chapters have been translated and you can read them here. You are reading chapters on www.mgeko.cc fastest updating comic site. The Summary is Times change, and nothing lasts forever.</p>
    </body></html>`;

  it('reads the details and strips the site boilerplate from the synopsis', async () => {
    const f = mockFetch([['/manga/solo/', titlePage]]);
    const m = await p.getManga('solo');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga/solo/`);
    expect(m).toMatchObject({
      id: 'solo',
      title: 'Solo Swordmaster',
      altTitle: 'I’m the Only Sword Master',
      authors: ['Muyeongja'],
      type: 'manhwa',
      pubStatus: 'ongoing',
      tags: ['Action', 'Ecchi', 'Long Strip'],
      contentRating: 'suggestive',
      lastChapter: '25',
      coverUrl: `${BASE}/media/manga_covers/solo.webp`,
      description: 'Times change, and nothing lasts forever.',
    });
  });

  it('keeps the whole description when it has no boilerplate', async () => {
    mockFetch([['/manga/x/', '<h1>X</h1><p class="description">Just a synopsis.</p>']]);
    expect((await p.getManga('x')).description).toBe('Just a synopsis.');
  });

  it('fails clearly on a page without a title', async () => {
    mockFetch([['/manga/', '<p>nope</p>']]);
    await expect(p.getManga('x')).rejects.toThrow('Could not read this title from Mgeko.');
  });
});

// --- chapters and pages --------------------------------------------------------

describe('getChapters', () => {
  const li = (n: string, datetime: string, text = '2 days') =>
    `<li data-chapterno="1"><a href="/reader/en/solo-chapter-${n}-eng-li/"><strong class="chapter-title"> ${n.replace('-', '.')}-eng-li </strong><time class="chapter-update" datetime="${datetime}"> ${text} </time></a></li>`;

  it('lists chapters in reading order, using the number in the address (the data attribute is unreliable)', async () => {
    const f = mockFetch([
      ['/all-chapters/', `<ul class="chapter-list">${li('10', 'Nov. 3, 2026, 7:23 p.m.')}${li('2', 'July 15, 2026, 5:31 a.m.')}${li('2-5', 'Aug. 1, 2026, 1:00 p.m.')}${li('10', 'Nov. 4, 2026, 1:00 a.m.')}</ul>`],
    ]);
    const list = await p.getChapters(fakeManga('solo'), 'en');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga/solo/all-chapters/`);
    expect(list.map((c) => c.chapter)).toEqual(['2', '2.5', '10']);
    expect(list[0]).toMatchObject({ id: 'solo-chapter-2-eng-li', key: '2', externalUrl: null, readableAt: '2026-07-15T05:31:00.000Z' });
    expect(list[2].readableAt).toBe('2026-11-03T19:23:00.000Z'); // the first duplicate wins
  });

  it('falls back to the relative text when the date cannot be read', async () => {
    mockFetch([['/all-chapters/', `<ul class="chapter-list">${li('1', 'garbage', '3 days')}</ul>`]]);
    const [only] = await p.getChapters(fakeManga('solo'), 'en');
    expect(Date.now() - new Date(only.readableAt).getTime()).toBeGreaterThan(2.9 * 864e5);
  });

  it('returns an empty list for a title without chapters', async () => {
    mockFetch([['/all-chapters/', '<ul class="chapter-list"></ul>']]);
    await expect(p.getChapters(fakeManga('solo'), 'en')).resolves.toEqual([]);
  });
});

describe('getChapterPages', () => {
  it('returns the page images in order, without duplicates', async () => {
    const f = mockFetch([
      [
        '/reader/en/solo-chapter-1-eng-li/',
        `<div id="chapter-reader">
           <img class="mgr-page" src="https://imgsrv5.com/sv2/comic/solo/chapter-1/0.jpg">
           <img class="mgr-page" src="https://imgsrv5.com/sv2/comic/solo/chapter-1/1.jpg">
           <img class="mgr-page" src="https://imgsrv5.com/sv2/comic/solo/chapter-1/0.jpg">
           <img src="https://www.mgeko.cc/static/img/logo.png">
         </div>`,
      ],
    ]);
    await expect(p.getChapterPages('solo-chapter-1-eng-li', false)).resolves.toEqual([
      'https://imgsrv5.com/sv2/comic/solo/chapter-1/0.jpg',
      'https://imgsrv5.com/sv2/comic/solo/chapter-1/1.jpg',
    ]);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/reader/en/solo-chapter-1-eng-li/`);
  });

  it('fails clearly when there are no images', async () => {
    mockFetch([['/reader/', '<div id="chapter-reader"></div>']]);
    await expect(p.getChapterPages('x', false)).rejects.toThrow('No pages found for this chapter.');
  });
});

describe('parseSiteDate', () => {
  it.each([
    ['Nov. 5, 2026, 3:38 a.m.', '2026-11-05T03:38:00.000Z'],
    ['July 15, 2026, 5:31 p.m.', '2026-07-15T17:31:00.000Z'],
    ['Dec. 31, 2025, 12:05 a.m.', '2025-12-31T00:05:00.000Z'],
    ['Jan. 1, 2026, 12:00 p.m.', '2026-01-01T12:00:00.000Z'],
    ['Sept. 9, 2026', '2026-09-09T00:00:00.000Z'],
  ])('reads %s', (raw, iso) => {
    expect(parseSiteDate(raw)).toBe(iso);
  });

  it('returns null for text that is not a date', () => {
    expect(parseSiteDate('2 days')).toBeNull();
    expect(parseSiteDate('')).toBeNull();
    expect(parseSiteDate('Foo. 3, 2026')).toBeNull();
  });
});
