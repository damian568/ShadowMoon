/**
 * Rinko Novels provider — https://rinkocomics.com (the "Novels" section; the "Comics" section is the `rinko` provider)
 *
 * Same site and same polite, public-HTML approach as the comics provider:
 *  - /novel/ and /novel/page/N/            the listing (20 per page); /?s=…&post_type=novel  search;
 *  - /novel/<slug>/                        details and the full chapter list (a row per chapter);
 *  - /novel_chapter/<slug>-chapter-N/      the chapter text (paragraphs inside `.novel-content`).
 *
 * The first chapters of a novel are free; later ones need an account and coins. A locked chapter has no address of
 * its own, so it is listed as external and opens the novel's page on the website.
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, imgUrl, text } from './html';
import type { Chapter, Manga, Page, Provider, SearchOptions } from './types';

const BASE = 'https://rinkocomics.com';
const NAME = 'Rinko Novels';
const PAGE_SIZE = 20;

function statusFrom(label: string | undefined): string {
  const v = (label ?? '').toLowerCase();
  if (v.includes('ongoing')) return 'ongoing';
  if (v.includes('complete')) return 'completed';
  if (v.includes('hiatus')) return 'hiatus';
  if (v.includes('cancel') || v.includes('drop')) return 'cancelled';
  return 'unknown';
}

/** The site lists images at reduced sizes ("…-716x1024.webp"); drop the suffix for the full image. */
const fullSize = (url: string) => url.replace(/-\d+x\d+(\.\w+)$/, '$1');

function blank(slug: string, title: string, cover: string): Manga {
  return {
    id: slug,
    title,
    description: '',
    coverUrl: cover,
    coverUrlLarge: fullSize(cover),
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

function parseCard(card: HTMLElement): Manga | null {
  const link = card.querySelector('a.ac-thumb') ?? card.querySelector('a[href*="/novel/"]');
  const slug = link?.getAttribute('href')?.match(/\/novel\/([^/?#]+)/)?.[1];
  const title = text(card.querySelector('.ac-title')) || (card.querySelector('img')?.getAttribute('alt') ?? '').trim();
  if (!link || !slug || !title) return null;
  const m = blank(decodeURIComponent(slug), title, imgUrl(card.querySelector('img')));
  m.pubStatus = statusFrom(text(card.querySelector('.ac-status')));
  return m;
}

/** Highest page number in the pagination links (…/page/N/), or 1. */
function lastPage(doc: HTMLElement): number {
  const pages = doc
    .querySelectorAll('a.page-numbers')
    .map((a) => Number(a.getAttribute('href')?.match(/\/page\/(\d+)/)?.[1]))
    .filter((n) => Number.isFinite(n));
  return pages.length ? Math.max(...pages) : 1;
}

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const title = opts.title?.trim();
  const pagePath = page > 1 ? `page/${page}/` : '';
  const url = title
    ? `${BASE}/${pagePath}?s=${encodeURIComponent(title)}&post_type=novel`
    : `${BASE}/novel/${pagePath}`;
  const doc = await getHtml(url, NAME);

  const items = doc
    .querySelectorAll('article.ac-card')
    .map(parseCard)
    .filter((m): m is Manga => !!m);

  const hasNext = page < lastPage(doc);
  const loaded = offset + items.length;
  return { items, total: hasNext ? loaded + PAGE_SIZE : loaded, offset, limit: PAGE_SIZE };
}

const novelUrl = (id: string) => `${BASE}/novel/${encodeURIComponent(id)}/`;

/** The chapters in the page's rows. Locked ones have `data-permalink="#"` and are marked `external`. */
function readRows(doc: HTMLElement, novelId: string): Chapter[] {
  const out = new Map<string, Chapter>();
  for (const row of doc.querySelectorAll('div.chapter[data-post-id]')) {
    const postId = row.getAttribute('data-post-id') ?? '';
    const permalink = row.getAttribute('data-permalink') ?? '';
    const index = text(row.querySelector('.ch-index')).replace(/^#/, '');
    const name = (row.getAttribute('data-title') ?? text(row.querySelector('.ch-name'))).trim();
    const free = row.getAttribute('data-price') === '0' && /\/novel_chapter\//.test(permalink);
    const num = /^\d+(?:\.\d+)?$/.test(index) ? index : null;
    const key = num ?? `id:${postId}`;
    if (!postId || out.has(key)) continue;
    out.set(key, {
      id: free ? permalink.replace(/^https?:\/\/[^/]+\/novel_chapter\//, '').replace(/\/+$/, '') : `locked-${postId}`,
      key,
      chapter: num,
      volume: null,
      title: name || null,
      pages: 1, // a text chapter counts as one "page"; >0 marks it readable in-app
      externalUrl: free ? null : novelUrl(novelId),
      readableAt: new Date(0).toISOString(), // the site shows no dates for chapters
      group: null,
    });
  }
  const n = (c: Chapter) => (c.chapter == null ? -1 : parseFloat(c.chapter));
  return [...out.values()].sort((a, b) => n(a) - n(b));
}

async function getManga(id: string): Promise<Manga> {
  const doc = await getHtml(novelUrl(id), NAME);
  const title = text(doc.querySelector('h1'));
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);
  const cover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '';
  const m = blank(id, title, cover);
  m.pubStatus = statusFrom(text(doc.querySelector('.comic-status')));
  // The synopsis block is nested inside another block of the same name: the innermost one holds the text.
  const synopsis = doc.querySelectorAll('.comic-synopsis').filter((el) => !el.querySelector('.comic-synopsis'));
  m.description =
    text(synopsis[synopsis.length - 1]) || (doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '').trim();
  m.tags = [...new Set(doc.querySelectorAll('.genres a').map((a) => text(a)).filter(Boolean))];

  const numbers = readRows(doc, id)
    .map((c) => Number(c.chapter))
    .filter((n) => Number.isFinite(n));
  if (numbers.length) {
    m.lastChapter = String(Math.max(...numbers));
    m.latestUploadedChapter = `Chapter ${m.lastChapter}`;
  }
  return m;
}

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  return readRows(await getHtml(novelUrl(manga.id), NAME), manga.id);
}

async function getChapterText(chapterId: string): Promise<string[]> {
  const doc = await getHtml(`${BASE}/novel_chapter/${chapterId}/`, NAME);
  const paragraphs = doc
    .querySelectorAll('.novel-content p')
    .map((p) => text(p))
    .filter(Boolean);
  if (paragraphs.length === 0) throw new Error('No text found for this chapter. It may need an account or coins on the website.');
  return paragraphs;
}

export const rinkoNovelsProvider: Provider = {
  id: 'rinkonovels',
  name: NAME,
  kind: 'novel',
  description: 'Light novels from rinkocomics.com (English). The first chapters are free; later ones open on the website.',
  iconUrl: `${BASE}/wp-content/uploads/2025/10/RinkoComics1024.webp`,
  languages: [{ code: 'en', label: 'English' }],
  types: [],
  sorts: ['relevance'],
  search,
  getManga,
  getChapters,
  getChapterPages: async () => [],
  getChapterText,
};
