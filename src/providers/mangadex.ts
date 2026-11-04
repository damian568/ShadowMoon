/**
 * MangaDex provider — https://api.mangadex.org/docs/
 * Free, ad-free, community-run. Requests are throttled to stay under its rate limit (~5/s).
 */
import {
  isReadable,
  type Chapter,
  type ContentRating,
  type Language,
  type Manga,
  type MangaStats,
  type MangaType,
  type Page,
  type Provider,
  type SearchOptions,
  type SortOrder,
} from './types';

const API = 'https://api.mangadex.org';
const COVERS = 'https://uploads.mangadex.org/covers';
const HEADERS = { 'User-Agent': 'ShadowMoon/1.0 (personal reader app)' };
const ALL_RATINGS: ContentRating[] = ['safe', 'suggestive', 'erotica', 'pornographic'];

// ---------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------

type QueryValue = string | number | boolean | undefined | null | (string | number)[];

// MangaDex rejects percent-encoded brackets in parameter names (order%5Brating%5D),
// so keep `[` and `]` literal in keys. iOS sends the URL exactly as written.
const encodeKey = (key: string) => encodeURIComponent(key).replace(/%5B/gi, '[').replace(/%5D/gi, ']');

function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${encodeKey(key)}[]=${encodeURIComponent(String(v))}`);
    } else {
      parts.push(`${encodeKey(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Keep at least MIN_GAP ms between request starts to stay under the rate limit.
const MIN_GAP = 220;
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + MIN_GAP;
  if (start > now) await sleep(start - now);
}

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, params: Record<string, QueryValue> = {}, attempt = 0): Promise<T> {
  await throttle();
  let res: Response;
  try {
    res = await fetch(`${API}${path}${buildQuery(params)}`, { headers: HEADERS });
  } catch {
    throw new ApiError('Network error — check your internet connection.');
  }
  if (res.status === 429 && attempt < 2) {
    const retryAt = Number(res.headers.get('X-RateLimit-Retry-After'));
    const wait = retryAt ? Math.max(1000, retryAt * 1000 - Date.now()) : 2000;
    await sleep(Math.min(wait, 15000));
    return request<T>(path, params, attempt + 1);
  }
  if (res.status >= 500 && attempt < 1) {
    await sleep(1000);
    return request<T>(path, params, attempt + 1);
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body?.errors?.[0]?.detail ?? detail;
    } catch {}
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

interface RawRelationship {
  id: string;
  type: string;
  attributes?: Record<string, any>;
}

interface RawManga {
  id: string;
  attributes: Record<string, any>;
  relationships: RawRelationship[];
}

interface RawChapter {
  id: string;
  attributes: {
    volume: string | null;
    chapter: string | null;
    title: string | null;
    externalUrl: string | null;
    pages: number;
    readableAt: string;
    publishAt: string;
  };
  relationships: RawRelationship[];
}

const TYPE_BY_LANG: Record<string, MangaType> = {
  ja: 'manga',
  ko: 'manhwa',
  zh: 'manhua',
  'zh-hk': 'manhua',
};

export const LANGS_BY_TYPE: Record<Exclude<MangaType, 'other'>, string[]> = {
  manga: ['ja'],
  manhwa: ['ko'],
  manhua: ['zh', 'zh-hk'],
};

function pickLocalized(map: Record<string, string> | undefined, prefer = 'en'): string | undefined {
  if (!map) return undefined;
  return map[prefer] ?? map.en ?? Object.values(map)[0];
}

function pickTitle(a: Record<string, any>): { title: string; altTitle?: string } {
  const main: Record<string, string> = a.title ?? {};
  const alts: Record<string, string>[] = a.altTitles ?? [];
  const altEn = alts.find((t) => t.en)?.en;
  const primary = main.en ?? altEn ?? Object.values(main)[0] ?? 'Untitled';
  const original = Object.values(main)[0];
  return { title: primary, altTitle: original && original !== primary ? original : undefined };
}

function cleanDescription(text: string | undefined): string {
  if (!text) return '';
  return text
    .split(/\n-{3,}|\n_{3,}/)[0] // drop the "links / credits" footer most entries have
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links -> text
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1') // bold / italics
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function coverUrl(mangaId: string, fileName: string | undefined, size: 256 | 512 = 256): string {
  if (!fileName) return '';
  return `${COVERS}/${mangaId}/${fileName}.${size}.jpg`;
}

function mapManga(raw: RawManga): Manga {
  const a = raw.attributes;
  const cover = raw.relationships.find((r) => r.type === 'cover_art')?.attributes?.fileName as string | undefined;
  const people = raw.relationships
    .filter((r) => (r.type === 'author' || r.type === 'artist') && r.attributes?.name)
    .map((r) => r.attributes!.name as string);
  const { title, altTitle } = pickTitle(a);
  return {
    id: raw.id,
    title,
    altTitle,
    description: cleanDescription(pickLocalized(a.description)),
    coverUrl: coverUrl(raw.id, cover, 256),
    coverUrlLarge: coverUrl(raw.id, cover, 512),
    type: TYPE_BY_LANG[a.originalLanguage] ?? 'other',
    originalLanguage: a.originalLanguage,
    pubStatus: a.status ?? 'unknown',
    year: a.year ?? null,
    contentRating: a.contentRating,
    tags: (a.tags ?? [])
      .filter((t: any) => t.attributes?.group !== 'format' || t.attributes?.name?.en === 'Long Strip')
      .map((t: any) => t.attributes?.name?.en)
      .filter(Boolean),
    authors: [...new Set(people)],
    lastChapter: a.lastChapter || null,
    latestUploadedChapter: a.latestUploadedChapter ?? null,
    availableLanguages: a.availableTranslatedLanguages ?? [],
    chapterNumbersResetOnNewVolume: !!a.chapterNumbersResetOnNewVolume,
  };
}

function chapterKey(c: RawChapter['attributes'], id: string, resetsOnVolume: boolean): string {
  if (c.chapter == null || c.chapter === '') return `id:${id}`; // oneshots etc.
  const num = String(parseFloat(c.chapter));
  const ch = num === 'NaN' ? c.chapter : num;
  return resetsOnVolume ? `v${c.volume ?? '-'}:${ch}` : ch;
}

function compareChapters(a: Chapter, b: Chapter, resetsOnVolume: boolean): number {
  const num = (v: string | null) => (v == null || v === '' || isNaN(parseFloat(v)) ? -1 : parseFloat(v));
  if (resetsOnVolume) {
    const dv = num(a.volume) - num(b.volume);
    if (dv !== 0) return dv;
  }
  const dc = num(a.chapter) - num(b.chapter);
  if (dc !== 0) return dc;
  return a.readableAt.localeCompare(b.readableAt);
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;
  const order: SortOrder = opts.order ?? (opts.title ? 'relevance' : 'followedCount');
  const res = await request<{ data: RawManga[]; total: number }>('/manga', {
    title: opts.title?.trim() || undefined,
    limit,
    offset,
    includes: ['cover_art'],
    contentRating: opts.ratings,
    availableTranslatedLanguage: [opts.language],
    hasAvailableChapters: 'true',
    originalLanguage: opts.type && opts.type !== 'all' && opts.type !== 'other' ? LANGS_BY_TYPE[opts.type] : undefined,
    [`order[${order}]`]: 'desc',
  });
  return { items: res.data.map(mapManga), total: res.total, offset, limit };
}

async function getManga(id: string): Promise<Manga> {
  const res = await request<{ data: RawManga }>(`/manga/${id}`, {
    includes: ['cover_art', 'author', 'artist'],
  });
  return mapManga(res.data);
}

/** Up to 100 titles per request — used by the update checker. */
async function getMangaByIds(ids: string[]): Promise<Manga[]> {
  if (ids.length === 0) return [];
  const out: Manga[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const res = await request<{ data: RawManga[] }>('/manga', {
      ids: ids.slice(i, i + 100),
      limit: 100,
      includes: ['cover_art'],
      contentRating: ALL_RATINGS,
    });
    out.push(...res.data.map(mapManga));
  }
  return out;
}

async function getStats(id: string): Promise<MangaStats> {
  const res = await request<{ statistics: Record<string, any> }>(`/statistics/manga/${id}`);
  const s = res.statistics?.[id];
  return { rating: s?.rating?.bayesian ?? s?.rating?.average ?? null, follows: s?.follows ?? null };
}

/**
 * All chapters for a manga in one language, de-duplicated per chapter number
 * (several groups often upload the same chapter) and sorted ascending.
 * In-app readable uploads are preferred over links to official external sites.
 */
async function getChapters(manga: Pick<Manga, 'id' | 'chapterNumbersResetOnNewVolume'>, language: string): Promise<Chapter[]> {
  const resets = manga.chapterNumbersResetOnNewVolume;
  const limit = 500;
  const raw: RawChapter[] = [];
  for (let offset = 0; offset < 10000; offset += limit) {
    const res = await request<{ data: RawChapter[]; total: number }>(`/manga/${manga.id}/feed`, {
      translatedLanguage: [language],
      limit,
      offset,
      includes: ['scanlation_group'],
      contentRating: ALL_RATINGS,
      'order[volume]': 'asc',
      'order[chapter]': 'asc',
    });
    raw.push(...res.data);
    if (offset + limit >= res.total) break;
  }

  const byKey = new Map<string, Chapter>();
  for (const r of raw) {
    const a = r.attributes;
    const ch: Chapter = {
      id: r.id,
      key: chapterKey(a, r.id, resets),
      chapter: a.chapter,
      volume: a.volume,
      title: a.title,
      pages: a.pages,
      externalUrl: a.externalUrl,
      readableAt: a.readableAt ?? a.publishAt,
      group: (r.relationships.find((x) => x.type === 'scanlation_group')?.attributes?.name as string) ?? null,
    };
    const existing = byKey.get(ch.key);
    if (!existing || (!isReadable(existing) && isReadable(ch))) byKey.set(ch.key, ch);
  }
  return [...byKey.values()].sort((a, b) => compareChapters(a, b, resets));
}

async function getChapterPages(chapterId: string, dataSaver: boolean): Promise<string[]> {
  const res = await request<{ baseUrl: string; chapter: { hash: string; data: string[]; dataSaver: string[] } }>(
    `/at-home/server/${chapterId}`,
  );
  const folder = dataSaver ? 'data-saver' : 'data';
  const files = dataSaver ? res.chapter.dataSaver : res.chapter.data;
  return files.map((f) => `${res.baseUrl}/${folder}/${res.chapter.hash}/${f}`);
}

const LANGUAGES: Language[] = [
  { code: 'en', label: 'English' },
  { code: 'es-la', label: 'Español (LATAM)' },
  { code: 'es', label: 'Español' },
  { code: 'pt-br', label: 'Português (BR)' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'ru', label: 'Русский' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'vi', label: 'Tiếng Việt' },
];

export const mangadexProvider: Provider = {
  id: 'mangadex',
  name: 'MangaDex',
  description: 'Free, community-run and ad-free. Manga, manhwa and manhua in many languages.',
  languages: LANGUAGES,
  types: ['manga', 'manhwa', 'manhua'],
  sorts: ['relevance', 'followedCount', 'latestUploadedChapter', 'rating', 'createdAt'],
  search,
  getManga,
  getMangaByIds,
  getChapters,
  getChapterPages,
  getStats,
};
