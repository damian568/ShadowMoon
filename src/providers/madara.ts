/**
 * Provider for sites running the standard WordPress "Madara" manga theme (mangaread.org, manhuaplus.com, …).
 * They share one layout, so one parser serves all.
 *
 * The sites have no API, so this reads their public HTML pages. For personal use. Requests are throttled and the
 * parser is deliberately tolerant: if a site changes its layout, only this file needs to be updated.
 * Only sites whose chapter list is part of the title page work here (some Madara sites load it with a private
 * data request, which this provider does not call).
 */
import type { HTMLElement } from 'node-html-parser';

import { getHtml as fetchHtml } from './html';
import type {
  Chapter,
  ContentRating,
  Language,
  Manga,
  MangaType,
  Page,
  Provider,
  SearchOptions,
  SortOrder,
} from './types';

export interface MadaraSite {
  id: string;
  name: string;
  description: string;
  /** Origin without trailing slash, e.g. "https://www.mangaread.org". */
  base: string;
  iconUrl?: string;
}

const PAGE_SIZE = 12; // the sites show 12 titles per page

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const text = (el: HTMLElement | null | undefined) => (el ? el.text.replace(/\s+/g, ' ').trim() : '');

/** "https://www.mangaread.org/manga/some-title/chapter-5/" -> "some-title" */
function slugFromUrl(url: string | undefined): string | null {
  const m = url?.match(/\/manga\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function imgUrl(img: HTMLElement | null | undefined): string {
  if (!img) return '';
  const raw =
    img.getAttribute('data-src') ||
    img.getAttribute('data-lazy-src') ||
    img.getAttribute('src') ||
    (img.getAttribute('srcset') ?? '').split(/\s+/)[0] ||
    '';
  const url = raw.trim();
  if (!url || url.startsWith('data:')) return '';
  return url.startsWith('//') ? `https:${url}` : url;
}

/** Upgrade "…-193x278.jpg" thumbnails to the full-size file. */
const fullSize = (url: string) => url.replace(/-\d+x\d+(\.\w+)$/, '$1');

function ratingFromTags(tags: string[]): ContentRating {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => ['adult', 'smut', 'hentai', 'mature', 'sexual violence'].includes(x))) return 'pornographic';
  if (t.some((x) => x === 'ecchi')) return 'suggestive';
  return 'safe';
}

function typeFrom(label: string | undefined, tags: string[]): MangaType {
  const v = (label ?? '').toLowerCase();
  const all = [v, ...tags.map((t) => t.toLowerCase())];
  if (all.some((x) => x.includes('manhwa'))) return 'manhwa';
  if (all.some((x) => x.includes('manhua'))) return 'manhua';
  if (all.some((x) => x.includes('manga'))) return 'manga';
  return 'other';
}

function statusFrom(label: string | undefined): string {
  const v = (label ?? '').toLowerCase();
  if (v.includes('ongoing')) return 'ongoing';
  if (v.includes('complete')) return 'completed';
  if (v.includes('hiatus')) return 'hiatus';
  if (v.includes('cancel')) return 'cancelled';
  return 'unknown';
}

/** Read the "Label / value" rows of a title block into a map keyed by lower-case label. */
function readFields(root: HTMLElement): Record<string, HTMLElement> {
  const out: Record<string, HTMLElement> = {};
  for (const item of root.querySelectorAll('.post-content_item')) {
    const label = text(item.querySelector('.summary-heading')).toLowerCase().replace(/\(s\)/, 's');
    const value = item.querySelector('.summary-content');
    if (label && value) out[label] = value;
  }
  return out;
}

const links = (el: HTMLElement | undefined) => (el ? el.querySelectorAll('a').map((a) => text(a)).filter(Boolean) : []);
const splitList = (el: HTMLElement | undefined) =>
  text(el)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

function baseManga(slug: string, title: string, cover: string): Manga {
  return {
    id: slug,
    title,
    description: '',
    coverUrl: cover,
    coverUrlLarge: fullSize(cover),
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

/** Last chapter shown on a card: "Chapter 25" -> "25". */
const chapterNumber = (label: string): string | null => {
  const m = label.match(/(\d+(?:[.\-]\d+)?)/);
  return m ? m[1].replace('-', '.') : null;
};

// ---------------------------------------------------------------------------
// Card parsers (search results and listing pages have different markup)
// ---------------------------------------------------------------------------

function parseSearchCard(card: HTMLElement): Manga | null {
  const a = card.querySelector('.post-title a') ?? card.querySelector('a[href*="/manga/"]');
  const slug = slugFromUrl(a?.getAttribute('href'));
  if (!a || !slug) return null;
  const m = baseManga(slug, text(a), imgUrl(card.querySelector('img')));
  const f = readFields(card);
  m.altTitle = text(f['alternative']) || undefined;
  m.authors = splitList(f['authors']);
  m.tags = links(f['genres']);
  m.type = typeFrom(text(f['type']), m.tags);
  m.pubStatus = statusFrom(text(f['status']));
  m.contentRating = ratingFromTags(m.tags);
  const latest = card.querySelector('.latest-chap a, .chapter a');
  if (latest) {
    m.lastChapter = chapterNumber(text(latest));
    m.latestUploadedChapter = text(latest);
  }
  return m;
}

function parseListCard(card: HTMLElement): Manga | null {
  const a = card.querySelector('.post-title a') ?? card.querySelector('a[href*="/manga/"]');
  const slug = slugFromUrl(a?.getAttribute('href'));
  if (!a || !slug) return null;
  const m = baseManga(slug, text(a), imgUrl(card.querySelector('img')));
  const latest = card.querySelector('.chapter-item .chapter a, .list-chapter a');
  if (latest) {
    m.lastChapter = chapterNumber(text(latest));
    m.latestUploadedChapter = text(latest);
  }
  return m;
}

const LANGUAGES: Language[] = [{ code: 'en', label: 'English' }];

export function createMadaraProvider(site: MadaraSite): Provider {
  const getHtml = (url: string) => fetchHtml(url, site.name);

  // ---------------------------------------------------------------------------
  // Provider implementation
  // ---------------------------------------------------------------------------

  const ORDER: Partial<Record<SortOrder, string>> = {
    followedCount: 'views',
    latestUploadedChapter: 'latest',
    rating: 'rating',
    createdAt: 'new-manga',
  };

  async function search(opts: SearchOptions): Promise<Page<Manga>> {
    const offset = opts.offset ?? 0;
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const title = opts.title?.trim();

    let doc: HTMLElement;
    let items: Manga[];
    if (title) {
      const path = page > 1 ? `/page/${page}/` : '/';
      doc = await getHtml(`${site.base}${path}?s=${encodeURIComponent(title)}&post_type=wp-manga`);
      items = doc.querySelectorAll('.c-tabs-item__content').map(parseSearchCard).filter((m): m is Manga => !!m);
    } else {
      const orderby = ORDER[opts.order ?? 'followedCount'] ?? 'views';
      // With a type chosen, browse the site's genre page for it (/genres/manhwa/): the site does the filtering.
      const typeFilter = opts.type && opts.type !== 'all' && opts.type !== 'other' ? opts.type : undefined;
      const root = typeFilter ? `/genres/${typeFilter}` : '/manga';
      const path = page > 1 ? `${root}/page/${page}/` : `${root}/`;
      doc = await getHtml(`${site.base}${path}?m_orderby=${orderby}`);
      items = doc.querySelectorAll('.page-item-detail').map(parseListCard).filter((m): m is Manga => !!m);
      if (typeFilter) items = items.map((m) => ({ ...m, type: typeFilter }));
    }

    // The site has no age ratings; filter on genres where we know them (search results list them).
    const allowed = new Set(opts.ratings);
    const filtered = items.filter((m) => allowed.has(m.contentRating));
    if (opts.type && opts.type !== 'all') {
      // Only filter on types we could detect; unknown ones stay visible.
      items = filtered.filter((m) => m.type === 'other' || m.type === opts.type);
    } else {
      items = filtered;
    }

    const hasNext = !!doc.querySelector('a.nextpostslink, .nav-previous a, a.next.page-numbers, a[rel="next"]') || (items.length >= PAGE_SIZE && !title);
    const loaded = offset + items.length;
    return { items, total: hasNext ? loaded + PAGE_SIZE : loaded, offset, limit: PAGE_SIZE };
  }

  async function getManga(id: string): Promise<Manga> {
    const doc = await getHtml(`${site.base}/manga/${encodeURIComponent(id)}/`);
    const title = text(doc.querySelector('.post-title h1')) || text(doc.querySelector('h1'));
    if (!title) throw new Error(`Could not read this title from ${site.name}.`);
    const cover = imgUrl(doc.querySelector('.summary_image img'));
    const m = baseManga(id, title, cover);

    const f = readFields(doc);
    m.altTitle = text(f['alternative']) || undefined;
    m.authors = [...new Set([...splitList(f['authors']), ...splitList(f['artists'])])];
    m.tags = links(f['genres']);
    m.type = typeFrom(text(f['type']), m.tags);
    m.pubStatus = statusFrom(text(f['status']));
    m.contentRating = ratingFromTags(m.tags);
    const year = parseInt(text(f['release']) || text(f['release date']) || text(f['released']), 10);
    m.year = Number.isFinite(year) ? year : null;

    const desc = doc.querySelector('.summary__content');
    m.description = desc
      ? desc.querySelectorAll('p').map((p) => text(p)).filter(Boolean).join('\n\n') || text(desc)
      : '';
    // Drop the "A brief description of the manhua X:" header line some entries start with.
    m.description = m.description.replace(/^A brief description of[^:]*:\s*/i, '');

    const first = doc.querySelector('li.wp-manga-chapter a');
    if (first) {
      m.lastChapter = chapterNumber(text(first));
      m.latestUploadedChapter = text(first);
    }
    return m;
  }

  /** "5 mins ago" / "2 days ago" / "March 3, 2024" -> ISO string (falls back to now). */
  function parseReleaseDate(raw: string): string {
    const s = raw.trim().toLowerCase();
    const rel = s.match(/(\d+)\s*(sec|min|hour|day|week|month|year)/);
    if (rel) {
      const n = Number(rel[1]);
      const unit: Record<string, number> = {
        sec: 1e3,
        min: 6e4,
        hour: 36e5,
        day: 864e5,
        week: 6048e5,
        month: 2592e6,
        year: 31536e6,
      };
      return new Date(Date.now() - n * unit[rel[2]]).toISOString();
    }
    if (s.includes('yesterday')) return new Date(Date.now() - 864e5).toISOString();
    const t = Date.parse(raw);
    return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
  }

  async function getChapters(manga: Pick<Manga, 'id'>): Promise<Chapter[]> {
    const doc = await getHtml(`${site.base}/manga/${encodeURIComponent(manga.id)}/`);
    const out = new Map<string, Chapter>();
    for (const li of doc.querySelectorAll('li.wp-manga-chapter')) {
      const a = li.querySelector('a');
      const href = a?.getAttribute('href') ?? '';
      const m = href.match(/\/manga\/([^/]+)\/([^/?#]+)/);
      if (!a || !m) continue;
      const label = text(a);
      const num = chapterNumber(label) ?? chapterNumber(m[2].replace('chapter-', ''));
      const key = num ?? `id:${m[2]}`;
      if (out.has(key)) continue;
      const subtitle = label.replace(/^\s*(chapter|ch\.?)\s*[\d.\-]+\s*[-–:]?\s*/i, '').trim();
      out.set(key, {
        id: `${decodeURIComponent(m[1])}/${m[2]}`,
        key,
        chapter: num,
        volume: null,
        title: subtitle && subtitle.toLowerCase() !== label.toLowerCase() ? subtitle : null,
        pages: 1, // unknown until opened; >0 marks it readable in-app
        externalUrl: null,
        readableAt: parseReleaseDate(text(li.querySelector('.chapter-release-date'))),
        group: null,
      });
    }
    const num = (c: Chapter) => (c.chapter == null ? -1 : parseFloat(c.chapter));
    return [...out.values()].sort((a, b) => num(a) - num(b));
  }

  async function getChapterPages(chapterId: string): Promise<string[]> {
    const doc = await getHtml(`${site.base}/manga/${chapterId}/`);
    const pages = doc
      .querySelectorAll('img.wp-manga-chapter-img, .reading-content img')
      .map(imgUrl)
      .filter(Boolean);
    if (pages.length === 0) throw new Error('No pages found for this chapter.');
    return [...new Set(pages)];
  }



  return {
    id: site.id,
    name: site.name,
    description: site.description,
    iconUrl: site.iconUrl,
    languages: LANGUAGES,
    types: ['manga', 'manhwa', 'manhua'],
    sorts: ['relevance', 'followedCount', 'latestUploadedChapter', 'rating', 'createdAt'],
    search,
    getManga,
    getChapters,
    getChapterPages,
  };
}
