/**
 * Manhwa18 provider — https://manhwa18.net (an 18+ site: every title counts as adult)
 *
 * The site has no API, but every page it serves carries its data as JSON inside the HTML (a Laravel "Inertia" app,
 * the `data-page` attribute), the same idea as the Asura provider.
 *  - /manga-list?page=N                          the list (24 per page);
 *  - /manga/<slug>                               details and the full chapter list;
 *  - /manga/<slug>/<chapter-slug>                the page images.
 *
 * Search: the site's own search page is disallowed in robots.txt and its list ignores every filter, so a title search
 * filters a cached copy of the whole list (about 100 pages). That copy is built in the background and a search waits
 * only a short while for it, so the first search may cover just the newest part of the site; later ones cover it all.
 */
import { getHtml } from './html';
import type { Chapter, Manga, MangaType, Page, Provider, SearchOptions } from './types';

const BASE = 'https://manhwa18.net';
const NAME = 'Manhwa18';
const PAGE_SIZE = 24;
const INDEX_TTL = 15 * 60 * 1000;
const MAX_INDEX_PAGES = 150;
/** How long a search waits for the cached list before using what has been loaded so far. */
const EARLY_MS = 10 * 1000;

interface Genre {
  name?: string;
}
interface RawManga {
  slug?: string;
  name?: string;
  other_name?: string | null;
  cover_url?: string;
  thumb_url?: string;
  pilot?: string | null;
  genres?: Genre[];
  artists?: Genre[];
  tags?: Genre[];
  latest_chapter?: { name?: string } | null;
}

/** The JSON the page carries for its own use. */
async function readProps(url: string): Promise<Record<string, any>> {
  const doc = await getHtml(url, NAME);
  const raw = doc.querySelector('[data-page]')?.getAttribute('data-page');
  if (!raw) throw new Error(`Could not read this page from ${NAME}.`);
  try {
    return JSON.parse(raw).props ?? {};
  } catch {
    throw new Error(`Could not read this page from ${NAME}.`);
  }
}

const stripHtml = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

const chapterNumberOf = (label: string): string | null => label.match(/(\d+(?:[.-]\d+)?)/)?.[1]?.replace('-', '.') ?? null;

function typeFrom(names: string[]): MangaType {
  const v = names.map((x) => x.toLowerCase());
  if (v.includes('manhwa')) return 'manhwa';
  if (v.includes('manhua')) return 'manhua';
  if (v.includes('manga')) return 'manga';
  return 'other';
}

const TYPE_LABELS = ['manhwa', 'manga', 'manhua'];

function toManga(r: RawManga): Manga | null {
  if (!r.slug || !r.name) return null;
  const names = (r.genres ?? []).map((g) => g.name ?? '').filter(Boolean);
  const m: Manga = {
    id: r.slug,
    title: r.name,
    altTitle: r.other_name && r.other_name !== r.name ? r.other_name : undefined,
    description: stripHtml(r.pilot ?? ''),
    coverUrl: r.cover_url || r.thumb_url || '', // (the thumbnail address the list gives returns 404)
    coverUrlLarge: r.cover_url || r.thumb_url || '',
    type: typeFrom(names),
    originalLanguage: 'en',
    pubStatus: names.some((n) => /^complet/i.test(n)) ? 'completed' : 'unknown', // the site's status field is unreliable
    year: null,
    contentRating: 'pornographic', // an 18+ site: only shown when "Show mature titles" is on
    tags: [...new Set([...names, ...(r.tags ?? []).map((t) => t.name ?? '')].filter((n) => n && !TYPE_LABELS.includes(n.toLowerCase())))],
    authors: [...new Set((r.artists ?? []).map((a) => a.name ?? '').filter((n) => n && n.toLowerCase() !== 'unknown'))],
    lastChapter: null,
    latestUploadedChapter: null,
    availableLanguages: ['en'],
    chapterNumbersResetOnNewVolume: false,
  };
  const latest = r.latest_chapter?.name;
  if (latest) {
    m.lastChapter = chapterNumberOf(latest);
    m.latestUploadedChapter = latest;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Cached copy of the whole list, for searching
// ---------------------------------------------------------------------------

const index = new Map<string, Manga>();
let builtAt = 0;
let crawl: { done: Promise<void>; early: Promise<void> } | null = null;

async function readList(page: number): Promise<{ items: Manga[]; lastPage: number; total: number }> {
  const props = await readProps(`${BASE}/manga-list?page=${page}`);
  const p = props.paginate ?? {};
  const items = ((p.data ?? []) as RawManga[]).map(toManga).filter((m): m is Manga => !!m);
  return { items, lastPage: Number(p.last_page) || page, total: Number(p.total) || items.length };
}

function startCrawl() {
  let release!: () => void;
  const early = new Promise<void>((r) => (release = r));
  const startedAt = Date.now();
  const done = (async () => {
    try {
      for (let page = 1; page <= MAX_INDEX_PAGES; page++) {
        let data;
        try {
          data = await readList(page);
        } catch (e) {
          if (index.size === 0) throw e;
          return; // keep what has been loaded
        }
        for (const m of data.items) if (!index.has(m.id)) index.set(m.id, m);
        if (data.items.length === 0 || page >= data.lastPage) break;
        if (Date.now() - startedAt > EARLY_MS) release();
      }
      builtAt = Date.now();
    } finally {
      release();
      crawl = null;
    }
  })();
  done.catch(() => {}); // a search that already moved on must not leave an unhandled rejection
  return { done, early };
}

async function searchLocal(title: string, opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  if (Date.now() - builtAt > INDEX_TTL) {
    const c = (crawl ??= startCrawl());
    await Promise.race([c.done, c.early]);
    if (index.size === 0) await c.done; // nothing loaded: surface the error
  }
  const words = title.toLowerCase().split(/\s+/).filter(Boolean);
  let matches = [...index.values()].filter((m) => {
    const hay = `${m.title} ${m.altTitle ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  if (opts.type && opts.type !== 'all') matches = matches.filter((m) => m.type === 'other' || m.type === opts.type);
  return { items: matches.slice(offset, offset + PAGE_SIZE), total: matches.length, offset, limit: PAGE_SIZE };
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  const empty = { items: [], total: 0, offset, limit: PAGE_SIZE };
  // Every title here is 18+: with mature titles off there is nothing to show, so don't even ask the site.
  if (!opts.ratings.includes('pornographic')) return empty;

  const title = opts.title?.trim();
  if (title) return searchLocal(title, opts);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const data = await readList(page);
  let items = data.items;
  if (opts.type && opts.type !== 'all') items = items.filter((m) => m.type === 'other' || m.type === opts.type);
  return { items, total: data.total, offset, limit: PAGE_SIZE };
}

async function getManga(id: string): Promise<Manga> {
  const props = await readProps(`${BASE}/manga/${encodeURIComponent(id)}`);
  const m = props.manga ? toManga(props.manga as RawManga) : null;
  if (!m) throw new Error(`Could not read this title from ${NAME}.`);
  const chapters = (props.chapters ?? []) as { name?: string }[];
  const latest = chapters.map((c) => c.name ?? '').find(Boolean);
  if (latest) {
    m.lastChapter = chapterNumberOf(latest);
    m.latestUploadedChapter = latest;
  }
  return m;
}

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  const props = await readProps(`${BASE}/manga/${encodeURIComponent(manga.id)}`);
  const rows = (props.chapters ?? []) as { name?: string; slug?: string; order?: number; created_at?: string }[];
  const out = new Map<string, Chapter>();
  for (const r of rows) {
    if (!r.slug) continue;
    const num = chapterNumberOf(r.name ?? '') ?? (Number.isFinite(r.order) ? String(r.order) : null);
    const key = num ?? `id:${r.slug}`;
    if (out.has(key)) continue;
    const sub = (r.name ?? '').replace(/^\s*(chapter|ch\.?)\s*[\d.\-]+\s*[-–:]?\s*/i, '').trim();
    const time = r.created_at ? Date.parse(r.created_at) : NaN;
    out.set(key, {
      id: `${manga.id}/${r.slug}`,
      key,
      chapter: num,
      volume: null,
      title: sub && sub.toLowerCase() !== (r.name ?? '').toLowerCase() ? sub : null,
      pages: 1, // unknown until opened; >0 marks it readable in-app
      externalUrl: null,
      readableAt: Number.isNaN(time) ? new Date().toISOString() : new Date(time).toISOString(),
      group: null,
    });
  }
  const n = (c: Chapter) => (c.chapter == null ? -1 : parseFloat(c.chapter));
  return [...out.values()].sort((a, b) => n(a) - n(b));
}

async function getChapterPages(chapterId: string): Promise<string[]> {
  const [slug, chapter] = chapterId.split('/');
  const props = await readProps(`${BASE}/manga/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}`);
  const images = ((props.chapterImages ?? []) as { src?: string }[]).map((i) => i.src ?? '').filter(Boolean);
  if (images.length === 0) throw new Error('No pages found for this chapter.');
  return [...new Set(images)];
}

export const manhwa18Provider: Provider = {
  id: 'manhwa18',
  name: NAME,
  description: '18+ manhwa, manhua and manga from manhwa18.net (English). Only shown when "Show mature titles" is on.',
  iconUrl: `${BASE}/icons/icon-180.png`,
  languages: [{ code: 'en', label: 'English' }],
  types: ['manga', 'manhwa', 'manhua'],
  sorts: ['relevance', 'latestUploadedChapter'],
  adult: true,
  search,
  getManga,
  getChapters,
  getChapterPages,
};

/** For tests: forget the cached list. */
export function _resetIndex() {
  index.clear();
  builtAt = 0;
  crawl = null;
}

