/**
 * NovelBin provider — https://novelbin.com
 *
 * A site of translated web and light novels. It has no API, so this reads its public HTML (robots.txt allows it):
 *  - /sort/top-hot-novel, /sort/latest      the listings (20 per page, ?page=N); /search?keyword=…  search;
 *  - /b/<slug>                              details;
 *  - /ajax/chapter-archive?novelId=<slug>   the full chapter list as a plain HTML fragment (no token or login);
 *  - /b/<slug>/<chapter-slug>               the chapter text (paragraphs inside `#chr-content`).
 *
 * Notes: the listings show no genres, so 18+ titles cannot be hidden there (a title's own page lists its genres).
 * A chapter id is "<novel slug>~<chapter slug>" because a chapter's address needs both.
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, imgUrl, text } from './html';
import type { Chapter, ContentRating, Manga, Page, Provider, SearchOptions, SortOrder } from './types';

const BASE = 'https://novelbin.com';
const NAME = 'NovelBin';
const PAGE_SIZE = 20;

const SORT_PATH: Partial<Record<SortOrder, string>> = {
  followedCount: 'top-hot-novel',
  latestUploadedChapter: 'latest',
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

/** Lists show small thumbnails (".../novel_80_113/…"); the full cover lives under ".../novel/…". */
const largeCover = (url: string) => url.replace(/\/novel_\d+_\d+\//, '/novel/');

function blank(slug: string, title: string, cover: string): Manga {
  return {
    id: slug,
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

const slugOf = (href: string | undefined) => href?.match(/\/b\/([^/?#]+)/)?.[1];

function parseRow(row: HTMLElement): Manga | null {
  const link = row.querySelector('.novel-title a');
  const slug = slugOf(link?.getAttribute('href'));
  const title = text(link);
  if (!link || !slug || !title) return null;
  const m = blank(decodeURIComponent(slug), title, imgUrl(row.querySelector('img')));
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
  const url = title
    ? `${BASE}/search?keyword=${encodeURIComponent(title)}${page > 1 ? `&page=${page}` : ''}`
    : `${BASE}/sort/${SORT_PATH[opts.order ?? 'followedCount'] ?? 'top-hot-novel'}${page > 1 ? `?page=${page}` : ''}`;
  const doc = await getHtml(url, NAME);

  const items = doc
    .querySelectorAll('.list-novel .row')
    .map(parseRow)
    .filter((m): m is Manga => !!m);
  const last = lastPage(doc);
  return { items, total: last * PAGE_SIZE, offset, limit: PAGE_SIZE };
}

const chapterNumberOf = (label: string): string | null => label.match(/^(?:vol(?:ume)?\.?\s*\d+\s*)?ch(?:apter)?\.?\s*(\d+(?:\.\d+)?)/i)?.[1] ?? null;

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  const doc = await getHtml(`${BASE}/ajax/chapter-archive?novelId=${encodeURIComponent(manga.id)}`, NAME);
  const out = new Map<string, Chapter>();
  for (const a of doc.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    const chapterSlug = href.match(/\/b\/[^/?#]+\/([^/?#]+)/)?.[1];
    const label = (a.getAttribute('title') ?? text(a)).trim();
    if (!chapterSlug) continue;
    const num = chapterNumberOf(label);
    const key = num ?? `id:${chapterSlug}`;
    if (out.has(key)) continue;
    const title = label.replace(/^(?:vol(?:ume)?\.?\s*\d+\s*)?ch(?:apter)?\.?\s*\d+(?:\.\d+)?\s*[:\-–·.]?\s*/i, '').trim();
    out.set(key, {
      id: `${manga.id}~${chapterSlug}`,
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

async function getManga(id: string): Promise<Manga> {
  const doc = await getHtml(`${BASE}/b/${encodeURIComponent(id)}`, NAME);
  const title = text(doc.querySelector('h3.title')) || text(doc.querySelector('h1'));
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);
  const cover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '';
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

  // The newest chapter, for the update checker (the chapter list itself is only fetched when a title is opened).
  const latest = doc.querySelectorAll('.l-chapter a, .l-chap a').pop();
  const latestNum = chapterNumberOf(text(latest));
  if (latestNum) {
    m.lastChapter = latestNum;
    m.latestUploadedChapter = `Chapter ${latestNum}`;
  }
  return m;
}

async function getChapterText(chapterId: string): Promise<string[]> {
  const [novel, chapter] = chapterId.split('~');
  if (!novel || !chapter) throw new Error('Unknown chapter.');
  const doc = await getHtml(`${BASE}/b/${encodeURIComponent(novel)}/${encodeURIComponent(chapter)}`, NAME);
  const paragraphs = doc
    .querySelectorAll('#chr-content p')
    .map((p) => text(p))
    .filter(Boolean);
  if (paragraphs.length === 0) throw new Error('No text found for this chapter.');
  return paragraphs;
}

export const novelbinProvider: Provider = {
  id: 'novelbin',
  name: NAME,
  kind: 'novel',
  description: 'Translated web and light novels from novelbin.com (English). Genres are not shown in its lists.',
  iconUrl: `${BASE}/img/novelbin-favicon.ico`,
  languages: [{ code: 'en', label: 'English' }],
  types: [],
  sorts: ['followedCount', 'latestUploadedChapter'],
  search,
  getManga,
  getChapters,
  getChapterPages: async () => [],
  getChapterText,
};
