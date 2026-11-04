import { mangareadProvider as p } from '../providers/mangaread';
import { fakeManga, instantTimers, mockFetch, searchOpts } from './helpers';

const BASE = 'https://www.mangaread.org';

beforeEach(() => {
  instantTimers();
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures --------------------------------------------------------------

const listCard = (slug: string, title: string, chapter = 'Chapter 25') => `
  <div class="page-item-detail manga">
    <div class="item-thumb"><a href="${BASE}/manga/${slug}/" title="${title}"><img src="https://img.test/${slug}-110x150.webp"></a></div>
    <div class="item-summary">
      <div class="post-title font-title"><h3 class="h5"><a href="${BASE}/manga/${slug}/">${title}</a></h3></div>
      <div class="list-chapter"><div class="chapter-item"><span class="chapter font-meta"><a href="${BASE}/manga/${slug}/chapter-25/" class="btn-link"> ${chapter} </a></span></div></div>
    </div>
  </div>`;

const field = (label: string, value: string) =>
  `<div class="post-content_item"><div class="summary-heading"><h5>${label}</h5></div><div class="summary-content">${value}</div></div>`;

const searchCard = (slug: string, title: string, genres: string[], type = 'Manhwa') => `
  <div class="row c-tabs-item__content">
    <div class="tab-thumb"><a href="${BASE}/manga/${slug}/" title="${title}"><img src="https://img.test/${slug}.webp"></a></div>
    <div class="tab-summary">
      <div class="post-title"><h3 class="h4"><a href="${BASE}/manga/${slug}/">${title}</a></h3></div>
      <div class="post-content">
        ${field('Alternative', 'Alt One, Alt Two')}
        ${field('Authors', '<a>Au Thor</a>')}
        ${field('Genres', genres.map((g) => `<a>${g}</a>`).join(', '))}
        ${field('Type', type)}
        ${field('Status', 'OnGoing')}
      </div>
      <div class="latest-chap"><span class="chapter"><a href="${BASE}/manga/${slug}/chapter-9/">Chapter 9</a></span></div>
    </div>
  </div>`;

// --- search ------------------------------------------------------------------

describe('browsing', () => {
  it('parses the listing', async () => {
    const f = mockFetch([['/manga/?m_orderby=views', `<div>${listCard('one', 'One')}${listCard('two', 'Two', 'Chapter 7')}</div>`]]);
    const page = await p.search(searchOpts({ order: 'followedCount' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga/?m_orderby=views`);
    expect(page.items.map((m) => m.id)).toEqual(['one', 'two']);
    expect(page.items[0]).toMatchObject({ title: 'One', lastChapter: '25', coverUrl: 'https://img.test/one-110x150.webp' });
    expect(page.items[0].coverUrlLarge).toBe('https://img.test/one.webp'); // thumbnail size suffix removed
    expect(page.items[1].lastChapter).toBe('7'); // read from the card's chapter label
    expect(page.items[1].latestUploadedChapter).toBe('Chapter 7');
  });

  it('maps sort orders and pages (12 titles per page)', async () => {
    const f = mockFetch([['/manga/', '<div></div>']]);
    await p.search(searchOpts({ order: 'latestUploadedChapter', offset: 12 }));
    await p.search(searchOpts({ order: 'rating', offset: 24 }));
    await p.search(searchOpts({ order: 'createdAt' }));
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/manga/page/2/?m_orderby=latest`,
      `${BASE}/manga/page/3/?m_orderby=rating`,
      `${BASE}/manga/?m_orderby=new-manga`,
    ]);
  });

  it('browses the site\'s genre page when a type is chosen, and tags the titles with that type', async () => {
    const f = mockFetch([['/genres/manhwa/', `<div>${listCard('one', 'One')}</div>`]]);
    const page = await p.search(searchOpts({ type: 'manhwa', order: 'followedCount' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/genres/manhwa/?m_orderby=views`);
    expect(page.items[0].type).toBe('manhwa');
  });

  it('pages inside a genre page', async () => {
    const f = mockFetch([['/genres/manga/', '<div></div>']]);
    await p.search(searchOpts({ type: 'manga', offset: 12 }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/genres/manga/page/2/?m_orderby=views`);
  });

  it('reports a next page while a full page comes back', async () => {
    const full = Array.from({ length: 12 }, (_, i) => listCard(`t${i}`, `T${i}`)).join('');
    mockFetch([['/manga/', `<div>${full}</div>`]]);
    const page = await p.search(searchOpts());
    expect(page.items).toHaveLength(12);
    expect(page.total).toBeGreaterThan(12);
  });
});

describe('searching by title', () => {
  it('queries the WordPress search and reads the details shown on each result', async () => {
    const f = mockFetch([['?s=', `<div>${searchCard('solo', 'Solo', ['Action', 'Fantasy'])}</div>`]]);
    const page = await p.search(searchOpts({ title: 'solo leveling' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/?s=solo%20leveling&post_type=wp-manga`);
    expect(page.items[0]).toMatchObject({
      id: 'solo',
      title: 'Solo',
      type: 'manhwa',
      pubStatus: 'ongoing',
      tags: ['Action', 'Fantasy'],
      authors: ['Au Thor'],
      altTitle: 'Alt One, Alt Two',
      lastChapter: '9',
    });
  });

  it('uses /page/N/ for later pages', async () => {
    const f = mockFetch([['?s=', '<div></div>']]);
    await p.search(searchOpts({ title: 'x', offset: 12 }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/page/2/?s=x&post_type=wp-manga`);
  });

  it('hides titles above the allowed content ratings', async () => {
    mockFetch([['?s=', searchCard('a', 'A', ['Action']) + searchCard('b', 'B', ['Adult']) + searchCard('c', 'C', ['Ecchi'])]]);
    const page = await p.search(searchOpts({ title: 'x', ratings: ['safe'] }));
    expect(page.items.map((m) => m.id)).toEqual(['a']);
    const all = await p.search(searchOpts({ title: 'x' }));
    expect(all.items.map((m) => [m.id, m.contentRating])).toEqual([
      ['a', 'safe'],
      ['b', 'pornographic'],
      ['c', 'suggestive'],
    ]);
  });

  it('filters by the type shown on the result', async () => {
    mockFetch([['?s=', searchCard('a', 'A', [], 'Manhwa') + searchCard('b', 'B', [], 'Manhua')]]);
    const page = await p.search(searchOpts({ title: 'x', type: 'manhua' }));
    expect(page.items.map((m) => m.id)).toEqual(['b']);
  });
});

// --- title details ------------------------------------------------------------

describe('getManga', () => {
  const titlePage = `
    <div class="post-title"><h1>  Against The Gods </h1></div>
    <div class="summary_image"><a><img src="https://img.test/cover-193x278.jpg"></a></div>
    <div class="post-content">
      ${field('Alternative', 'ATG')}
      ${field('Author(s)', '<a>Mad Snail</a>')}
      ${field('Artist(s)', '<a>Mad Snail</a>, <a>Someone</a>')}
      ${field('Genre(s)', '<a rel="tag">Action</a>, <a rel="tag">Ecchi</a>')}
      ${field('Type', 'Manhua')}
      ${field('Release', '2015')}
      ${field('Status', 'Completed')}
    </div>
    <div class="summary__content show-more"><p>A brief description of the manhua Against The Gods:</p><p>Yun Che falls.</p><p>He rises.</p></div>
    <ul><li class="wp-manga-chapter"><a href="${BASE}/manga/against-the-gods/chapter-806/">Chapter 806</a></li></ul>`;

  it('reads the details', async () => {
    const f = mockFetch([['/manga/against-the-gods/', titlePage]]);
    const m = await p.getManga('against-the-gods');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga/against-the-gods/`);
    expect(m).toMatchObject({
      id: 'against-the-gods',
      title: 'Against The Gods',
      altTitle: 'ATG',
      type: 'manhua',
      pubStatus: 'completed',
      year: 2015,
      tags: ['Action', 'Ecchi'],
      contentRating: 'suggestive',
      lastChapter: '806',
    });
    expect(m.authors).toEqual(['Mad Snail', 'Someone']); // de-duplicated across author and artist
  });

  it('joins the synopsis paragraphs and drops the "A brief description of…" header', async () => {
    mockFetch([['/manga/against-the-gods/', titlePage]]);
    expect((await p.getManga('against-the-gods')).description).toBe('Yun Che falls.\n\nHe rises.');
  });

  it('fails clearly when the page has no title', async () => {
    mockFetch([['/manga/', '<p>nope</p>']]);
    await expect(p.getManga('x')).rejects.toThrow('Could not read this title from MangaRead.');
  });
});

// --- chapters and pages ----------------------------------------------------------

describe('getChapters', () => {
  const li = (slug: string, n: string, label: string, date: string) =>
    `<li class="wp-manga-chapter"><a href="${BASE}/manga/${slug}/chapter-${n}/">${label}</a><span class="chapter-release-date"><i>${date}</i></span></li>`;

  it('sorts ascending, removes duplicates and parses ids and numbers', async () => {
    mockFetch([
      ['/manga/t/', `<ul>${li('t', '10', 'Chapter 10', '1 hour ago')}${li('t', '2', 'Chapter 2', 'March 3, 2024')}${li('t', '2-5', 'Chapter 2.5 - Extra', '2 days ago')}${li('t', '10', 'Chapter 10', '1 day ago')}</ul>`],
    ]);
    const list = await p.getChapters(fakeManga('t'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(['2', '2.5', '10']);
    expect(list[0]).toMatchObject({ id: 't/chapter-2', key: '2', externalUrl: null });
    expect(list[1].title).toBe('Extra');
    expect(new Date(list[0].readableAt).getFullYear()).toBe(2024);
  });

  it('returns an empty list when a title has no chapters', async () => {
    mockFetch([['/manga/t/', '<ul></ul>']]);
    await expect(p.getChapters(fakeManga('t'), 'en')).resolves.toEqual([]);
  });
});

describe('getChapterPages', () => {
  it('returns the page images, trimming the whitespace the site puts in the src', async () => {
    const f = mockFetch([
      [
        '/manga/t/chapter-1/',
        `<div class="reading-content">
           <img id="image-0" src="\n\t\t\thttps://cdn.test/0.jpg" class="wp-manga-chapter-img">
           <img id="image-1" src="https://cdn.test/1.jpg" class="wp-manga-chapter-img">
           <img id="image-0" src="https://cdn.test/0.jpg" class="wp-manga-chapter-img">
         </div>`,
      ],
    ]);
    await expect(p.getChapterPages('t/chapter-1', false)).resolves.toEqual(['https://cdn.test/0.jpg', 'https://cdn.test/1.jpg']);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manga/t/chapter-1/`);
  });

  it('fails clearly when there are no images', async () => {
    mockFetch([['/manga/t/chapter-1/', '<div class="reading-content"></div>']]);
    await expect(p.getChapterPages('t/chapter-1', false)).rejects.toThrow('No pages found for this chapter.');
  });

  it('explains bot protection and missing pages', async () => {
    mockFetch([['/manga/t/chapter-1/', { status: 403 }]]);
    await expect(p.getChapterPages('t/chapter-1', false)).rejects.toThrow(/blocked the request/);
    mockFetch([['/manga/t/chapter-1/', { status: 404 }]]);
    await expect(p.getChapterPages('t/chapter-1', false)).rejects.toThrow('Not found on MangaRead.');
  });
});
