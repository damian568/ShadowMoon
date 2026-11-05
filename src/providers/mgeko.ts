/**
 * Mgeko provider — https://www.mgeko.cc
 *
 * The site has no API, so this reads its public HTML pages (a server-rendered Django site; robots.txt allows
 * everything). Chapter images are served openly, with no special headers needed.
 *  - /jumbo/manga/?results=N&filter=All|manga|manhwa|manhua   the listing (50 titles per page);
 *  - /search/?search=…&results=N                                search (30 titles per page);
 *  - /manga/<slug>/                                             details; /manga/<slug>/all-chapters/ the chapters;
 *  - /reader/en/<chapter>/                                      the page images.
 * If the site changes its layout, only this file needs updating.
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, imgUrl, parseReleaseDate, parseSiteDate, text } from './html';
import type { Chapter, ContentRating, Manga, MangaType, Page, Provider, SearchOptions } from './types';

const BASE = 'https://www.mgeko.cc';
const NAME = 'Mgeko';
const LIST_SIZE = 50;
const SEARCH_SIZE = 30;

const absolute = (url: string) => (url.startsWith('/') ? `${BASE}${url}` : url);

function typeFrom(label: string | undefined): MangaType {
  const v = (label ?? '').toLowerCase();
  if (v.includes('manhwa') || v.includes('webtoon')) return 'manhwa';
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

/** "25-eng-li", "Chapters 25-eng-li", "12.5-eng-li" -> "25" / "12.5" */
const chapterNumber = (label: string): string | null => label.match(/(\d+(?:\.\d+)?)/)?.[1] ?? null;

// The site writes dates like "Nov. 5, 2026, 3:38 a.m." (read as UTC); the reader lives in ./html.
export { parseSiteDate };

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

/** One result card: <li class="novel-item"><a href="/manga/<slug>/">…cover, title, author, latest chapter…</a></li> */
function parseCard(li: HTMLElement): Manga | null {
  const a = li.querySelector('a[href^="/manga/"]');
  const slug = a?.getAttribute('href')?.match(/^\/manga\/([^/?#]+)/)?.[1];
  if (!a || !slug) return null;
  const title = a.getAttribute('title')?.trim() || text(li.querySelector('.novel-title'));
  const m = blank(decodeURIComponent(slug), title, absolute(imgUrl(li.querySelector('img'))));
  const author = text(li.querySelector('h6')).replace(/^authors?\s*(\(s\))?\s*:\s*/i, '');
  if (author && !/^n\/?a$/i.test(author)) m.authors = [author];
  const latest = text(li.querySelector('.novel-stats strong'));
  if (latest) {
    m.lastChapter = chapterNumber(latest);
    m.latestUploadedChapter = latest.replace(/^chapters?\s*/i, '');
  }
  return m;
}

/** The real result list (the page also has a sidebar slider of recommended titles that must be ignored). */
const resultCards = (doc: HTMLElement) =>
  doc
    .querySelectorAll('ul.novel-list li.novel-item')
    .map(parseCard)
    .filter((m): m is Manga => !!m);

/** Highest page number linked from the pagination bar, or 1. */
function lastPage(doc: HTMLElement): number {
  const pages = doc
    .querySelectorAll('.mg-pagination a')
    .map((a) => Number(a.getAttribute('href')?.match(/results=(\d+)/)?.[1]))
    .filter((n) => Number.isFinite(n));
  return pages.length ? Math.max(...pages) : 1;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  const title = opts.title?.trim();
  const size = title ? SEARCH_SIZE : LIST_SIZE;
  const page = Math.floor(offset / size) + 1;

  let doc: HTMLElement;
  let items: Manga[];
  if (title) {
    doc = await getHtml(`${BASE}/search/?search=${encodeURIComponent(title)}&results=${page}`, NAME);
    items = resultCards(doc);
  } else {
    // With a type chosen, the site filters the listing for us, so the titles are of that type.
    const typeFilter = opts.type && opts.type !== 'all' && opts.type !== 'other' ? opts.type : undefined;
    doc = await getHtml(`${BASE}/jumbo/manga/?results=${page}&filter=${typeFilter ?? 'All'}`, NAME);
    items = resultCards(doc);
    if (typeFilter) items = items.map((m) => ({ ...m, type: typeFilter }));
  }

  // Titles whose type is unknown stay here; the registry looks the real type up (see searchManga).
  if (opts.type && opts.type !== 'all') items = items.filter((m) => m.type === 'other' || m.type === opts.type);
  const allowed = new Set(opts.ratings);
  items = items.filter((m) => allowed.has(m.contentRating));

  const hasNext = page < lastPage(doc);
  const loaded = offset + items.length;
  return { items, total: hasNext ? loaded + size : loaded, offset, limit: size };
}

async function getManga(id: string): Promise<Manga> {
  const doc = await getHtml(`${BASE}/manga/${encodeURIComponent(id)}/`, NAME);
  const title = text(doc.querySelector('h1'));
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);

  const cover = absolute(doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? imgUrl(doc.querySelector('.fixed-img img')));
  const m = blank(id, title, cover);

  const author = text(doc.querySelector('.author')).replace(/^authors?\s*(\(s\))?\s*:\s*/i, '');
  if (author && !/^n\/?a$/i.test(author)) m.authors = [author];

  const categories = doc.querySelectorAll('.categories li').map((li) => text(li)).filter((c) => c && !/^categories$/i.test(c));
  m.type = typeFrom(categories.find((c) => typeFrom(c) !== 'other'));
  m.tags = categories.filter((c) => typeFrom(c) === 'other');
  m.contentRating = ratingFromTags(m.tags);
  m.pubStatus = statusFrom(text(doc.querySelector('.header-stats')).match(/(ongoing|completed|hiatus|cancelled|dropped)\s*status/i)?.[1]);

  const alt = text(doc.querySelector('.alternative-title'));
  if (alt) m.altTitle = alt.split(/[•,;]/)[0].trim() || undefined;

  // The site wraps every synopsis in boilerplate ("X is a Manga in english language, … The Summary is <synopsis>").
  m.description = text(doc.querySelector('.description')).replace(/^.*?\bThe Summary is\s*/i, '').trim();

  const latest = text(doc.querySelector('.header-stats strong'));
  if (latest) {
    m.lastChapter = chapterNumber(latest);
    m.latestUploadedChapter = latest;
  }
  return m;
}

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  const doc = await getHtml(`${BASE}/manga/${encodeURIComponent(manga.id)}/all-chapters/`, NAME);
  const out = new Map<string, Chapter>();
  for (const li of doc.querySelectorAll('ul.chapter-list li')) {
    const a = li.querySelector('a');
    const id = a?.getAttribute('href')?.match(/^\/reader\/en\/([^/?#]+)/)?.[1];
    if (!a || !id) continue;
    // Prefer the number in the address ("…-chapter-12-5-eng-li" is chapter 12.5); fall back to the label.
    const fromUrl = id.match(/-chapter-(\d+(?:-\d+)?)-eng-li$/)?.[1]?.replace('-', '.');
    const num = fromUrl ?? chapterNumber(text(li.querySelector('.chapter-title')));
    const key = num ?? `id:${id}`;
    if (out.has(key)) continue;
    const time = li.querySelector('time');
    out.set(key, {
      id: decodeURIComponent(id),
      key,
      chapter: num,
      volume: null,
      title: null,
      pages: 1, // unknown until opened; >0 marks it readable in-app
      externalUrl: null,
      readableAt: parseSiteDate(time?.getAttribute('datetime') ?? '') ?? parseReleaseDate(text(time)),
      group: null,
    });
  }
  const n = (c: Chapter) => (c.chapter == null ? -1 : parseFloat(c.chapter));
  return [...out.values()].sort((a, b) => n(a) - n(b));
}

async function getChapterPages(chapterId: string): Promise<string[]> {
  const doc = await getHtml(`${BASE}/reader/en/${encodeURIComponent(chapterId)}/`, NAME);
  const pages = doc
    .querySelectorAll('#chapter-reader img.mgr-page, img.mgr-page')
    .map(imgUrl)
    .filter(Boolean);
  const unique = [...new Set(pages)];
  if (unique.length === 0) throw new Error('No pages found for this chapter.');
  return unique;
}

export const mgekoProvider: Provider = {
  id: 'mgeko',
  name: NAME,
  description: 'Manga, manhwa and manhua from mgeko.cc (English). Parsed from the website.',
  iconUrl: `${BASE}/static/img/logo_200x200.png`,
  languages: [{ code: 'en', label: 'English' }],
  types: ['manga', 'manhwa', 'manhua'],
  sorts: ['relevance'],
  search,
  getManga,
  getChapters,
  getChapterPages,
};
