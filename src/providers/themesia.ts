/**
 * Provider for sites running the "MangaReader" WordPress theme by Themesia
 * (kingofshojo.com, arenascan.com, and many others). They share one layout, so one parser serves all.
 *
 * The sites have no API, so this reads their public HTML pages. If a site changes its layout,
 * only this file needs updating.
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml, getHtmlText, imgUrl, parseReleaseDate, text } from './html';
import type { Chapter, ContentRating, Manga, MangaType, Page, Provider, SearchOptions, SortOrder } from './types';

export interface ThemesiaSite {
  id: string;
  name: string;
  description: string;
  /** Origin without trailing slash, e.g. "https://kingofshojo.com". */
  base: string;
  /** The site's own favicon URL. */
  iconUrl?: string;
  /** URL segment titles live under: "manga" (default) or e.g. "comics". */
  seriesPath?: string;
  /**
   * Set to false when the site's robots.txt disallows its search page. Searching then filters a list of every title
   * that is built (once, then cached) from the browse pages instead.
   */
  siteSearch?: boolean;
  /**
   * An 18+ site: every title counts as adult, so none of it shows unless "Show mature titles" is on
   * (even when a title is missing its adult tag).
   */
  adultOnly?: boolean;
}

const PAGE_SIZE = 20;
const INDEX_TTL = 15 * 60 * 1000;
const MAX_INDEX_PAGES = 60;

const ORDER: Partial<Record<SortOrder, string>> = {
  followedCount: 'popular',
  latestUploadedChapter: 'update',
  rating: 'rating',
  createdAt: 'latest',
};

function ratingFromTags(tags: string[]): ContentRating {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => ['adult', 'smut', 'hentai', 'sexual violence'].includes(x))) return 'pornographic';
  if (t.some((x) => ['mature', 'ecchi'].includes(x))) return 'suggestive';
  return 'safe';
}

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

const chapterNumber = (label: string): string | null => {
  const m = label.match(/(\d+(?:[.\-]\d+)?)/);
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

/** Field/value pairs from the title page. Sites differ: a table, ".imptdt" rows or ".fmed" blocks. */
function readInfo(doc: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string) => {
    const key = k.toLowerCase().replace(/[:\s]+$/g, '').trim();
    const val = v.replace(/\s+/g, ' ').trim();
    if (key && val && !/^n\/a$/i.test(val) && !(key in out)) out[key] = val;
  };
  for (const tr of doc.querySelectorAll('.infotable tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length >= 2) put(text(tds[0]), text(tds[1]));
  }
  for (const row of doc.querySelectorAll('.imptdt')) {
    const full = text(row);
    const value = text(row.querySelector('i, a'));
    if (value && full.endsWith(value)) put(full.slice(0, full.length - value.length), value);
  }
  for (const row of doc.querySelectorAll('.fmed')) {
    put(text(row.querySelector('b')), text(row.querySelector('span')));
  }
  // Some sites show the status as a badge: <div class="status"><i>Ongoing</i></div>
  put('status', text(doc.querySelector('.imptdt .status i, .status i')));
  return out;
}

function parseCard(card: HTMLElement, seriesPath: string): Manga | null {
  const a = card.querySelector(`a[href*="/${seriesPath}/"]`);
  const slug = a?.getAttribute('href')?.match(new RegExp(`/${seriesPath}/([^/?#]+)`))?.[1];
  if (!a || !slug) return null;
  const title = a.getAttribute('title')?.trim() || text(card.querySelector('.tt'));
  const m = blank(decodeURIComponent(slug), title, imgUrl(card.querySelector('img')));
  m.type = typeFrom(card.querySelector('.type')?.classNames.replace(/\btype\b/, ''));
  const ch = text(card.querySelector('.epxs'));
  if (ch) {
    m.lastChapter = chapterNumber(ch);
    m.latestUploadedChapter = ch;
  }
  return m;
}

export function createThemesiaProvider(site: ThemesiaSite): Provider {
  const { base, name } = site;
  const seriesPath = site.seriesPath ?? 'manga';
  const get = (url: string) => getHtml(url, name);
  const adult = (m: Manga): Manga => (site.adultOnly ? { ...m, contentRating: 'pornographic' } : m);

  // --- local search index, for sites that do not allow their own search page to be used ---
  let index: { at: number; items: Manga[] } | null = null;
  let indexLoading: Promise<Manga[]> | null = null;

  async function loadIndex(): Promise<Manga[]> {
    if (index && Date.now() - index.at < INDEX_TTL) return index.items;
    indexLoading ??= (async () => {
      const all = new Map<string, Manga>();
      for (let page = 1; page <= MAX_INDEX_PAGES; page++) {
        let doc: HTMLElement;
        try {
          doc = await get(`${base}/${seriesPath}/?page=${page}&order=popular`);
        } catch (e) {
          if (page === 1) throw e;
          break; // keep what we have
        }
        const cards = doc
          .querySelectorAll('.bsx')
          .map((card) => parseCard(card, seriesPath))
          .filter((m): m is Manga => !!m)
          .map(adult);
        for (const m of cards) if (!all.has(m.id)) all.set(m.id, m);
        if (cards.length === 0 || !doc.querySelector('a.next.page-numbers, .hpage a.r, a[rel="next"]')) break;
      }
      index = { at: Date.now(), items: [...all.values()] };
      return index.items;
    })().finally(() => {
      indexLoading = null;
    });
    return indexLoading;
  }

  async function searchLocal(title: string, opts: SearchOptions): Promise<Page<Manga>> {
    const offset = opts.offset ?? 0;
    const words = title.toLowerCase().split(/\s+/).filter(Boolean);
    let matches = (await loadIndex()).filter((m) => words.every((w) => m.title.toLowerCase().includes(w)));
    // Titles whose type is unknown are kept; the registry looks the real type up (see searchManga).
    if (opts.type && opts.type !== 'all') matches = matches.filter((m) => m.type === 'other' || m.type === opts.type);
    const allowed = new Set(opts.ratings);
    matches = matches.filter((m) => allowed.has(m.contentRating));
    return { items: matches.slice(offset, offset + PAGE_SIZE), total: matches.length, offset, limit: PAGE_SIZE };
  }

  async function search(opts: SearchOptions): Promise<Page<Manga>> {
    const offset = opts.offset ?? 0;
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const title = opts.title?.trim();
    if (title && site.siteSearch === false) return searchLocal(title, opts);

    // The listing can filter by type on the server (the value is capitalised: "Manhwa"). Search results can't.
    const typeFilter = opts.type && opts.type !== 'all' && opts.type !== 'other' ? opts.type : undefined;
    const url = title
      ? `${base}${page > 1 ? `/page/${page}/` : '/'}?s=${encodeURIComponent(title)}`
      : `${base}/${seriesPath}/?page=${page}&order=${ORDER[opts.order ?? 'followedCount'] ?? 'popular'}${
          typeFilter ? `&type=${typeFilter.charAt(0).toUpperCase()}${typeFilter.slice(1)}` : ''
        }`;
    const doc = await get(url);

    let items = doc
      .querySelectorAll('.bsx')
      .map((card) => parseCard(card, seriesPath))
      .filter((m): m is Manga => !!m)
      .map(adult);
    if (typeFilter && !title) {
      // The server already filtered, so cards that don't show their type are of the requested type.
      items = items.map((m) => (m.type === 'other' ? { ...m, type: typeFilter } : m));
    }
    // Titles whose type is still unknown are kept here; the registry looks the real type up (see searchManga).
    if (opts.type && opts.type !== 'all') items = items.filter((m) => m.type === 'other' || m.type === opts.type);
    // Cards carry no rating, so only an adult-only site can be told apart here; its titles need the mature setting.
    const allowed = new Set(opts.ratings);
    items = items.filter((m) => allowed.has(m.contentRating));

    const hasNext = !!doc.querySelector('a.next.page-numbers, .hpage a.r, a[rel="next"]');
    const loaded = offset + items.length;
    return { items, total: hasNext ? loaded + PAGE_SIZE : loaded, offset, limit: PAGE_SIZE };
  }

  async function getManga(id: string): Promise<Manga> {
    const doc = await get(`${base}/${seriesPath}/${encodeURIComponent(id)}/`);
    const title = text(doc.querySelector('h1.entry-title')) || text(doc.querySelector('h1'));
    if (!title) throw new Error(`Could not read this title from ${name}.`);
    const m = blank(id, title, imgUrl(doc.querySelector('.thumb img')));
    m.altTitle = text(doc.querySelector('.alternative')) || undefined;

    const info = readInfo(doc);
    m.altTitle = m.altTitle || info['alternative'];
    m.tags = [...new Set(doc.querySelectorAll('.mgen a, .seriestugenre a').map((a) => text(a)).filter(Boolean))];
    m.type = typeFrom(info['type'] ?? m.tags.find((t) => typeFrom(t) !== 'other'));
    m.pubStatus = statusFrom(info['status']);
    m.contentRating = site.adultOnly ? 'pornographic' : ratingFromTags(m.tags);
    const year = parseInt(info['released'] ?? '', 10);
    m.year = Number.isFinite(year) ? year : null;
    m.authors = [...new Set([info['author'], info['artist']].filter((x): x is string => !!x).flatMap((x) => x.split(/[,;/]/).map((s) => s.trim()).filter(Boolean)))];

    const desc = doc.querySelector('.entry-content-single, [itemprop="description"]');
    if (desc) {
      const lines = desc.innerHTML
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#8217;|&rsquo;/g, '’')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#?\w+;/g, ' ')
        .split('\n')
        .map((l) => l.trim());
      // Sites open with a "Read manhwa <title> / <alt titles>" line that is not part of the synopsis.
      if (lines[0] && /^read (manga|manhwa|manhua|webtoon|comic)\b/i.test(lines[0])) lines.shift();
      m.description = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    const first = doc.querySelector('#chapterlist li .chapternum, li[data-num] .chapternum');
    if (first) {
      m.lastChapter = chapterNumber(text(first));
      m.latestUploadedChapter = text(first);
    }
    return m;
  }

  async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
    const seriesUrl = `${base}/${seriesPath}/${encodeURIComponent(manga.id)}/`;
    const doc = await get(seriesUrl);
    const out = new Map<string, Chapter>();
    for (const li of doc.querySelectorAll('li[data-num]')) {
      const a = li.querySelector('a');
      const href = a?.getAttribute('href') ?? '';
      const path = href.replace(/^https?:\/\/[^/]+\//, '').replace(/\/+$/, '');
      // Paid chapters have no link: the site opens a "buy with coins" dialog instead. They can't be read
      // in-app, so list them as locked and send the reader to the series page.
      const locked = !!a && !path && (a.getAttribute('data-bs-target') ?? '').includes('locked');
      if (!a || (!path && !locked)) continue;
      const label = text(li.querySelector('.chapternum')) || a.getAttribute('data-title') || text(a);
      const num = chapterNumber(li.getAttribute('data-num') ?? '') ?? chapterNumber(label);
      const key = num ?? `id:${path || a.getAttribute('data-id')}`;
      if (out.has(key)) continue;
      const subtitle = label.replace(/^\s*(chapter|ch\.?)\s*[\d.\-]+\s*[-–:]?\s*/i, '').trim();
      out.set(key, {
        id: path || `locked/${key}`,
        key,
        chapter: num,
        volume: null,
        title: subtitle && subtitle.toLowerCase() !== label.toLowerCase() ? subtitle : null,
        pages: 1, // unknown until opened; >0 marks it readable in-app
        externalUrl: locked ? seriesUrl : null,
        readableAt: parseReleaseDate(text(li.querySelector('.chapterdate'))),
        group: null,
      });
    }
    const n = (c: Chapter) => (c.chapter == null ? -1 : parseFloat(c.chapter));
    return [...out.values()].sort((a, b) => n(a) - n(b));
  }

  async function getChapterPages(chapterId: string): Promise<string[]> {
    const html = await getHtmlText(`${base}/${chapterId}/`, name);
    // The reader config is embedded as JSON: ts_reader.run({... "sources":[{"images":[...]}] ...});
    const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
    if (m) {
      try {
        const cfg = JSON.parse(m[1]) as { sources?: { images?: string[] }[] };
        const images = cfg.sources?.find((s) => s.images?.length)?.images;
        if (images?.length) return images;
      } catch {}
    }
    // Fallback: plain <img> tags in the reading area.
    const urls = [...html.matchAll(/<img[^>]+(?:data-src|src)="([^"]+)"[^>]*class="[^"]*ts-main-image[^"]*"/g)].map((x) => x[1]);
    if (urls.length === 0) throw new Error('No pages found for this chapter. It may be locked (paid) on the website.');
    return urls;
  }

  return {
    id: site.id,
    name,
    description: site.description,
    iconUrl: site.iconUrl,
    languages: [{ code: 'en', label: 'English' }],
    types: ['manga', 'manhwa', 'manhua'],
    sorts: ['relevance', 'followedCount', 'latestUploadedChapter', 'rating', 'createdAt'],
    adult: site.adultOnly,
    search,
    getManga,
    getChapters,
    getChapterPages,
  };
}

export const kingofshojoProvider = createThemesiaProvider({
  id: 'kingofshojo',
  name: 'King of Shojo',
  description: 'Shoujo and romance manhwa from kingofshojo.com (English). Parsed from the website.',
  base: 'https://kingofshojo.com',
  iconUrl: 'https://i1.wp.com/kingofshojo.com/wp-content/uploads/2024/03/cropped-adawewtyy-192x192.png',
});

export const thunderscansProvider = createThemesiaProvider({
  id: 'thunderscans',
  name: 'Thunder Scans',
  description: 'Manhua and manhwa from en-thunderscans.com (English). Newest chapters can be paid (coins) on the site.',
  base: 'https://en-thunderscans.com',
  seriesPath: 'comics',
  iconUrl: 'https://en-thunderscans.com/wp-content/uploads/2023/12/cropped-EN-TH-WEB-192x192.png',
});

export const rokariProvider = createThemesiaProvider({
  id: 'rokari',
  name: 'Rokari Comics',
  description: 'Manhwa, manhua and manga from rokaricomics.com (English). Search uses a cached list of the whole site.',
  base: 'https://rokaricomics.com',
  siteSearch: false, // robots.txt disallows /?s= and /search/
  iconUrl: 'https://rokaricomics.com/wp-content/uploads/2025/06/cropped-Untitled_Artwork-2-192x192.png',
});

export const hentai20Provider = createThemesiaProvider({
  id: 'hentai20',
  name: 'Hentai20',
  description: '18+ manhwa from hentai20.io (English). Only shown when "Show mature titles" is on.',
  base: 'https://hentai20.io',
  adultOnly: true,
  iconUrl: 'https://hentai20.io/wp-content/uploads/2024/05/cropped-210da20ddb1be20edd43583bcaf1061f628cbc16-300x300.jpg',
});

export const arenascanProvider =createThemesiaProvider({
  id: 'arenascan',
  name: 'Arena Scans',
  description: 'Manhwa and manhua from arenascan.com (English). Parsed from the website.',
  base: 'https://arenascan.com',
  iconUrl: 'https://arenascan.com/wp-content/uploads/2024/05/37353d5b-214e-4d1d-acef-265067ef0c8e_c03f4d14-ddbc-48ff-b7cb-b19366af81b4.png',
});
