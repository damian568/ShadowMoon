import { novelbinProvider as p } from '../providers/novelbin';
import { fakeManga, instantTimers, mockFetch, searchOpts } from './helpers';

const BASE = 'https://novelbin.com';

beforeEach(() => {
  instantTimers();
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures (the shape of the real pages) ------------------------------------

const row = (slug: string, title: string, author = 'Some Author') => `
  <div class="row">
    <div class="col-xs-3"><div><img src="https://images.novelbin.com/novel_80_113/${slug}.jpg" class="cover" alt="${title}"></div></div>
    <div class="col-xs-7"><div><h3 class="novel-title"><a href="${BASE}/b/${slug}" title="${title}">${title}</a></h3>
      <span class="author"><span class="glyphicon"></span>${author} </span></div></div>
    <div class="col-xs-2 text-info"><div><a href="${BASE}/b/${slug}/chapter-9-latest">Chapter 9</a></div></div>
  </div>`;

const listing = (rows: string[], lastPage = 1, path = 'sort/top-hot-novel') =>
  `<html><body><div class="list list-novel col-xs-12">${rows.join('')}</div>
    <ul class="pagination">${Array.from({ length: lastPage }, (_, i) => `<li><a href="${BASE}/${path}?page=${i + 1}">${i + 1}</a></li>`).join('')}</ul></body></html>`;

const info = (genres: string[], status = 'Ongoing') => `
  <ul class="info info-meta">
    <li><h3>Author:</h3> <a href="${BASE}/a/Writer">Writer</a></li>
    <li class="meta-chip-row"><h3>Genre:</h3> ${genres.map((g) => `<a class="meta-chip" href="${BASE}/genre/${g.toLowerCase()}">${g}</a>`).join(' ')}</li>
    <li><h3>Status:</h3> <a href="${BASE}/sort/ongoing" class="text-primary">${status}</a></li>
  </ul>`;

const novelPage = (genres: string[] = ['Action', 'Fantasy'], status = 'Ongoing') => `
  <html><head><meta property="og:image" content="https://images.novelbin.com/novel/my-novel.jpg"></head><body>
    <h3 class="title">My Novel</h3>
    ${info(genres, status)}
    <div class="desc-text" itemprop="description"><p>First paragraph.</p><p>Second paragraph.</p></div>
    <div class="l-chapter"><div class="item-title">Latest chapter</div><div class="item-value"><a class="chapter-title" href="${BASE}/b/my-novel/chapter-228-end" title="Chapter 228 ·The End">Chapter 228 ·The End</a></div></div>
  </body></html>`;

const archive = (items: [string, string][]) =>
  `<ul class="list-chapter">${items.map(([slug, title]) => `<li><a href="${BASE}/b/my-novel/${slug}" title="${title}"><span class="nchr-text chapter-title">${title}</span></a></li>`).join('')}</ul>`;

// --- browsing and searching -------------------------------------------------------

describe('browsing and searching', () => {
  it('is a novel source', () => {
    expect(p.kind).toBe('novel');
  });

  it('parses the listing rows and the full-size cover', async () => {
    const f = mockFetch([['/sort/top-hot-novel', listing([row('a-novel', 'A Novel', 'Ann'), row('b-novel', 'B Novel')], 10)]]);
    const page = await p.search(searchOpts());
    expect(f.mock.calls[0][0]).toBe(`${BASE}/sort/top-hot-novel`);
    expect(page.items[0]).toMatchObject({
      id: 'a-novel',
      title: 'A Novel',
      authors: ['Ann'],
      type: 'novel',
      coverUrl: 'https://images.novelbin.com/novel_80_113/a-novel.jpg',
      coverUrlLarge: 'https://images.novelbin.com/novel/a-novel.jpg',
    });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(200); // 10 pages of 20
  });

  it('uses the latest-updates list when asked to sort by update, and pages with ?page=N', async () => {
    const f = mockFetch([['/sort/latest', listing([row('a', 'A')], 3, 'sort/latest')]]);
    await p.search(searchOpts({ order: 'latestUploadedChapter', offset: 20 }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/sort/latest?page=2`);
  });

  it('searches by keyword', async () => {
    const f = mockFetch([['/search', listing([row('cultivate', 'Cultivate')], 1, 'search')]]);
    const page = await p.search(searchOpts({ title: 'cultivate me', offset: 0 }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/search?keyword=cultivate%20me`);
    expect(page.items).toHaveLength(1);
  });
});

// --- details and chapters ----------------------------------------------------------------

describe('a novel', () => {
  it('reads the details', async () => {
    mockFetch([['/b/my-novel', novelPage(['Action', 'Fantasy'], 'Completed')]]);
    const m = await p.getManga('my-novel');
    expect(m).toMatchObject({
      id: 'my-novel',
      title: 'My Novel',
      type: 'novel',
      authors: ['Writer'],
      tags: ['Action', 'Fantasy'],
      pubStatus: 'completed',
      description: 'First paragraph.\n\nSecond paragraph.',
      contentRating: 'safe',
      lastChapter: '228',
      latestUploadedChapter: 'Chapter 228',
    });
  });

  it('rates a title from its genres', async () => {
    mockFetch([['/b/', novelPage(['Fantasy', 'Mature'])]]);
    expect((await p.getManga('my-novel')).contentRating).toBe('suggestive');
    mockFetch([['/b/', novelPage(['Adult'])]]);
    expect((await p.getManga('my-novel')).contentRating).toBe('pornographic');
  });

  it('reads the chapter list from the chapter archive fragment', async () => {
    const f = mockFetch([
      [
        '/ajax/chapter-archive',
        archive([
          ['chapter-1-the-start', 'Chapter 1 : The Start'],
          ['chapter-2-next', 'Chapter 2 - Next'],
          ['chapter-2-5-bonus', 'Chapter 2.5: Bonus'],
          ['prologue', 'Prologue'],
        ]),
      ],
    ]);
    const chapters = await p.getChapters(fakeManga('my-novel'), 'en');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/ajax/chapter-archive?novelId=my-novel`);
    expect(chapters.map((c) => [c.key, c.chapter, c.title])).toEqual([
      ['1', '1', 'The Start'],
      ['2', '2', 'Next'],
      ['2.5', '2.5', 'Bonus'],
      ['id:prologue', null, 'Prologue'],
    ]);
    expect(chapters[0]).toMatchObject({ id: 'my-novel~chapter-1-the-start', pages: 1, externalUrl: null });
  });

  it('does not list a chapter number twice', async () => {
    mockFetch([['/ajax/', archive([['chapter-1-a', 'Chapter 1 : A'], ['chapter-1-b', 'Chapter 1 : B']])]]);
    expect(await p.getChapters(fakeManga('my-novel'), 'en')).toHaveLength(1);
  });
});

// --- chapter text -------------------------------------------------------------------------

describe('chapter text', () => {
  it('returns the paragraphs of the chapter and asks for the right page', async () => {
    const f = mockFetch([
      [
        '/b/my-novel/chapter-1-the-start',
        `<html><body><div id="chr-content" class="chr-c">
           <p>【A note.】</p><p>Great Qian Dynasty.</p><p> </p>
         </div><p>Footer text that is not the chapter.</p></body></html>`,
      ],
    ]);
    expect(await p.getChapterText!('my-novel~chapter-1-the-start')).toEqual(['【A note.】', 'Great Qian Dynasty.']);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/b/my-novel/chapter-1-the-start`);
  });

  it('rejects an id that is not a chapter id, and a page without text', async () => {
    await expect(p.getChapterText!('nonsense')).rejects.toThrow(/Unknown chapter/);
    mockFetch([['/b/', '<html><body><div id="chr-content"></div></body></html>']]);
    await expect(p.getChapterText!('my-novel~c')).rejects.toThrow(/No text found/);
  });
});
