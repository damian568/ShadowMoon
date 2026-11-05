import { manga18clubProvider as p } from '../providers/manga18club';
import { fakeManga, instantTimers, mockFetch, searchOpts } from './helpers';

const BASE = 'https://manga18.club';

beforeEach(() => {
  instantTimers();
});
afterEach(() => jest.restoreAllMocks());

// --- fixtures --------------------------------------------------------------

const card = (slug: string, title: string, chapter = 'Chapter 84') => `
  <div class="story_item">
    <div class="story_images"><a href="${BASE}/manhwa/${slug}" title="${title}"><img src="https://cdn.test/${slug}.webp" alt=""></a></div>
    <div class="mg_info">
      <div class="mg_name"><a href="${BASE}/manhwa/${slug}">${title}</a></div>
      <div class="mg_chapter"><div class="item"><div class="chapter_count"><a href="/manhwa/${slug}/chapter-84">${chapter}</a></div></div></div>
    </div>
  </div>`;

const listing = (cards: string[], next = false) =>
  `<html><body>${cards.join('')}<ul class="pagination"><li class="active"><a href="/list-manga/1">1</a></li>${next ? '<li><a href="/list-manga/2">&rsaquo;</a></li>' : ''}</ul></body></html>`;

const row = (slug: string, chapterSlug: string, label: string, date: string) =>
  `<li><div class="item"><a href="/manhwa/${slug}/${chapterSlug}" class="chapter_num">${label}</a><p class="chapter_info">${date}</p><p class="chapter_info">1,000</p></div></li>`;

const titlePage = (rows: string[]) => `
  <html><body>
    <div class="detail_avatar"><img src="https://cdn.test/cover.jpg"></div>
    <div class="detail_name"><h1>My Title</h1></div>
    <div class="detail_listInfo">
      <div class="item"><div class="info_label">Other name</div><div class="info_value"><span>Alt One, Alt Two</span></div></div>
      <div class="item"><div class="info_label">Author</div><div class="info_value"><a href="/x">Wang</a></div></div>
      <div class="item"><div class="info_label">Artist</div><div class="info_value"><a href="/y">Mina</a></div></div>
      <div class="item"><div class="info_label">Status</div><div class="info_value"><span class="label">On Going</span></div></div>
      <div class="item"><div class="info_label">Categories</div><div class="info_value"><a>Adult</a> - <a>Romance</a> - <a>Manhwa</a></div></div>
    </div>
    <div class="detail_reviewContent">The real synopsis.</div>
    <div class="chapter_box"><ul>${rows.join('')}</ul></div>
  </body></html>`;

const b64 = (s: string) => btoa(s);

// --- search ------------------------------------------------------------------

describe('browsing and searching', () => {
  it('parses the list cards and marks everything as adult', async () => {
    const f = mockFetch([['/list-manga/', listing([card('a-title', 'A Title'), card('b-title', 'B Title')], true)]]);
    const page = await p.search(searchOpts({ order: 'followedCount' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/list-manga/?page=1&order_by=views`);
    expect(page.items[0]).toMatchObject({
      id: 'a-title',
      title: 'A Title',
      coverUrl: 'https://cdn.test/a-title.webp',
      lastChapter: '84',
      contentRating: 'pornographic',
      type: 'other',
    });
    expect(page.total).toBeGreaterThan(page.items.length); // there is a next page
  });

  it('pages 20 at a time and uses the latest-update order', async () => {
    const f = mockFetch([['/list-manga/', listing([card('a', 'A')])]]);
    const last = await p.search(searchOpts({ offset: 40, order: 'latestUploadedChapter' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/list-manga/?page=3&order_by=lastest`);
    expect(last.total).toBe(41); // no next link: nothing after this page
  });

  it('searches with the site search, never the disallowed api search', async () => {
    const f = mockFetch([['search=', listing([card('x', 'X')])]]);
    await p.search(searchOpts({ title: '  love & war ' }));
    expect(f.mock.calls[0][0]).toBe(`${BASE}/list-manga/?page=1&search=love%20%26%20war`);
    expect(f.mock.calls[0][0]).not.toContain('/api');
  });

  it('shows nothing when mature titles are off', async () => {
    mockFetch([['/list-manga/', listing([card('a', 'A')])]]);
    expect((await p.search(searchOpts({ ratings: ['safe', 'suggestive'] }))).items).toEqual([]);
  });

  it('returns nothing for a search with no matches', async () => {
    mockFetch([['search=', '<html><body><p>none</p></body></html>']]);
    await expect(p.search(searchOpts({ title: 'zzz' }))).resolves.toMatchObject({ items: [], total: 0 });
  });
});

// --- details and chapters -------------------------------------------------------

describe('getManga', () => {
  it('reads the details from the info box', async () => {
    const f = mockFetch([
      ['/manhwa/my-title', titlePage([row('my-title', 'chapter-2', 'Chapter 2', '05-11-2026'), row('my-title', 'chap-1', 'Chapter 1', '11-06-2021')])],
    ]);
    const m = await p.getManga('my-title');
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manhwa/my-title`);
    expect(m).toMatchObject({
      id: 'my-title',
      title: 'My Title',
      altTitle: 'Alt One',
      authors: ['Wang', 'Mina'],
      pubStatus: 'ongoing',
      type: 'manhwa',
      tags: ['Adult', 'Romance'],
      description: 'The real synopsis.',
      lastChapter: '2',
      contentRating: 'pornographic',
      coverUrl: 'https://cdn.test/cover.jpg',
    });
  });

  it('fails clearly when the title cannot be read', async () => {
    mockFetch([['/manhwa/', '<p>nope</p>']]);
    await expect(p.getManga('x')).rejects.toThrow('Could not read this title from Manga18.club.');
  });
});

describe('getChapters', () => {
  it('lists chapters oldest first using the addresses on the page (some are not "chapter-N")', async () => {
    mockFetch([
      [
        '/manhwa/my-title',
        titlePage([
          row('my-title', 'chapter-2', 'Chapter 2', '05-11-2026'),
          row('my-title', 'chapter-1-5', 'Chapter 1.5', '01-01-2022'),
          row('my-title', 'chap-1', 'Chapter 1', '11-06-2021'),
        ]),
      ],
    ]);
    const list = await p.getChapters(fakeManga('my-title'), 'en');
    expect(list.map((c) => c.chapter)).toEqual(['1', '1.5', '2']);
    expect(list[0].id).toBe('my-title/chap-1');
    expect(list[2].readableAt).toBe('2026-11-05T00:00:00.000Z'); // day-month-year
    expect(list[0].readableAt).toBe('2021-06-11T00:00:00.000Z');
  });

  it('drops duplicates and returns an empty list for a title with no chapters', async () => {
    mockFetch([
      ['/manhwa/my-title', titlePage([row('my-title', 'chapter-2', 'Chapter 2', '05-11-2026'), row('my-title', 'chapter-2-again', 'Chapter 2', '05-11-2026')])],
    ]);
    expect(await p.getChapters(fakeManga('my-title'), 'en')).toHaveLength(1);
    mockFetch([['/manhwa/my-title', titlePage([])]]);
    expect(await p.getChapters(fakeManga('my-title'), 'en')).toEqual([]);
  });
});

describe('getChapterPages', () => {
  it('decodes the base64 image list in the page, in order and without duplicates', async () => {
    const list = [b64('https://cdn.test/01.jpg'), b64('https://cdn.test/02.jpg'), b64('https://cdn.test/01.jpg')];
    const f = mockFetch([['/manhwa/my-title/chapter-2', `<script>var slides_p_path = [${list.map((x) => `"${x}"`).join(',')},];</script>`]]);
    await expect(p.getChapterPages('my-title/chapter-2', false)).resolves.toEqual(['https://cdn.test/01.jpg', 'https://cdn.test/02.jpg']);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/manhwa/my-title/chapter-2`);
  });

  it('skips values that are not web addresses and fails clearly when none remain', async () => {
    mockFetch([['/manhwa/', `<script>var slides_p_path = ["${b64('not a url')}"];</script>`]]);
    await expect(p.getChapterPages('a/b', false)).rejects.toThrow('No pages found for this chapter.');
  });
});

describe('metadata', () => {
  it('is an 18+ source with a name and an icon', () => {
    expect(p).toMatchObject({ id: 'manga18club', name: 'Manga18.club', adult: true });
    expect(p.iconUrl).toContain('manga18.club');
  });
});
