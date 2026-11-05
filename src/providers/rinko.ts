/**
 * Rinko Comics provider — https://rinkocomics.com (the "Comics" section; the "Novels" section is text, not images)
 *
 * The site has no API, so this reads its public HTML pages (a WordPress site with a custom theme).
 *  - /comic/ and /comic/page/N/            the listing (20 per page); /?s=…&post_type=comic  search;
 *  - /comic/<slug>/                        details and the chapter list;
 *  - /chapter/<slug>-chapter-N/            the page images (served from an open CDN).
 *
 * One limit: a comic page only shows its 10 newest chapters, the rest sit behind a "Load More" button that uses the
 * site's private data requests, which this provider does not call. Older chapters are therefore rebuilt from the
 * chapter count and the web address pattern, but only when the numbering is consecutive (1…N).
 * Chapters marked as needing a login or coins are listed as locked and open on the website.
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, imgUrl, parseSiteDate, text } from './html';
import type { Chapter, ContentRating, Manga, Page, Provider, SearchOptions } from './types';

const BASE = 'https://rinkocomics.com';
const NAME = 'Rinko Comics';
const PAGE_SIZE = 20;

function statusFrom(label: string | undefined): string {
  const v = (label ?? '').toLowerCase();
  if (v.includes('ongoing')) return 'ongoing';
  if (v.includes('complete')) return 'completed';
  if (v.includes('hiatus')) return 'hiatus';
  if (v.includes('cancel') || v.includes('drop')) return 'cancelled';
  return 'unknown';
}

function ratingFromTags(tags: string[]): ContentRating {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => ['adult', 'smut', 'hentai', 'sexual violence'].includes(x))) return 'pornographic';
  if (t.some((x) => ['mature', 'ecchi'].includes(x))) return 'suggestive';
  return 'safe';
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
    type: 'other', // the site does not say whether a title is manga, manhwa or manhua
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
  const link = card.querySelector('.ac-title a') ?? card.querySelector('a[href*="/comic/"]');
  const slug = link?.getAttribute('href')?.match(/\/comic\/([^/?#]+)/)?.[1];
  if (!link || !slug) return null;
  const m = blank(decodeURIComponent(slug), text(link), imgUrl(card.querySelector('img')));
  m.tags = card.querySelectorAll('.ac-genres a').map((a) => text(a)).filter(Boolean);
  m.contentRating = ratingFromTags(m.tags);
  const author = text(card.querySelector('.ac-author'));
  if (author) m.authors = [author];
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

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const title = opts.title?.trim();
  const pagePath = page > 1 ? `page/${page}/` : '';
  const url = title
    ? `${BASE}/${pagePath}?s=${encodeURIComponent(title)}&post_type=comic`
    : `${BASE}/comic/${pagePath}`;
  const doc = await getHtml(url, NAME);

  let items = doc
    .querySelectorAll('article.ac-card')
    .map(parseCard)
    .filter((m): m is Manga => !!m);
  const allowed = new Set(opts.ratings);
  items = items.filter((m) => allowed.has(m.contentRating));
  // The site gives no type, so every title is "other"; the type filter can only keep unknown types (see the registry).
  if (opts.type && opts.type !== 'all') items = items.filter((m) => m.type === 'other' || m.type === opts.type);

  const hasNext = page < lastPage(doc);
  const loaded = offset + items.length;
  return { items, total: hasNext ? loaded + PAGE_SIZE : loaded, offset, limit: PAGE_SIZE };
}

const chapterNumberOf = (permalink: string): string | null =>
  permalink.match(/-chapter-(\d+(?:-\d+)?)\/?$/)?.[1]?.replace('-', '.') ?? null;

async function getManga(id: string): Promise<Manga> {
  const doc = await getHtml(`${BASE}/comic/${encodeURIComponent(id)}/`, NAME);
  const title = text(doc.querySelector('h1'));
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);
  const cover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '';
  const m = blank(id, title, cover);
  m.pubStatus = statusFrom(text(doc.querySelector('.comic-status')));
  m.description =
    text(doc.querySelector('[class*="synopsis"], .comic-page-description')) ||
    (doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '').trim();
  m.tags = [...new Set(doc.querySelectorAll('a[href*="/comics_genres/"]').map((a) => text(a)).filter(Boolean))];
  m.contentRating = ratingFromTags(m.tags);

  const numbers = doc
    .querySelectorAll('li.chapter')
    .map((r) => Number(chapterNumberOf(r.getAttribute('data-permalink') ?? '')))
    .filter((n) => Number.isFinite(n));
  if (numbers.length) {
    m.lastChapter = String(Math.max(...numbers));
    m.latestUploadedChapter = `Chapter ${m.lastChapter}`;
  }
  return m;
}

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  const doc = await getHtml(`${BASE}/comic/${encodeURIComponent(manga.id)}/`, NAME);
  const out = new Map<string, Chapter>();
  let sample: string | null = null; // a real chapter address, used to rebuild the older ones

  for (const row of doc.querySelectorAll('li.chapter')) {
    const permalink = row.getAttribute('data-permalink') ?? '';
    const num = chapterNumberOf(permalink);
    const path = permalink.replace(/^https?:\/\/[^/]+\/chapter\//, '').replace(/\/+$/, '');
    if (!permalink || !path) continue;
    const key = num ?? `id:${path}`;
    if (out.has(key)) continue;
    sample ??= permalink;
    const paid = row.getAttribute('data-price') !== '0' || row.classNames.includes('locked');
    out.set(key, {
      id: path,
      key,
      chapter: num,
      volume: null,
      title: null,
      pages: 1, // unknown until opened; >0 marks it readable in-app
      externalUrl: paid ? permalink : null,
      readableAt: parseSiteDate(text(row)) ?? new Date().toISOString(),
      group: null,
    });
  }

  // The page lists only the 10 newest chapters. When the count in "Chapters (N)" equals the highest number we can
  // see, the numbering is 1…N, so the older ones follow the same address pattern.
  const total = Number(text(doc.querySelector('.comic-page-chapters')).match(/Chapters\s*\((\d+)\)/)?.[1]);
  const seen = [...out.values()].map((c) => Number(c.chapter)).filter((n) => Number.isFinite(n));
  const highest = seen.length ? Math.max(...seen) : 0;
  const lowest = seen.length ? Math.min(...seen) : 0;
  // Only trust that when the visible chapters are whole numbers in an unbroken run: a decimal chapter (2.5) or a gap
  // means the count is not simply the highest number.
  const unbroken = seen.length > 0 && seen.every(Number.isInteger) && highest - lowest + 1 === seen.length;
  if (sample && unbroken && Number.isFinite(total) && total > out.size && highest === total && lowest > 1) {
    for (let n = lowest - 1; n >= 1; n--) {
      const permalink = sample.replace(/-chapter-\d+(?:-\d+)?\/?$/, `-chapter-${n}/`);
      out.set(String(n), {
        id: permalink.replace(/^https?:\/\/[^/]+\/chapter\//, '').replace(/\/+$/, ''),
        key: String(n),
        chapter: String(n),
        volume: null,
        title: null,
        pages: 1,
        externalUrl: null,
        readableAt: new Date(0).toISOString(), // the date is not shown for these
        group: null,
      });
    }
  }

  const n = (c: Chapter) => (c.chapter == null ? -1 : parseFloat(c.chapter));
  return [...out.values()].sort((a, b) => n(a) - n(b));
}

async function getChapterPages(chapterId: string): Promise<string[]> {
  const doc = await getHtml(`${BASE}/chapter/${chapterId}/`, NAME);
  const pages = doc
    .querySelectorAll('img.chapter-image')
    .map(imgUrl)
    .filter(Boolean);
  const unique = [...new Set(pages)];
  if (unique.length === 0) throw new Error('No pages found for this chapter. It may need an account or coins on the website.');
  return unique;
}

export const rinkoProvider: Provider = {
  id: 'rinko',
  name: NAME,
  description: 'Comics from rinkocomics.com (English). Titles do not show a type, so the type filter hides them.',
  iconUrl: `${BASE}/wp-content/uploads/2025/10/RinkoComics1024.webp`,
  languages: [{ code: 'en', label: 'English' }],
  types: ['manga', 'manhwa', 'manhua'],
  sorts: ['relevance'],
  search,
  getManga,
  getChapters,
  getChapterPages,
};
