import { parse } from 'node-html-parser';

import { getHtml, getHtmlText, imgUrl, parseReleaseDate, text } from '../providers/html';
import { instantTimers, mockFetch } from './helpers';

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('parseReleaseDate', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-04T12:00:00.000Z')));

  it.each([
    ['30 secs ago', '2026-11-04T11:59:30.000Z'],
    ['5 mins ago', '2026-11-04T11:55:00.000Z'],
    ['2 hours ago', '2026-11-04T10:00:00.000Z'],
    ['2 days ago', '2026-11-02T12:00:00.000Z'],
    ['1 week ago', '2026-10-28T12:00:00.000Z'],
    ['about 2 months', '2026-09-05T12:00:00.000Z'],
    ['1 year ago', '2025-11-04T12:00:00.000Z'],
  ])('reads relative dates: %s', (raw, iso) => {
    expect(parseReleaseDate(raw)).toBe(iso);
  });

  it('reads "yesterday"', () => {
    expect(parseReleaseDate('Yesterday')).toBe('2026-11-03T12:00:00.000Z');
  });

  it('reads absolute dates', () => {
    expect(new Date(parseReleaseDate('March 3, 2024')).getFullYear()).toBe(2024);
  });

  it('falls back to now for anything it cannot read', () => {
    expect(parseReleaseDate('')).toBe('2026-11-04T12:00:00.000Z');
    expect(parseReleaseDate('soon™')).toBe('2026-11-04T12:00:00.000Z');
  });
});

describe('text and imgUrl', () => {
  const el = (html: string) => parse(html).firstChild as ReturnType<typeof parse>;

  it('text collapses whitespace and handles missing elements', () => {
    expect(text(el('<p>  Hello \n\t world  </p>'))).toBe('Hello world');
    expect(text(null)).toBe('');
    expect(text(undefined)).toBe('');
  });

  it('imgUrl prefers lazy-load attributes and trims stray whitespace', () => {
    expect(imgUrl(el('<img src="a.jpg" data-src="  https://x.test/b.jpg\n">'))).toBe('https://x.test/b.jpg');
    expect(imgUrl(el('<img src="\n\t\thttps://x.test/c.jpg">'))).toBe('https://x.test/c.jpg');
  });

  it('imgUrl makes protocol-relative URLs absolute', () => {
    expect(imgUrl(el('<img src="//cdn.test/d.png">'))).toBe('https://cdn.test/d.png');
  });

  it('imgUrl falls back to the first srcset entry', () => {
    expect(imgUrl(el('<img srcset="https://x.test/e.png 1x, https://x.test/f.png 2x">'))).toBe('https://x.test/e.png');
  });

  it('imgUrl ignores inline data: placeholders and missing images', () => {
    expect(imgUrl(el('<img src="data:image/gif;base64,AAAA">'))).toBe('');
    expect(imgUrl(null)).toBe('');
  });
});

describe('getHtmlText', () => {
  beforeEach(() => {
    instantTimers();
  });

  it('returns the page body', async () => {
    const fetchMock = mockFetch([['site.test', '<p>hi</p>']]);
    await expect(getHtmlText('https://site.test/a', 'Site')).resolves.toBe('<p>hi</p>');
    expect(fetchMock).toHaveBeenCalledWith('https://site.test/a', expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('sends a browser-like User-Agent', async () => {
    const fetchMock = mockFetch([['site.test', 'ok']]);
    await getHtmlText('https://site.test/', 'Site');
    const headers = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;
    expect(headers['User-Agent']).toMatch(/Mozilla/);
  });

  it('retries a rate-limited request and then succeeds', async () => {
    let calls = 0;
    const fetchMock = mockFetch([['site.test', () => (++calls < 3 ? { status: 429 } : '<p>finally</p>')]]);
    await expect(getHtmlText('https://site.test/', 'Site')).resolves.toBe('<p>finally</p>');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after repeated server errors', async () => {
    const fetchMock = mockFetch([['site.test', { status: 500 }]]);
    await expect(getHtmlText('https://site.test/', 'Site')).rejects.toThrow('Site request failed (500)');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('explains a 404', async () => {
    mockFetch([['site.test', { status: 404 }]]);
    await expect(getHtmlText('https://site.test/x', 'Site')).rejects.toThrow('Not found on Site.');
  });

  it.each([403, 503])('reports bot protection on a %i', async (status) => {
    mockFetch([['site.test', { status }]]);
    await expect(getHtmlText('https://site.test/', 'Site')).rejects.toThrow(/Site blocked the request \(bot protection\)/);
  });

  it('recognises a Cloudflare "Just a moment" page served with status 200', async () => {
    mockFetch([['site.test', '<html><head><title>Just a moment...</title></head></html>']]);
    await expect(getHtmlText('https://site.test/', 'Site')).rejects.toThrow(/Site is showing a bot check/);
  });

  it('turns a network failure into a friendly message', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as unknown as typeof fetch;
    await expect(getHtmlText('https://site.test/', 'Site')).rejects.toThrow('Network error — check your internet connection.');
  });

  it('getHtml parses the page', async () => {
    mockFetch([['site.test', '<h1 id="t">Title</h1>']]);
    const doc = await getHtml('https://site.test/', 'Site');
    expect(text(doc.querySelector('#t'))).toBe('Title');
  });
});
