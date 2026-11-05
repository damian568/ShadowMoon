/**
 * Manga18.club provider — https://manga18.club (an 18+ site: every title counts as adult)
 *
 * The site has no API, so this reads its public HTML pages.
 *  - /list-manga/?page=N[&order_by=views|lastest|name][&search=…]   the list and search (20 per page);
 *  - /manhwa/<slug>                                                  details and the full chapter list;
 *  - /manhwa/<slug>/<chapter>                                        the page images, listed in the page as base64 text.
 *
 * robots.txt disallows /api/ and /apisearch, which this provider never calls.
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, getHtmlText, imgUrl, text } from './html';
import type { Chapter, Manga, MangaType, Page, Provider, SearchOptions, SortOrder } from './types';

const BASE = 'https://manga18.club';
const NAME = 'Manga18.club';
const PAGE_SIZE = 20;

const ORDER: Partial<Record<SortOrder, string>> = {
  followedCount: 'views',
  latestUploadedChapter: 'lastest', // (the site's own spelling)
};

function statusFrom(label: string | undefined): string {
  const v = (label ?? '').toLowerCase();
  if (v.includes('going')) return 'ongoing';
  if (v.includes('complete')) return 'completed';
  if (v.includes('hiatus')) return 'hiatus';
  if (v.includes('cancel') || v.includes('drop')) return 'cancelled';
  return 'unknown';
}

function typeFrom(labels: string[]): MangaType {
  const v = labels.map((x) => x.toLowerCase());
  if (v.includes('manhwa')) return 'manhwa';
  if (v.includes('manhua')) return 'manhua';
  if (v.includes('manga')) return 'manga';
  return 'other';
}

/** "05-11-2026" (day-month-year) as UTC; the current time when it can't be read. */
function parseDate(raw: string): string {
  const m = raw.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return new Date().toISOString();
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function blank(slug: string, title: string, cover: string): Manga {
  return {
    id: slug,
    title,
    description: '',
    coverUrl: cover,
    coverUrlLarge: cover,
    type: 'other', // lists do not say whether a title is manga, manhwa or manhua
    originalLanguage: 'en',
    pubStatus: 'unknown',
    year: null,
    contentRating: 'pornographic', // an 18+ site: only shown when "Show mature titles" is on
    tags: [],
    authors: [],
    lastChapter: null,
    latestUploadedChapter: null,
    availableLanguages: ['en'],
    chapterNumbersResetOnNewVolume: false,
  };
}

const chapterNumberOf = (label: string): string | null => label.match(/(\d+(?:[.-]\d+)?)/)?.[1]?.replace('-', '.') ?? null;

function parseCard(card: HTMLElement): Manga | null {
  const link = card.querySelector('.mg_name a') ?? card.querySelector('a[href*="/manhwa/"]');
  const slug = link?.getAttribute('href')?.match(/\/manhwa\/([^/?#]+)/)?.[1];
  if (!link || !slug) return null;
  const title = link.getAttribute('title')?.trim() || text(link);
  const m = blank(decodeURIComponent(slug), title, imgUrl(card.querySelector('.story_images img, img')));
  const latest = text(card.querySelector('.chapter_count a'));
  if (latest) {
    m.lastChapter = chapterNumberOf(latest);
    m.latestUploadedChapter = latest;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

async function search(opts: SearchOptions): Promise<Page<Manga>> {
  const offset = opts.offset ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const title = opts.title?.trim();
  const params = [`page=${page}`];
  if (title) params.push(`search=${encodeURIComponent(title)}`);
  else if (ORDER[opts.order ?? 'followedCount']) params.push(`order_by=${ORDER[opts.order ?? 'followedCount']}`);
  const doc = await getHtml(`${BASE}/list-manga/?${params.join('&')}`, NAME);

  let items = doc
    .querySelectorAll('.story_item')
    .map(parseCard)
    .filter((m): m is Manga => !!m);
  // The site gives no type in lists, so those titles stay "other"; the type filter keeps them and the registry
  // looks the real type up (see searchManga).
  if (opts.type && opts.type !== 'all') items = items.filter((m) => m.type === 'other' || m.type === opts.type);
  const allowed = new Set(opts.ratings);
  items = items.filter((m) => allowed.has(m.contentRating));

  const hasNext = doc.querySelectorAll('.pagination a').some((a) => /›/.test(a.text));
  const loaded = offset + items.length;
  return { items, total: hasNext ? loaded + PAGE_SIZE : loaded, offset, limit: PAGE_SIZE };
}

/** The label/value rows of the info box ("Author", "Status", "Categories", …). */
function readInfo(doc: HTMLElement): Record<string, HTMLElement> {
  const out: Record<string, HTMLElement> = {};
  for (const row of doc.querySelectorAll('.detail_listInfo .item')) {
    const label = text(row.querySelector('.info_label')).toLowerCase();
    const value = row.querySelector('.info_value');
    if (label && value) out[label] = value;
  }
  return out;
}

async function getManga(id: string): Promise<Manga> {
  const doc = await getHtml(`${BASE}/manhwa/${encodeURIComponent(id)}`, NAME);
  const title = text(doc.querySelector('.detail_name h1, h1'));
  if (!title) throw new Error(`Could not read this title from ${NAME}.`);
  const m = blank(id, title, imgUrl(doc.querySelector('.detail_avatar img')));
  const info = readInfo(doc);
  const names = text(info['other name']);
  if (names) m.altTitle = names.split(',')[0].trim();
  m.authors = [...new Set(['author', 'artist'].flatMap((k) => (info[k]?.querySelectorAll('a') ?? []).map((a) => text(a))).filter(Boolean))];
  m.pubStatus = statusFrom(text(info['status']));
  const cats = (info['categories']?.querySelectorAll('a') ?? []).map((a) => text(a)).filter(Boolean);
  m.type = typeFrom(cats);
  m.tags = cats.filter((c) => !['manhwa', 'manga', 'manhua'].includes(c.toLowerCase()));
  m.description = text(doc.querySelector('.detail_reviewContent'));

  const first = doc.querySelector('.chapter_box li a.chapter_num');
  if (first) {
    m.lastChapter = chapterNumberOf(text(first));
    m.latestUploadedChapter = text(first);
  }
  return m;
}

async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
  const doc = await getHtml(`${BASE}/manhwa/${encodeURIComponent(manga.id)}`, NAME);
  const out = new Map<string, Chapter>();
  for (const li of doc.querySelectorAll('.chapter_box li')) {
    const a = li.querySelector('a.chapter_num');
    const m = a?.getAttribute('href')?.match(/\/manhwa\/([^/]+)\/([^/?#]+)/);
    if (!a || !m) continue;
    const label = text(a);
    const num = chapterNumberOf(label);
    const key = num ?? `id:${m[2]}`;
    if (out.has(key)) continue;
    out.set(key, {
      id: `${decodeURIComponent(m[1])}/${m[2]}`,
      key,
      chapter: num,
      volume: null,
      title: null,
      pages: 1, // unknown until opened; >0 marks it readable in-app
      externalUrl: null,
      readableAt: parseDate(text(li.querySelector('p.chapter_info'))),
      group: null,
    });
  }
  const n = (c: Chapter) => (c.chapter == null ? -1 : parseFloat(c.chapter));
  return [...out.values()].sort((a, b) => n(a) - n(b));
}

async function getChapterPages(chapterId: string): Promise<string[]> {
  const html = await getHtmlText(`${BASE}/manhwa/${chapterId}`, NAME);
  // The page lists its images as base64 text: var slides_p_path = ["aHR0…", …]
  const list = html.match(/slides_p_path\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
  const pages: string[] = [];
  for (const m of list.matchAll(/"([A-Za-z0-9+/=]+)"/g)) {
    try {
      const url = atob(m[1]);
      if (/^https?:\/\//.test(url)) pages.push(url);
    } catch {
      // skip a value that is not valid base64
    }
  }
  if (pages.length === 0) throw new Error('No pages found for this chapter.');
  return [...new Set(pages)];
}

export const manga18clubProvider: Provider = {
  id: 'manga18club',
  name: NAME,
  description: '18+ manhwa and manga from manga18.club (English). Only shown when "Show mature titles" is on.',
  iconUrl: `${BASE}/favicon.ico`,
  languages: [{ code: 'en', label: 'English' }],
  types: ['manga', 'manhwa', 'manhua'],
  sorts: ['relevance', 'followedCount', 'latestUploadedChapter'],
  adult: true,
  search,
  getManga,
  getChapters,
  getChapterPages,
};
