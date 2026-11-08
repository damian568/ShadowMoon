import { rinkoNovelsProvider as p } from '../providers/rinkonovels';
import { fakeManga, instantTimers, mockFetch, searchOpts } from './helpers';

const BASE = 'https://rinkocomics.com';

beforeEach(() => {
  instantTimers();
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures (the shape of the real pages) ------------------------------------

const card = (slug: string, title: string, status = 'completed') => `
  <article class="ac-card" data-id="1">
    <a href="${BASE}/novel/${slug}/" class="ac-thumb">
      <img src="${BASE}/wp-content/uploads/${slug}.webp" alt="${title}" loading="lazy">
      <span class="ac-status">${status}</span>
      <div class="ac-overlay"><h3 class="ac-title">${title}</h3><div class="ac-stats"><span class="ac-chapters">12 Episodes</span></div></div>
    </a>
  </article>`;

const listing = (cards: string[], lastPage = 1) =>
  `<html><body>${cards.join('')}<nav>${Array.from({ length: lastPage - 1 }, (_, i) => `<a class="page-numbers" href="${BASE}/novel/page/${i + 2}/">${i + 2}</a>`).join('')}</nav></body></html>`;

const row = (slug: string, n: number, name: string, free: boolean) => `
  <div class="chapter-row-container">
    <div class="chapter ${free ? '' : 'locked-chapter'}" data-post-id="${1000 + n}" data-price="${free ? 0 : 50}" data-title="${name}"
         data-permalink="${free ? `${BASE}/novel_chapter/${slug}-chapter-${n}/` : '#'}" data-reason="${free ? 'free' : 'login_required'}">
      <a href="${free ? `${BASE}/novel_chapter/${slug}-chapter-${n}/` : '#'}" class="chapter-row">
        <div class="chapter-lead"><span class="ch-index">#${n}</span><span class="ch-name">${name}</span></div>
      </a>
    </div>
  </div>`;

const novelPage = (rows: string[]) => `
  <html><head>
    <meta property="og:image" content="${BASE}/wp-content/uploads/cover-716x1024.webp">
    <meta property="og:description" content="Truncated synopsis…">
  </head><body>
    <h1>Can I Cry Now?</h1>
    <div class="comic-status"><div><span>Status</span> <span>completed</span></div></div>
    <div class="comic-synopsis"><div class="comic-page-info"><div class="comic-info-lower"><div class="comic-synopsis">The full synopsis.</div></div></div></div>
    <div class="novel-chapters-wrapper">${rows.join('')}</div>
  </body></html>`;

// --- browsing and searching -------------------------------------------------------

describe('browsing and searching', () => {
  it('is a novel source', () => {
    expect(p.kind).toBe('novel');
  });

  it('parses the listing cards (the title is not a link; the thumbnail is)', async () => {
    const f = mockFetch([['/novel/', listing([card('can-i-cry-now', 'Can I Cry Now?'), card('b', 'B Title', 'ongoing')])]]);
    const page = await p.search(searchOpts());
    expect(f.mock.calls[0][0]).toBe(`${BASE}/novel/`);
    expect(page.items[0]).toMatchObject({
      id: 'can-i-cry-now',
      title: 'Can I Cry Now?',
      type: 'novel',
      pubStatus: 'completed',
      coverUrl: `${BASE}/wp-content/uploads/can-i-cry-now.webp`,
    });
    expect(page.items[1]).toMatchObject({ id: 'b', pubStatus: 'ongoing' });
  });

  it('pages with /novel/page/N/ (20 per page) and reports when there is a next page', async () => {
    const f = mockFetch([['/novel/', listing([card('a', 'A')], 3)]]);
    const first = await p.search(searchOpts({ offset: 0 }));
    expect(first.total).toBeGreaterThan(first.items.length); // more to load
    await p.search(searchOpts({ offset: 20 }));
    expect(f.mock.calls[1][0]).toBe(`${BASE}/novel/page/2/`);
  });

  it('stops paging on the last page', async () => {
    mockFetch([['/novel/', listing([card('a', 'A')], 1)]]);
    const page = await p.search(searchOpts());
    expect(page.total).toBe(page.items.length);
  });

  it('searches the novel section of the site', async () => {
    const f = mockFetch([['post_type=novel', listing([card('can-i-cry-now', 'Can I Cry Now?')])]]);
    const page = await p.search(searchOpts({ title: 'cry now' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/?s=cry%20now&post_type=novel`);
    expect(page.items).toHaveLength(1);
  });
});

// --- details and chapters ----------------------------------------------------------------

describe('a novel', () => {
  const rows = [row('cry', 3, 'Side Story 1', false), row('cry', 2, 'Chapter 2', true), row('cry', 1, 'Chapter 1', true)];

  it('reads the details, taking the synopsis from the innermost block', async () => {
    mockFetch([['/novel/cry/', novelPage(rows)]]);
    const m = await p.getManga('cry');
    expect(m).toMatchObject({
      id: 'cry',
      title: 'Can I Cry Now?',
      type: 'novel',
      pubStatus: 'completed',
      description: 'The full synopsis.',
      coverUrl: `${BASE}/wp-content/uploads/cover-716x1024.webp`,
      coverUrlLarge: `${BASE}/wp-content/uploads/cover.webp`,
      lastChapter: '3',
      latestUploadedChapter: 'Chapter 3',
    });
  });

  it('lists chapters oldest first; free ones are readable, locked ones open the novel on the website', async () => {
    mockFetch([['/novel/cry/', novelPage(rows)]]);
    const chapters = await p.getChapters(fakeManga('cry'), 'en');
    expect(chapters.map((c) => c.chapter)).toEqual(['1', '2', '3']);
    expect(chapters[0]).toMatchObject({ id: 'cry-chapter-1', key: '1', title: 'Chapter 1', pages: 1, externalUrl: null });
    expect(chapters[2]).toMatchObject({ id: 'locked-1003', title: 'Side Story 1', externalUrl: `${BASE}/novel/cry/` });
  });

  it('does not list the same chapter twice', async () => {
    mockFetch([['/novel/cry/', novelPage([...rows, row('cry', 2, 'Chapter 2 again', true)])]]);
    expect(await p.getChapters(fakeManga('cry'), 'en')).toHaveLength(3);
  });

  it('fails clearly when the page is not a novel page', async () => {
    mockFetch([['/novel/cry/', '<html><body><p>nothing</p></body></html>']]);
    await expect(p.getManga('cry')).rejects.toThrow(/Could not read this title/);
  });
});

// --- chapter text -------------------------------------------------------------------------

describe('chapter text', () => {
  it('returns the paragraphs of the chapter, not the rest of the page', async () => {
    const f = mockFetch([
      [
        '/novel_chapter/cry-chapter-1/',
        `<html><body>
          <p class="search-empty-state">Type to search for comics</p>
          <div class="novel-content"><p>First &amp; foremost.</p><p>  </p><p>Second   paragraph.</p></div>
        </body></html>`,
      ],
    ]);
    expect(await p.getChapterText!('cry-chapter-1')).toEqual(['First & foremost.', 'Second paragraph.']);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/novel_chapter/cry-chapter-1/`);
  });

  it('says so when a chapter has no text (for example it needs coins)', async () => {
    mockFetch([['/novel_chapter/', '<html><body><div class="novel-content"></div></body></html>']]);
    await expect(p.getChapterText!('x')).rejects.toThrow(/No text found/);
  });
});
