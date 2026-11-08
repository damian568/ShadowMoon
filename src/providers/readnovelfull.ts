/**
 * ReadNovelFull provider — https://readnovelfull.com
 *
 * Translated web and light novels. No API, so this reads its public HTML. Its robots.txt allows the pages used here
 * (and names /ajax/chapter-archive as allowed). The site runs the same engine as NovelBin:
 *  - /novel-list/most-popular-novel, /novel-list/latest-release-novel   the listings (20 per page, ?page=N);
 *  - /novel-list/search?keyword=…                                       search;
 *  - /<slug>.html                                                       details (carries the numeric novel id);
 *  - /ajax/chapter-archive?novelId=<number>                             the full chapter list, as a plain HTML fragment;
 *  - /<novel>/<chapter>.html                                            the chapter text (paragraphs in `#chr-content`).
 *
 * A title's id is its page name ("world-defying-dan-god-v1"); a chapter id is "<novel>~<chapter>".
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, imgUrl, text } from './html';
import type { Chapter, ContentRating, Manga, Page, Provider, SearchOptions, SortOrder } from './types';

const BASE = 'https://readnovelfull.com';
const NAME = 'ReadNovelFull';
const PAGE_SIZE = 20;

const SORT_PATH: Partial<Record<SortOrder, string>> = {
  followedCount: 'most-popular-novel',
  latestUploadedChapter: 'latest-release-novel',
};

function statusFrom(label: string | undefined): string {
  const v = (label ?? '').toLowerCase();
  if (v.includes('ongoing')) return 'ongoing';
  if (v.includes('complete')) return 'completed';
  if (v.includes('hiatus')) return 'hiatus';
  if (v.includes('drop') || v.includes('cancel')) return 'cancelled';
  return 'unknown';
}

function ratingFromTags(tags: string[]): ContentRating {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => ['adult', 'smut', 'hentai'].includes(x))) return 'pornographic';
  if (t.some((x) => ['mature', 'ecchi'].includes(x))) return 'suggestive';
  return 'safe';
}

const absolute = (url: string) => (url.startsWith('/') ? `${BASE}${url}` : url);
/** Lists show small thumbnails ("…/t-80x113/…"); the title page has a bigger one ("…/t-300x439/…"). */
const largeCover = (url: string) => url.replace(/\/t-\d+x\d+\//, '/t-300x439/');

function blank(id: string, title: string, cover: string): Manga {
  return {
    id,
    title,
    description: '',
    coverUrl: cover,
    coverUrlLarge: largeCover(cover),
    type: 'novel',
    originalLanguage: 'en',
    pubStatus: 'unknown',
    year: null,
    contentRating: 'safe',
    tags: [],
    authors: [],
    lastChapter: null,
    latestUploadedChapter: null,
    availableLanguages: ['en'],
    chapterNumbersResetOnNewVolume: false,
  };
}

/** "/world-defying-dan-god-v1.html" -> "world-defying-dan-god-v1" */
const idOf = (href: string | undefined) => href?.match(/^(?:https?:\/\/[^/]+)?\/([^/?#]+?)\.html/)?.[1];

function parseRow(row: HTMLElement): Manga | null {
  const link = row.querySelector('.novel-title a');
  const id = idOf(link?.getAttribute('href'));
  const title = text(link);
  if (!link || !id || !title) return null;
  const m = blank(decodeURIComponent(id), title, absolute(imgUrl(row.querySelector('img'))));
  const author = text(row.querySelector('.author'));
  if (author) m.authors = [author];
  return m;
}

function lastPage(doc: HTMLElement): number {
  const pages = doc
    .querySelectorAll('ul.pagination a')
    .map((a) => Number(a.getAttribute('href')?.match(/[?&]page=(\d+)/)?.[1]))
    .filter((n) => Number.isFinite(n));
  return pages.length ? Math.max(...pages) : 1;
}

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const title = opts.title?.trim();
  const paging = page > 1 ? `page=${page}` : '';
  const url = title
    ? `${BASE}/novel-list/search?keyword=${encodeURIComponent(title)}${paging ? `&${paging}` : ''}`
    : `${BASE}/novel-list/${SORT_PATH[opts.order ?? 'followedCount'] ?? 'most-popular-novel'}${paging ? `?${paging}` : ''}`;
  const doc = await getHtml(url, NAME);

  const items = doc
    .querySelectorAll('.list-novel .row')
    .map(parseRow)
    .filter((m): m is Manga => !!m);
  return { items, total: lastPage(doc) * PAGE_SIZE, offset, limit: PAGE_SIZE };
}

const chapterNumberOf = (label: string): string | null => {
  const n = label.match(/^(?:vol(?:ume)?\.?\s*\d+\s*)?ch(?:apter)?\.?\s*(\d+(?:\.\d+)?)/i)?.[1];
  return n == null ? null : String(parseFloat(n)); // "001" -> "1"
};

const novelPage = (id: string) => `${BASE}/${encodeURIComponent(id)}.html`;

async function readNovel(id: string): Promise<{ manga: Manga; novelId: string | null }> {
  const doc = await getHtml(novelPage(id), NAME);
  const title = text(doc.querySelector('h3.title')) || text(doc.querySelector('h1'));
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);
  const cover = absolute(doc.querySelector('.book img')?.getAttribute('src') ?? doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '');
  const m = blank(id, title, cover);
  m.description = doc
    .querySelectorAll('.desc-text p')
    .map((p) => text(p))
    .filter(Boolean)
    .join('\n\n');
  if (!m.description) m.description = text(doc.querySelector('.desc-text'));

  for (const li of doc.querySelectorAll('ul.info li')) {
    const label = text(li.querySelector('h3')).replace(/:$/, '').toLowerCase();
    if (label === 'author') m.authors = li.querySelectorAll('a').map((a) => text(a)).filter(Boolean);
    else if (label === 'genre') m.tags = li.querySelectorAll('a').map((a) => text(a)).filter(Boolean);
    else if (label === 'status') m.pubStatus = statusFrom(text(li.querySelector('a')) || text(li));
  }
  m.contentRating = ratingFromTags(m.tags);

  const latestNum = chapterNumberOf(text(doc.querySelectorAll('.l-chapter a').pop()));
  if (latestNum) {
    m.lastChapter = latestNum;
    m.latestUploadedChapter = `Chapter ${latestNum}`;
  }
  const novelId = doc.querySelector('[data-novel-id]')?.getAttribute('data-novel-id') ?? null;
  return { manga: m, novelId };
}

async function getManga(id: string): Promise<Manga> {
  return (await readNovel(id)).manga;
}

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  const { novelId } = await readNovel(manga.id); // the chapter list is asked for by the site's numeric id
  if (!novelId) throw new Error(`Could not find the chapter list on ${NAME}.`);
  const doc = await getHtml(`${BASE}/ajax/chapter-archive?novelId=${encodeURIComponent(novelId)}`, NAME);
  const out = new Map<string, Chapter>();
  for (const a of doc.querySelectorAll('a')) {
    const m = (a.getAttribute('href') ?? '').match(/^(?:https?:\/\/[^/]+)?\/([^/?#]+)\/([^/?#]+?)\.html/);
    const label = (a.getAttribute('title') ?? text(a)).trim();
    if (!m) continue;
    const num = chapterNumberOf(label);
    const key = num ?? `id:${m[2]}`;
    if (out.has(key)) continue;
    const title = label.replace(/^(?:vol(?:ume)?\.?\s*\d+\s*)?ch(?:apter)?\.?\s*\d+(?:\.\d+)?\s*[:\-–·.]?\s*/i, '').trim();
    out.set(key, {
      id: `${decodeURIComponent(m[1])}~${decodeURIComponent(m[2])}`,
      key,
      chapter: num,
      volume: null,
      title: title || (num ? null : label) || null,
      pages: 1, // a text chapter counts as one "page"; >0 marks it readable in-app
      externalUrl: null,
      readableAt: new Date(0).toISOString(), // the list shows no dates
      group: null,
    });
  }
  return [...out.values()];
}

async function getChapterText(chapterId: string): Promise<string[]> {
  const [novel, chapter] = chapterId.split('~');
  if (!novel || !chapter) throw new Error('Unknown chapter.');
  const doc = await getHtml(`${BASE}/${encodeURIComponent(novel)}/${encodeURIComponent(chapter)}.html`, NAME);
  const paragraphs = doc
    .querySelectorAll('#chr-content p')
    .map((p) => text(p))
    .filter(Boolean);
  // The text starts with the chapter's own title line ("Chapter 001: …"); the reader shows the title already.
  if (paragraphs.length > 1 && /^chapter\s+\d+/i.test(paragraphs[0]) && paragraphs[0].length < 150) paragraphs.shift();
  if (paragraphs.length === 0) throw new Error('No text found for this chapter.');
  return paragraphs;
}

export const readnovelfullProvider: Provider = {
  id: 'readnovelfull',
  name: NAME,
  kind: 'novel',
  description: 'Translated web and light novels from readnovelfull.com (English). Genres are not shown in its lists.',
  iconUrl: `${BASE}/favicon.ico`,
  languages: [{ code: 'en', label: 'English' }],
  types: [],
  sorts: ['followedCount', 'latestUploadedChapter'],
  search,
  getManga,
  getChapters,
  getChapterPages: async () => [],
  getChapterText,
};
