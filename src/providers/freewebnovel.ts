/**
 * FreeWebNovel provider — https://freewebnovel.com
 *
 * Web and light novels, mostly English translations. No API, so this reads its public HTML (its robots.txt allows
 * everything):
 *  - /sort/most-popular[/N], /sort/latest-release[/N]   the listings (20 per page);
 *  - POST /search (field "keyword")                      search — the site's own search form;
 *  - /novel/<slug>                                       details (as page metadata);
 *  - /novel/<slug>/chapter-<N>                           the chapter text (paragraphs in `#article`).
 *
 * The title page lists only the newest chapters, but chapters are numbered 1…N in their addresses, so the full
 * list is rebuilt from the newest chapter's number (older chapters show as "Chapter N" without their names).
 * A chapter id is "<slug>~<N>".
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, imgUrl, postHtml, text } from './html';
import type { Chapter, ContentRating, Manga, Page, Provider, SearchOptions, SortOrder } from './types';

const BASE = 'https://freewebnovel.com';
const NAME = 'FreeWebNovel';
const PAGE_SIZE = 20;

const SORT_PATH: Partial<Record<SortOrder, string>> = {
  followedCount: 'most-popular',
  latestUploadedChapter: 'latest-release',
};

function statusFrom(label: string | undefined): string {
  const v = (label ?? '').toLowerCase();
  if (v.includes('ongoing')) return 'ongoing';
  if (v.includes('complete') || v.includes('full')) return 'completed';
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

function blank(slug: string, title: string, cover: string): Manga {
  return {
    id: slug,
    title,
    description: '',
    coverUrl: cover,
    coverUrlLarge: cover,
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

const slugOf = (href: string | undefined) => href?.match(/\/novel\/([^/?#]+)/)?.[1];

function parseRow(row: HTMLElement): Manga | null {
  const link = row.querySelector('.tit a');
  const slug = slugOf(link?.getAttribute('href'));
  const title = text(link);
  if (!link || !slug || !title) return null;
  return blank(decodeURIComponent(slug), title, absolute(imgUrl(row.querySelector('img'))));
}

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const title = opts.title?.trim();
  let doc: HTMLElement;
  if (title) {
    // The site's search answers with one page of matches.
    doc = await postHtml(`${BASE}/search`, { keyword: title }, NAME);
    const items = doc.querySelectorAll('.li-row').map(parseRow).filter((m): m is Manga => !!m);
    return { items: offset === 0 ? items : [], total: items.length, offset, limit: PAGE_SIZE };
  }
  const sort = SORT_PATH[opts.order ?? 'followedCount'] ?? 'most-popular';
  doc = await getHtml(`${BASE}/sort/${sort}${page > 1 ? `/${page}` : ''}`, NAME);
  const items = doc.querySelectorAll('.li-row').map(parseRow).filter((m): m is Manga => !!m);
  const pages = doc
    .querySelectorAll('a')
    .map((a) => Number(a.getAttribute('href')?.match(new RegExp(`/sort/${sort}/(\\d+)`))?.[1]))
    .filter((n) => Number.isFinite(n));
  const last = pages.length ? Math.max(...pages, page) : page;
  return { items, total: last * PAGE_SIZE, offset, limit: PAGE_SIZE };
}

const meta = (doc: HTMLElement, name: string) => doc.querySelector(`meta[property="og:novel:${name}"]`)?.getAttribute('content')?.trim() ?? '';

/** "https://…/novel/slug/chapter-3240" or "Chapter 3240 Name" -> 3240 */
const numberIn = (s: string): number | null => {
  const n = Number(s.match(/chapter[-\s]+(\d+)/i)?.[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function readNovel(slug: string): Promise<{ manga: Manga; count: number }> {
  const doc = await getHtml(`${BASE}/novel/${encodeURIComponent(slug)}`, NAME);
  const title = text(doc.querySelector('h1')) || meta(doc, 'novel_name');
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);
  const cover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '';
  const m = blank(slug, title, cover);
  m.description = doc
    .querySelectorAll('.inner p')
    .map((p) => text(p))
    .filter(Boolean)
    .join('\n\n');
  const author = meta(doc, 'author');
  if (author) m.authors = [author];
  m.tags = meta(doc, 'genre').split(',').map((g) => g.trim()).filter(Boolean);
  m.pubStatus = statusFrom(meta(doc, 'status'));
  m.contentRating = ratingFromTags(m.tags);

  const count = numberIn(meta(doc, 'lastest_chapter_url')) ?? numberIn(meta(doc, 'lastest_chapter_name')) ?? 0;
  if (count > 0) {
    m.lastChapter = String(count);
    m.latestUploadedChapter = `Chapter ${count}`;
  }
  return { manga: m, count };
}

async function getManga(id: string): Promise<Manga> {
  return (await readNovel(id)).manga;
}

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  const doc = await getHtml(`${BASE}/novel/${encodeURIComponent(manga.id)}`, NAME);
  // Names of the chapters the page lists (the newest ones), keyed by chapter number.
  const names = new Map<number, string>();
  for (const a of doc.querySelectorAll('ul.ul-list5 a, a.chapter')) {
    const n = numberIn(a.getAttribute('href') ?? '');
    const label = (a.getAttribute('title') ?? text(a)).trim();
    if (n && /^chapter/i.test(label)) names.set(n, label.replace(/^chapter\s+\d+\s*[:\-–·.]?\s*/i, '').trim());
  }
  const count = Math.max(numberIn(meta(doc, 'lastest_chapter_url')) ?? 0, numberIn(meta(doc, 'lastest_chapter_name')) ?? 0, ...names.keys());
  const out: Chapter[] = [];
  for (let n = 1; n <= count; n++) {
    out.push({
      id: `${manga.id}~${n}`,
      key: String(n),
      chapter: String(n),
      volume: null,
      title: names.get(n) || null,
      pages: 1, // a text chapter counts as one "page"; >0 marks it readable in-app
      externalUrl: null,
      readableAt: new Date(0).toISOString(), // the site shows no dates
      group: null,
    });
  }
  return out;
}

async function getChapterText(chapterId: string): Promise<string[]> {
  const [slug, n] = chapterId.split('~');
  if (!slug || !n) throw new Error('Unknown chapter.');
  const doc = await getHtml(`${BASE}/novel/${encodeURIComponent(slug)}/chapter-${encodeURIComponent(n)}`, NAME);
  const paragraphs = doc
    .querySelectorAll('#article p')
    .map((p) => text(p))
    .filter(Boolean);
  if (paragraphs.length === 0) throw new Error('No text found for this chapter.');
  return paragraphs;
}

export const freewebnovelProvider: Provider = {
  id: 'freewebnovel',
  name: NAME,
  kind: 'novel',
  description: 'Web and light novels from freewebnovel.com (mostly English translations).',
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
