/**
 * TCB Scans provider — https://tcbonepiecechapters.com
 *
 * A small scanlation group site with a handful of series. No API, so this reads its public HTML (no robots.txt):
 *  - /projects                      every series (one page); the site has no search, so searching filters this list;
 *  - /mangas/<n>/<slug>             details and the chapter list;
 *  - /chapters/<n>/<slug>           the page images (`img.fixed-ratio-content`).
 *
 * Ids: a title is "<n>~<slug>" and a chapter is "<n>~<slug>" too (each address needs both parts).
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, text } from './html';
import type { Chapter, Manga, Page, Provider, SearchOptions } from './types';

const BASE = 'https://tcbonepiecechapters.com';
const NAME = 'TCB Scans';
const LIST_TTL = 15 * 60 * 1000;

function blank(id: string, title: string, cover: string): Manga {
  return {
    id,
    title,
    description: '',
    coverUrl: cover,
    coverUrlLarge: cover,
    type: 'manga',
    originalLanguage: 'ja',
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

/** "/mangas/5/one-piece" -> "5~one-piece" (and the same for /chapters/…) */
const idFromHref = (href: string | undefined, section: 'mangas' | 'chapters'): string | null => {
  const m = href?.match(new RegExp(`/${section}/(\\d+)/([^/?#]+)`));
  return m ? `${m[1]}~${decodeURIComponent(m[2])}` : null;
};
const hrefFromId = (id: string, section: 'mangas' | 'chapters') => {
  const [n, slug] = id.split('~');
  return `${BASE}/${section}/${encodeURIComponent(n)}/${encodeURIComponent(slug ?? '')}`;
};

let listCache: { at: number; items: Manga[] } | null = null;

async function allSeries(): Promise<Manga[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL) return listCache.items;
  const doc = await getHtml(`${BASE}/projects`, NAME);
  const byId = new Map<string, { title: string; cover: string }>();
  for (const a of doc.querySelectorAll('a[href^="/mangas/"]')) {
    const id = idFromHref(a.getAttribute('href'), 'mangas');
    if (!id) continue;
    const entry = byId.get(id) ?? { title: '', cover: '' };
    // One link wraps the cover picture, another holds the title.
    entry.title ||= text(a);
    entry.cover ||= a.querySelector('img')?.getAttribute('src') ?? '';
    byId.set(id, entry);
  }
  const items = [...byId.entries()].filter(([, v]) => v.title).map(([id, v]) => blank(id, v.title, v.cover));
  if (items.length === 0) throw new Error(`Could not read the series list from ${NAME}.`);
  listCache = { at: Date.now(), items };
  return items;
}

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const q = opts.title?.trim().toLowerCase();
  let items = await allSeries();
  if (q) items = items.filter((m) => m.title.toLowerCase().includes(q));
  const offset = opts.offset ?? 0;
  const slice = items.slice(offset, offset + (opts.limit ?? 30));
  return { items: slice, total: items.length, offset, limit: opts.limit ?? 30 };
}

const chapterNumberOf = (label: string): string | null => label.match(/chapter\s+(\d+(?:\.\d+)?)/i)?.[1] ?? null;

function readChapters(doc: HTMLElement): Chapter[] {
  const out = new Map<string, Chapter>();
  for (const a of doc.querySelectorAll('a[href^="/chapters/"]')) {
    const id = idFromHref(a.getAttribute('href'), 'chapters');
    if (!id) continue;
    const lines = a.querySelectorAll('div').map((d) => text(d)).filter(Boolean);
    const label = lines[0] ?? text(a);
    const num = chapterNumberOf(label);
    const key = num ?? `id:${id}`;
    if (out.has(key)) continue;
    out.set(key, {
      id,
      key,
      chapter: num,
      volume: null,
      title: lines[1] || null,
      pages: 1, // unknown until opened; >0 marks it readable in-app
      externalUrl: null,
      readableAt: new Date(0).toISOString(), // the site shows no dates
      group: null,
    });
  }
  const n = (c: Chapter) => (c.chapter == null ? -1 : parseFloat(c.chapter));
  return [...out.values()].sort((a, b) => n(a) - n(b));
}

async function getManga(id: string): Promise<Manga> {
  const doc = await getHtml(hrefFromId(id, 'mangas'), NAME);
  const title = text(doc.querySelector('h1'));
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);
  const cover = doc.querySelectorAll('img').map((i) => i.getAttribute('src') ?? '').find((s) => /^https?:\/\//.test(s)) ?? '';
  const m = blank(id, title, cover);
  m.description = text(doc.querySelector('p.leading-6'));
  const chapters = readChapters(doc);
  const last = chapters[chapters.length - 1];
  if (last?.chapter) {
    m.lastChapter = last.chapter;
    m.latestUploadedChapter = `Chapter ${last.chapter}`;
  }
  return m;
}

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  return readChapters(await getHtml(hrefFromId(manga.id, 'mangas'), NAME));
}

async function getChapterPages(chapterId: string): Promise<string[]> {
  const doc = await getHtml(hrefFromId(chapterId, 'chapters'), NAME);
  const pages = doc
    .querySelectorAll('img.fixed-ratio-content')
    .map((i) => (i.getAttribute('src') ?? '').trim())
    .filter(Boolean);
  if (pages.length === 0) throw new Error('No pages found for this chapter.');
  return [...new Set(pages)];
}

export const tcbscansProvider: Provider = {
  id: 'tcbscans',
  name: NAME,
  description: 'One Piece, Jujutsu Kaisen and other series from tcbonepiecechapters.com (English). A small catalogue.',
  iconUrl: `${BASE}/files/h-logo.png`,
  languages: [{ code: 'en', label: 'English' }],
  types: ['manga'],
  sorts: ['relevance'],
  search,
  getManga,
  getChapters,
  getChapterPages,
};

// Exposed for tests.
export const _resetCache = () => {
  listCache = null;
};
