/**
 * The contract every content source ("provider") implements.
 * The UI only ever talks to providers through `src/providers/index.ts`,
 * so adding a source never requires touching screens.
 */

export type MangaType = 'manga' | 'manhwa' | 'manhua' | 'other';
export type ContentRating = 'safe' | 'suggestive' | 'erotica' | 'pornographic';
export type SortOrder = 'relevance' | 'followedCount' | 'latestUploadedChapter' | 'rating' | 'createdAt';

export interface Manga {
  /** Provider-local id when returned by a provider; app-wide id after passing through the registry. */
  id: string;
  title: string;
  altTitle?: string;
  description: string;
  coverUrl: string;
  coverUrlLarge: string;
  type: MangaType;
  originalLanguage: string;
  pubStatus: string;
  year: number | null;
  contentRating: ContentRating;
  tags: string[];
  authors: string[];
  lastChapter: string | null;
  /** Any value that changes whenever a new chapter is uploaded (cheap change detection). */
  latestUploadedChapter: string | null;
  availableLanguages: string[];
  chapterNumbersResetOnNewVolume: boolean;
}

export interface Chapter {
  /** Provider-local chapter id (passed back to `getChapterPages`). */
  id: string;
  /** Stable identifier used for read-progress tracking (independent of the uploader). */
  key: string;
  chapter: string | null;
  volume: string | null;
  title: string | null;
  pages: number;
  /** Set when the chapter can only be read on an external (official) site. */
  externalUrl: string | null;
  readableAt: string;
  group: string | null;
}

export interface MangaStats {
  rating: number | null;
  follows: number | null;
}

export interface SearchOptions {
  title?: string;
  type?: MangaType | 'all';
  order?: SortOrder;
  limit?: number;
  offset?: number;
  language: string;
  ratings: ContentRating[];
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface Language {
  code: string;
  label: string;
}

export interface Provider {
  /** Short, stable, lowercase id, e.g. "mangadex". Used as the id prefix for non-default providers. */
  id: string;
  name: string;
  description: string;
  /** The website's own icon (favicon). Optional: the UI falls back to a letter badge. */
  iconUrl?: string;
  /** Chapter languages this source offers. */
  languages: Language[];
  /** Which type filters the source can apply (the UI hides the others). */
  types: MangaType[];
  /** Which sort orders the source supports (the UI hides the others). */
  sorts: SortOrder[];

  search(opts: SearchOptions): Promise<Page<Manga>>;
  getManga(id: string): Promise<Manga>;
  /** Optional batch lookup used by the update checker; falls back to `getManga` per title. */
  getMangaByIds?(ids: string[]): Promise<Manga[]>;
  /** All chapters in one language, de-duplicated and sorted ascending. */
  getChapters(manga: Manga, language: string): Promise<Chapter[]>;
  /** Image URLs for one chapter, in reading order. */
  getChapterPages(chapterId: string, dataSaver: boolean): Promise<string[]>;
  getStats?(id: string): Promise<MangaStats>;
}

// ---------------------------------------------------------------------------
// Small helpers shared by providers and screens
// ---------------------------------------------------------------------------

/** A chapter can be read in-app only if it has real pages and is not an external link. */
export const isReadable = (c: Pick<Chapter, 'externalUrl' | 'pages'>) => !c.externalUrl && c.pages > 0;

export function chapterLabel(c: Pick<Chapter, 'chapter' | 'volume' | 'title'>, withTitle = false): string {
  const base = c.chapter ? `Chapter ${c.chapter}` : c.title || 'Oneshot';
  if (withTitle && c.chapter && c.title) return `${base} · ${c.title}`;
  return base;
}

export function shortChapterLabel(c: Pick<Chapter, 'chapter' | 'title'>): string {
  return c.chapter ? `Ch. ${c.chapter}` : 'Oneshot';
}
