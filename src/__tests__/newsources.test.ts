/**
 * Tests for TCB Scans, ReadNovelFull, FreeWebNovel and ManhuaPlus. The pages are small copies of the real markup;
 * nothing touches the network.
 */
import { freewebnovelProvider as fwn } from '../providers/freewebnovel';
import { manhuaplusProvider as mhp } from '../providers/manhuaplus';
import { readnovelfullProvider as rnf } from '../providers/readnovelfull';
import { tcbscansProvider as tcb, _resetCache } from '../providers/tcbscans';
import { fakeManga, instantTimers, mockFetch, searchOpts } from './helpers';

beforeEach(() => {
  instantTimers();
  _resetCache();
});
afterEach(() => jest.restoreAllMocks());

// --- TCB Scans -----------------------------------------------------------------

describe('TCB Scans', () => {
  const T = 'https://tcbonepiecechapters.com';
  const series = (n: number, slug: string, title: string) =>
    `<div class="row"><a href="/mangas/${n}/${slug}"><img src="https://cdn.example.com/${slug}.png" alt="${title}"></a>
       <a class="font-bold" href="/mangas/${n}/${slug}">${title}</a></div>`;
  const projects = `<html><body>${series(5, 'one-piece', 'One Piece')}${series(8, 'attack-on-titan', 'Attack on Titan')}</body></html>`;
  const chapterRow = (n: number, slug: string, num: number, name: string) =>
    `<a href="/chapters/${n}/${slug}-chapter-${num}" class="block"><div class="text-lg">One Piece Chapter ${num}</div><div class="text-gray-500">${name}</div></a>`;
  const seriesPage = `<html><body><h1>One Piece</h1><img src="/files/h-logo.png"><img src="https://cdn.example.com/one-piece.png">
    <p class="leading-6 my-3">The pirate story.</p>
    ${chapterRow(8012, 'one-piece', 2, 'Second')}${chapterRow(8011, 'one-piece', 1, 'First')}</body></html>`;

  it('lists the series and searches that list (the site has no search)', async () => {
    const f = mockFetch([['/projects', projects]]);
    const all = await tcb.search(searchOpts());
    expect(all.items.map((m) => m.title)).toEqual(['One Piece', 'Attack on Titan']);
    expect(all.items[0]).toMatchObject({ id: '5~one-piece', type: 'manga', coverUrl: 'https://cdn.example.com/one-piece.png' });
    const found = await tcb.search(searchOpts({ title: 'titan' }));
    expect(found.items.map((m) => m.id)).toEqual(['8~attack-on-titan']);
    expect(found.total).toBe(1);
    expect(f).toHaveBeenCalledTimes(1); // the list is cached
  });

  it('reads details and the chapter list, oldest first', async () => {
    const f = mockFetch([['/mangas/5/one-piece', seriesPage]]);
    const m = await tcb.getManga('5~one-piece');
    expect(f.mock.calls[0][0]).toBe(`${T}/mangas/5/one-piece`);
    expect(m).toMatchObject({ title: 'One Piece', description: 'The pirate story.', coverUrl: 'https://cdn.example.com/one-piece.png', lastChapter: '2' });
    const chapters = await tcb.getChapters(fakeManga('5~one-piece'), 'en');
    expect(chapters.map((c) => [c.id, c.chapter, c.title])).toEqual([
      ['8011~one-piece-chapter-1', '1', 'First'],
      ['8012~one-piece-chapter-2', '2', 'Second'],
    ]);
  });

  it('returns the page images of a chapter', async () => {
    const f = mockFetch([
      ['/chapters/8011/', '<html><body><img src="/files/h-logo.png"><img class="fixed-ratio-content" src="https://cdn.example.com/1.png"><img class="fixed-ratio-content" src="https://cdn.example.com/2.png"></body></html>'],
    ]);
    expect(await tcb.getChapterPages('8011~one-piece-chapter-1', false)).toEqual(['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png']);
    expect(f.mock.calls[0][0]).toBe(`${T}/chapters/8011/one-piece-chapter-1`);
  });

  it('fails clearly on a page without images or a list without series', async () => {
    mockFetch([['/chapters/', '<html></html>']]);
    await expect(tcb.getChapterPages('1~x', false)).rejects.toThrow(/No pages/);
    _resetCache();
    mockFetch([['/projects', '<html></html>']]);
    await expect(tcb.search(searchOpts())).rejects.toThrow(/series list/);
  });
});

// --- ReadNovelFull -----------------------------------------------------------------

describe('ReadNovelFull', () => {
  const B = 'https://readnovelfull.com';
  const row = (id: string, title: string) =>
    `<div class="row"><div class="col-xs-3"><img src="https://img.readnovelfull.com/thumb/t-80x113/${id}.jpg" alt="${title}"></div>
     <div class="col-xs-7"><h3 class="novel-title"><a href="/${id}.html" title="${title}">${title}</a></h3><span class="author"> Writer </span></div></div>`;
  const listing = (rows: string[], last = 1) =>
    `<html><body><div class="list list-novel">${rows.join('')}</div><ul class="pagination"><li><a href="/novel-list/most-popular-novel?page=${last}">Last</a></li></ul></body></html>`;
  const novel = `<html><body><div class="book"><img src="https://img.readnovelfull.com/thumb/t-300x439/a.jpg"></div>
    <h3 class="title">A Novel</h3>
    <ul class="info"><li><h3>Author:</h3><a>Ann</a></li><li><h3>Genre:</h3><a>Fantasy</a>, <a>Mature</a></li><li><h3>Status:</h3><a>Ongoing</a></li></ul>
    <div class="desc-text"><p>Para one.</p><p>Para two.</p></div>
    <div id="rating" data-novel-id="276"></div>
    <div class="l-chapter"><a title="Chapter 12">Chapter 12</a></div></body></html>`;
  const archive = `<ul><li><a href="/a-novel/chapter-001-the-start.html" title="Chapter 001 - The Start">x</a></li>
    <li><a href="/a-novel/chapter-002-next.html" title="Chapter 002: Next">x</a></li></ul>`;

  it('lists, pages and searches', async () => {
    const f = mockFetch([['/novel-list/', listing([row('a-novel-v1', 'A Novel')], 5)]]);
    const page = await rnf.search(searchOpts({ order: 'latestUploadedChapter', offset: 20 }));
    expect(f.mock.calls[0][0]).toBe(`${B}/novel-list/latest-release-novel?page=2`);
    expect(page.items[0]).toMatchObject({
      id: 'a-novel-v1',
      type: 'novel',
      authors: ['Writer'],
      coverUrl: 'https://img.readnovelfull.com/thumb/t-80x113/a-novel-v1.jpg',
      coverUrlLarge: 'https://img.readnovelfull.com/thumb/t-300x439/a-novel-v1.jpg',
    });
    expect(page.total).toBe(100);
    await rnf.search(searchOpts({ title: 'dan god' }));
    expect(f.mock.calls[1][0]).toBe(`${B}/novel-list/search?keyword=dan%20god`);
  });

  it('reads details, then the chapter list through the site\'s numeric id', async () => {
    const f = mockFetch([['/ajax/chapter-archive', archive], ['/a-novel-v1.html', novel]]);
    const m = await rnf.getManga('a-novel-v1');
    expect(m).toMatchObject({
      title: 'A Novel',
      authors: ['Ann'],
      tags: ['Fantasy', 'Mature'],
      pubStatus: 'ongoing',
      contentRating: 'suggestive',
      description: 'Para one.\n\nPara two.',
      lastChapter: '12',
    });
    const chapters = await rnf.getChapters(fakeManga('a-novel-v1'), 'en');
    expect(f.mock.calls.map((c) => c[0])).toContain(`${B}/ajax/chapter-archive?novelId=276`);
    expect(chapters.map((c) => [c.id, c.key, c.title])).toEqual([
      ['a-novel~chapter-001-the-start', '1', 'The Start'],
      ['a-novel~chapter-002-next', '2', 'Next'],
    ]);
  });

  it('reads chapter text without the repeated title line', async () => {
    const f = mockFetch([['/a-novel/chapter-001-the-start.html', '<div id="chr-content"><p>Chapter 001: The Start</p><p>It began.</p><p>Then more.</p></div>']]);
    expect(await rnf.getChapterText!('a-novel~chapter-001-the-start')).toEqual(['It began.', 'Then more.']);
    expect(f.mock.calls[0][0]).toBe(`${B}/a-novel/chapter-001-the-start.html`);
    await expect(rnf.getChapterText!('nonsense')).rejects.toThrow(/Unknown chapter/);
  });
});

// --- FreeWebNovel -----------------------------------------------------------------

describe('FreeWebNovel', () => {
  const B = 'https://freewebnovel.com';
  const row = (slug: string, title: string) =>
    `<div class="li-row"><div class="li"><div class="pic"><a href="/novel/${slug}"><img src="/files/article/image/1/${slug}.jpg"></a></div>
     <h3 class="tit"><a href="/novel/${slug}" title="${title}">${title}</a></h3></div></div>`;
  const novel = `<html><head>
    <meta property="og:image" content="${B}/files/cover.jpg">
    <meta property="og:novel:genre" content="Action, Mature">
    <meta property="og:novel:author" content="Guilty">
    <meta property="og:novel:status" content="OnGoing">
    <meta property="og:novel:lastest_chapter_name" content="Chapter 5 The End">
    <meta property="og:novel:lastest_chapter_url" content="${B}/novel/my-novel/chapter-5">
  </head><body><h1>My Novel</h1><div class="inner"><p>Story one.</p></div>
    <ul class="ul-list5"><li><a href="/novel/my-novel/chapter-5" title="Chapter 5 The End">Chapter 5 The End</a></li><li><a href="/novel/my-novel/chapter-4" title="Chapter 4 Before">Chapter 4 Before</a></li></ul></body></html>`;

  it('browses a sorted list, paging with /sort/<sort>/N', async () => {
    const f = mockFetch([['/sort/', `<html><body>${row('shadow-slave', 'Shadow Slave')}<a href="/sort/most-popular/5">5</a></body></html>`]]);
    const page = await fwn.search(searchOpts({ offset: 20 }));
    expect(f.mock.calls[0][0]).toBe(`${B}/sort/most-popular/2`);
    expect(page.items[0]).toMatchObject({ id: 'shadow-slave', type: 'novel', coverUrl: `${B}/files/article/image/1/shadow-slave.jpg` });
    expect(page.total).toBe(100);
  });

  it('searches with the site\'s own search form (a POST)', async () => {
    const f = mockFetch([['/search', `<html><body>${row('a', 'A')}${row('b', 'B')}</body></html>`]]);
    const page = await fwn.search(searchOpts({ title: 'shadow' }));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${B}/search`);
    expect(init.method).toBe('POST');
    expect(String(init.body)).toBe('keyword=shadow');
    expect(page.items.map((m) => m.id)).toEqual(['a', 'b']);
    expect((await fwn.search(searchOpts({ title: 'shadow', offset: 20 }))).items).toEqual([]); // a single page of matches
  });

  it('reads details from the page metadata', async () => {
    mockFetch([['/novel/my-novel', novel]]);
    expect(await fwn.getManga('my-novel')).toMatchObject({
      title: 'My Novel',
      authors: ['Guilty'],
      tags: ['Action', 'Mature'],
      pubStatus: 'ongoing',
      contentRating: 'suggestive',
      description: 'Story one.',
      lastChapter: '5',
      latestUploadedChapter: 'Chapter 5',
    });
  });

  it('rebuilds the whole chapter list 1…N, naming the ones the page shows', async () => {
    mockFetch([['/novel/my-novel', novel]]);
    const chapters = await fwn.getChapters(fakeManga('my-novel'), 'en');
    expect(chapters.map((c) => c.key)).toEqual(['1', '2', '3', '4', '5']);
    expect(chapters[0]).toMatchObject({ id: 'my-novel~1', title: null, pages: 1 });
    expect(chapters[3].title).toBe('Before');
    expect(chapters[4].title).toBe('The End');
  });

  it('reads chapter text', async () => {
    const f = mockFetch([['/chapter-2', '<div id="article"><p>One.</p><p> </p><p>Two.</p></div>']]);
    expect(await fwn.getChapterText!('my-novel~2')).toEqual(['One.', 'Two.']);
    expect(f.mock.calls[0][0]).toBe(`${B}/novel/my-novel/chapter-2`);
    await expect(fwn.getChapterText!('nonsense')).rejects.toThrow(/Unknown chapter/);
  });
});

// --- ManhuaPlus (a Madara site, same parser as MangaRead) -----------------------------

describe('ManhuaPlus', () => {
  it('uses its own address and name', async () => {
    const f = mockFetch([['/manga/', '<html><body><div class="page-item-detail"><h3 class="h5"><a href="https://manhuaplus.com/manga/martial-peak/">Martial Peak</a></h3></div></body></html>']]);
    const page = await mhp.search(searchOpts());
    expect(String(f.mock.calls[0][0]).startsWith('https://manhuaplus.com/manga/')).toBe(true);
    expect(page.items[0]).toMatchObject({ id: 'martial-peak', title: 'Martial Peak' });
    expect(mhp.name).toBe('ManhuaPlus');
  });

  it('names the site in errors', async () => {
    mockFetch([['/manga/', { status: 403 }]]);
    await expect(mhp.getManga('x')).rejects.toThrow(/ManhuaPlus blocked/);
  });
});
