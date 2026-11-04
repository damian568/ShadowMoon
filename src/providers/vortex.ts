/**
 * Vortex Scans provider — https://vortexscans.org
 *
 * The site has no API and its search box runs in the browser, so this reads the public HTML:
 *  - the paged listing (/series/?page=N) is loaded once and cached, and searching filters that list by title;
 *  - title pages give details and the chapter list; chapter pages give the page images.
 * If the site changes its layout, only this file needs updating.
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, imgUrl, parseReleaseDate, text } from './html';
import type { Chapter, ContentRating, Manga, MangaType, Page, Provider, SearchOptions } from './types';

const BASE = 'https://vortexscans.org';
const NAME = 'Vortex Scans';
const PAGE_SIZE = 30;
const INDEX_TTL = 15 * 60 * 1000;

// Note: always use the trailing-slash form. "/series?page=2" redirects to plain http, which iOS blocks.
const listUrl = (page: number) => `${BASE}/series/?page=${page}`;
const titleUrl = (slug: string) => `${BASE}/series/${encodeURIComponent(slug)}`;

function typeFrom(label: string | undefined): MangaType {
  const v = (label ?? '').toLowerCase();
  if (v.includes('manhwa')) return 'manhwa';
  if (v.includes('manhua')) return 'manhua';
  if (v.includes('manga')) return 'manga';
  return 'other';
}

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

const chapterNumber = (s: string): string | null => {
  const m = s.match(/(\d+(?:[.\-]\d+)?)/);
  return m ? m[1].replace('-', '.') : null;
};

function blank(slug: string, title: string, cover: string): Manga {
  return {
    id: slug,
    title,
    description: '',
    coverUrl: cover,
    coverUrlLarge: cover,
    type: 'other',
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

/** Series cards on a listing page: a link to /series/<slug> (not a chapter) that wraps a cover image. */
function parseCards(doc: HTMLElement): Manga[] {
  const out = new Map<string, Manga>();
  for (const a of doc.querySelectorAll('a[href^="/series/"]')) {
    const href = a.getAttribute('href') ?? '';
    if (/\/chapter-/.test(href) || !a.querySelector('img')) continue;
    const slug = decodeURIComponent(href.replace(/^\/series\//, '').replace(/[/?#].*$/, ''));
    if (!slug || out.has(slug)) continue;
    const img = a.querySelector('img');
    const title = (a.getAttribute('title') ?? img?.getAttribute('alt') ?? '').trim();
    if (!title) continue;
    const m = blank(slug, title, imgUrl(img));
    m.type = typeFrom(text(a.querySelector('span span')) || text(a.querySelector('span')));
    out.set(slug, m);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Listing + local search index
// ---------------------------------------------------------------------------

let index: { at: number; items: Manga[] } | null = null;
let indexLoading: Promise<Manga[]> | null = null;

function lastPageNumber(doc: HTMLElement): number {
  const nums = doc
    .querySelectorAll('a[href*="page="]')
    .map((a) => Number(a.getAttribute('href')?.match(/page=(\d+)/)?.[1]))
    .filter((n) => Number.isFinite(n));
  return nums.length ? Math.max(...nums) : 1;
}

/** Every series on the site (all listing pages, deduplicated). Loaded once and cached. */
async function loadIndex(): Promise<Manga[]> {
  if (index && Date.now() - index.at < INDEX_TTL) return index.items;
  indexLoading ??= (async () => {
    const first = await getHtml(listUrl(1), NAME);
    const all = new Map<string, Manga>();
    for (const m of parseCards(first)) all.set(m.id, m);
    const last = Math.min(lastPageNumber(first), 60);
    for (let p = 2; p <= last; p++) {
      try {
        for (const m of parseCards(await getHtml(listUrl(p), NAME))) if (!all.has(m.id)) all.set(m.id, m);
      } catch {
        break; // keep what we have; a later search retries
      }
    }
    index = { at: Date.now(), items: [...all.values()] };
    return index.items;
  })().finally(() => {
    indexLoading = null;
  });
  return indexLoading;
}

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  const limit = PAGE_SIZE;
  const title = opts.title?.trim().toLowerCase();

  let items: Manga[];
  let total: number;
  if (title) {
    // Search needs the whole list; filter it locally (every word must appear in the title).
    const words = title.split(/\s+/).filter(Boolean);
    const matches = (await loadIndex()).filter((m) => words.every((w) => m.title.toLowerCase().includes(w)));
    total = matches.length;
    items = matches.slice(offset, offset + limit);
  } else {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    // The site's own page is ~36 titles; serve the cached index in our page size once it is loaded.
    const all = await loadIndex();
    total = all.length;
    items = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  const allowed = new Set(opts.ratings);
  items = items.filter((m) => allowed.has(m.contentRating));
  if (opts.type && opts.type !== 'all') items = items.filter((m) => m.type === 'other' || m.type === opts.type);
  return { items, total, offset, limit };
}

// ---------------------------------------------------------------------------
// Title, chapters, pages
// ---------------------------------------------------------------------------

async function getManga(id: string): Promise<Manga> {
  const doc = await getHtml(titleUrl(id), NAME);
  const title = text(doc.querySelector('h1'));
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);

  // Cover: the series' featured image (the first <img> on the page is the site logo).
  const cover =
    doc
      .querySelectorAll('img')
      .map(imgUrl)
      .find((u) => /\/upload\/series\/featured\//.test(u)) ?? '';
  const m = blank(id, title, cover);

  const flat = doc.text.replace(/\s+/g, ' ');
  const field = (label: string, next: string) => flat.match(new RegExp(`${label}\\s*([A-Za-z ]+?)\\s*${next}`))?.[1];
  m.pubStatus = statusFrom(field('Status', 'Type'));
  m.type = typeFrom(field('Type', 'Chapters'));
  m.tags = [...new Set(doc.querySelectorAll('a[href*="genre"]').map((a) => text(a)).filter(Boolean))];
  m.contentRating = ratingFromTags(m.tags);

  const rawDesc =
    doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ??
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ??
    '';
  m.description = rawDesc
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&');

  const first = doc.querySelector(`a[href*="/series/"][href*="/chapter-"]`);
  const nums = doc
    .querySelectorAll('a[href*="/chapter-"]')
    .map((a) => Number(a.getAttribute('href')?.match(/chapter-(\d+(?:-\d+)?)/)?.[1]?.replace('-', '.')))
    .filter((n) => Number.isFinite(n));
  if (first && nums.length) {
    const last = Math.max(...nums);
    m.lastChapter = String(last);
    m.latestUploadedChapter = `Chapter ${last}`;
  }
  return m;
}

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  const doc = await getHtml(titleUrl(manga.id), NAME);
  const out = new Map<string, Chapter>();
  for (const a of doc.querySelectorAll('a[href*="/chapter-"]')) {
    const href = a.getAttribute('href') ?? '';
    const m = href.match(/^\/series\/([^/]+)\/(chapter-[^/?#]+)/);
    // Only this series' chapters: the page can also link to other series (latest releases, recommendations).
    if (!m || decodeURIComponent(m[1]) !== manga.id) continue;
    const num = chapterNumber(m[2].replace('chapter-', ''));
    const key = num ?? `id:${m[2]}`;
    if (out.has(key)) continue;
    // Row text looks like "Chapter 5about 2 months": the date follows the label.
    const rowText = text(a);
    const date = rowText.replace(/^.*?chapter\s*[\d.\-]+/i, '').replace(/free|premium/gi, '').trim();
    out.set(key, {
      id: `${decodeURIComponent(m[1])}/${m[2]}`,
      key,
      chapter: num,
      volume: null,
      title: null,
      pages: 1, // unknown until opened; >0 marks it readable in-app
      externalUrl: null,
      readableAt: parseReleaseDate(date),
      group: null,
    });
  }
  const n = (c: Chapter) => (c.chapter == null ? -1 : parseFloat(c.chapter));
  return [...out.values()].sort((a, b) => n(a) - n(b));
}

async function getChapterPages(chapterId: string): Promise<string[]> {
  const [slug, chapter] = chapterId.split('/');
  const doc = await getHtml(`${BASE}/series/${encodeURIComponent(slug)}/${chapter}`, NAME);
  const pages = doc
    .querySelectorAll('img')
    .map(imgUrl)
    // Chapter pages live under /upload/series/<series>/<chapter>/…; covers are under /featured/.
    .filter((u) => /\/upload\/series\//.test(u) && !/\/upload\/series\/featured\//.test(u));
  const unique = [...new Set(pages)];
  if (unique.length === 0) throw new Error('No pages found. This chapter may be locked (premium) on Vortex Scans.');
  return unique;
}

export const vortexProvider: Provider = {
  id: 'vortex',
  name: NAME,
  description: 'Manhwa and manhua from vortexscans.org (English). Search runs on a cached list of the whole site.',
  iconUrl: 'https://storage.vortexscans.org/upload/settings/logo/cmgwxmqgh0000mj0p26cruyru/2a9fd079-94f5-4463-808b-4ce327ff7639.png',
  languages: [{ code: 'en', label: 'English' }],
  types: ['manga', 'manhwa', 'manhua'],
  sorts: ['relevance'],
  search,
  getManga,
  getChapters,
  getChapterPages,
};
