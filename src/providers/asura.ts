/**
 * Asura Scans provider — https://asurascans.com
 *
 * The site has no public API (its /api/ routes are off-limits in robots.txt, so they are not used).
 * It is built with Astro, which embeds the data for each page as JSON inside the HTML:
 *  - /browse?search=&sort=&page=  carries the list of titles (20 per page, with covers and details);
 *  - a title page carries the chapter list;
 *  - a chapter page carries the page images.
 * If the site changes its layout, only this file needs updating.
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, imgUrl, text } from './html';
import type { Chapter, ContentRating, Manga, MangaType, Page, Provider, SearchOptions } from './types';

const BASE = 'https://asurascans.com';
const NAME = 'Asura Scans';
const PAGE_SIZE = 20;

/** Astro serializes island props as [type, value] pairs (0 = plain value, 1 = array). Turn them back into plain data. */
function unwrap(v: any): any {
  if (Array.isArray(v)) {
    if (v[0] === 0) return unwrap(v[1]);
    if (v[0] === 1 && Array.isArray(v[1])) return v[1].map(unwrap);
    return v;
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  return v;
}

function islandProps(doc: HTMLElement, component: string): any | null {
  const el = doc.querySelectorAll('astro-island').find((i) => (i.getAttribute('component-url') ?? '').includes(component));
  const raw = el?.getAttribute('props');
  if (!raw) return null;
  try {
    return unwrap(JSON.parse(raw));
  } catch {
    return null;
  }
}

function typeFrom(label: string | undefined): MangaType {
  const v = (label ?? '').toLowerCase();
  if (v.includes('manhwa')) return 'manhwa';
  if (v.includes('manhua')) return 'manhua';
  if (v.includes('manga')) return 'manga';
  return 'other';
}

function ratingFromTags(tags: string[]): ContentRating {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => ['adult', 'smut', 'hentai', 'sexual violence'].includes(x))) return 'pornographic';
  if (t.some((x) => ['mature', 'ecchi'].includes(x))) return 'suggestive';
  return 'safe';
}

/** "/comics/solo-leveling-ragnarok-ab39de10" -> "solo-leveling-ragnarok-ab39de10" */
const idFromUrl = (url: string | undefined) => url?.match(/\/comics\/([^/?#]+)/)?.[1] ?? null;

interface RawSeries {
  title: string;
  alt_titles?: string[];
  description?: string;
  cover?: string;
  status?: string;
  type?: string;
  author?: string;
  artist?: string;
  chapter_count?: number;
  last_chapter_at?: string;
  public_url?: string;
  genres?: { name: string }[];
  latest_chapters?: { number?: number }[];
}

function mapSeries(s: RawSeries): Manga | null {
  const id = idFromUrl(s.public_url);
  if (!id) return null;
  const tags = (s.genres ?? []).map((g) => g.name);
  const people = [s.author, s.artist].filter((x): x is string => !!x && x.toLowerCase() !== 'n/a');
  const latest = s.latest_chapters?.[0]?.number;
  return {
    id,
    title: s.title,
    altTitle: s.alt_titles?.find((a) => /^[\x00-\x7F]+$/.test(a) && a !== s.title),
    description: (s.description ?? '').trim(),
    coverUrl: s.cover ?? '',
    coverUrlLarge: (s.cover ?? '').replace(/-400\.webp$/, '.webp'),
    type: typeFrom(s.type),
    originalLanguage: 'en',
    pubStatus: (s.status ?? 'unknown').toLowerCase(),
    year: null,
    contentRating: ratingFromTags(tags),
    tags,
    authors: [...new Set(people)],
    lastChapter: latest != null ? String(latest) : s.chapter_count ? String(s.chapter_count) : null,
    latestUploadedChapter: s.last_chapter_at ?? null,
    availableLanguages: ['en'],
    chapterNumbersResetOnNewVolume: false,
  };
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

const SORT: Partial<Record<NonNullable<SearchOptions['order']>, string>> = {
  followedCount: 'popular',
  latestUploadedChapter: 'update',
  rating: 'rating',
};

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const params = new URLSearchParams({ page: String(page) });
  const title = opts.title?.trim();
  if (title) params.set('search', title);
  else params.set('sort', SORT[opts.order ?? 'latestUploadedChapter'] ?? 'update');
  if (opts.type && opts.type !== 'all' && opts.type !== 'other') params.set('type', opts.type);

  const doc = await getHtml(`${BASE}/browse?${params}`, NAME);
  const props = islandProps(doc, 'BrowseFilters');
  const series: RawSeries[] = props?.initialSeries ?? [];
  const allowed = new Set(opts.ratings);
  const items = series
    .map(mapSeries)
    .filter((m): m is Manga => !!m && allowed.has(m.contentRating));
  const total = Number(props?.totalCount) || offset + items.length;
  return { items, total, offset, limit: PAGE_SIZE };
}

async function getTitlePage(id: string) {
  const doc = await getHtml(`${BASE}/comics/${encodeURIComponent(id)}`, NAME);
  return { doc, chapters: islandProps(doc, 'ChapterListReact') };
}

async function getManga(id: string): Promise<Manga> {
  const { doc, chapters } = await getTitlePage(id);
  const title = text(doc.querySelector('h1'));
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);

  const m: Manga = {
    id,
    title,
    description: doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
    coverUrl: chapters?.coverUrl ?? imgUrl(doc.querySelector('meta[property="og:image"]')) ?? '',
    coverUrlLarge: '',
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
  m.coverUrl = m.coverUrl || doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
  m.coverUrlLarge = m.coverUrl.replace(/-400\.webp$/, '.webp');

  // Details sit in one block: "Status ongoing Type manhwa Author X Artist Y".
  const flat = doc.text.replace(/\s+/g, ' ');
  const status = flat.match(/Status\s+(ongoing|completed|hiatus|dropped|cancelled|season end)/i)?.[1];
  const type = flat.match(/Type\s+(manhwa|manhua|manga|webtoon|novel)/i)?.[1];
  const author = flat.match(/Author\s+(.+?)\s+Artist\s+/i)?.[1];
  const artist = flat.match(/Artist\s+(.+?)\s+(?:Action|Adventure|Fantasy|Comedy|Drama|Romance|Martial|Genres|Synopsis|Read)\b/i)?.[1];
  m.pubStatus = (status ?? 'unknown').toLowerCase();
  m.type = typeFrom(type);
  m.authors = [...new Set([author, artist].filter((x): x is string => !!x && x.length < 60 && x.toLowerCase() !== 'n/a'))];
  m.tags = [...new Set(doc.querySelectorAll('a[href*="genre"]').map((a) => text(a)).filter(Boolean))];
  m.contentRating = ratingFromTags(m.tags);

  const list: { number: number; published_at?: string }[] = chapters?.chapters ?? [];
  if (list.length) {
    const top = list.reduce((a, b) => (b.number > a.number ? b : a));
    m.lastChapter = String(top.number);
    m.latestUploadedChapter = top.published_at ?? String(top.number);
  }
  return m;
}

interface RawChapter {
  number: number;
  page_count?: number;
  is_premium?: boolean;
  early_access_until?: string;
  published_at?: string;
}

const isLocked = (c: RawChapter) =>
  !!c.is_premium || (!!c.early_access_until && new Date(c.early_access_until).getTime() > Date.now());

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  const { chapters } = await getTitlePage(manga.id);
  const list: RawChapter[] = chapters?.chapters ?? [];
  const out = new Map<string, Chapter>();
  for (const c of list) {
    const key = String(c.number);
    if (out.has(key)) continue;
    out.set(key, {
      id: `${manga.id}/${key}`,
      key,
      chapter: key,
      volume: null,
      title: null,
      pages: c.page_count && c.page_count > 0 ? c.page_count : 1,
      // Premium / early-access chapters need an account on the site: open them there instead.
      externalUrl: isLocked(c) ? `${BASE}/comics/${manga.id}/chapter/${key}` : null,
      readableAt: c.published_at ?? new Date().toISOString(),
      group: null,
    });
  }
  return [...out.values()].sort((a, b) => parseFloat(a.chapter!) - parseFloat(b.chapter!));
}

async function getChapterPages(chapterId: string): Promise<string[]> {
  const [id, number] = chapterId.split('/');
  const doc = await getHtml(`${BASE}/comics/${encodeURIComponent(id)}/chapter/${number}`, NAME);
  const pages = doc
    .querySelectorAll('img')
    .map(imgUrl)
    .filter((u) => /\/asura-images\/chapters\//.test(u));
  const unique = [...new Set(pages)];
  if (unique.length === 0) throw new Error('No pages found. This chapter may be locked (premium) on Asura Scans.');
  return unique;
}

export const asuraProvider: Provider = {
  id: 'asura',
  name: NAME,
  description: 'Manhwa, manga and manhua from asurascans.com (English). Parsed from the website.',
  iconUrl: `${BASE}/images/logo.webp`,
  languages: [{ code: 'en', label: 'English' }],
  types: ['manga', 'manhwa', 'manhua'],
  sorts: ['relevance', 'followedCount', 'latestUploadedChapter', 'rating'],
  search,
  getManga,
  getChapters,
  getChapterPages,
};
