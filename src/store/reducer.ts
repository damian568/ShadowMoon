import type { Chapter, Manga, MangaType } from '../providers/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReadingStatus = 'reading' | 'completed' | 'later';
export type ReaderMode = 'auto' | 'vertical' | 'paged';

/** Minimal manga info we keep on the device so the library works offline. */
export type MangaLite = Pick<Manga, 'id' | 'title' | 'coverUrl' | 'type'> & { pubStatus?: string };

export interface LibraryEntry extends MangaLite {
  favorite: boolean;
  status: ReadingStatus | null;
  /** Chapter keys (see Chapter.key) the user has read. */
  readChapters: string[];
  /** Number of unique chapters available in the chosen language. 0 = unknown yet. */
  totalChapters: number;
  latestChapterLabel?: string;
  latestChapterAt?: string;
  /** MangaDex's latestUploadedChapter id — cheap change detection for updates. */
  latestUploadedChapter?: string | null;
  /** New chapters found by the update checker that the user hasn't looked at yet. */
  newChapters: number;
  lastUpdateFoundAt?: number;
  lastChapterId?: string;
  lastChapterKey?: string;
  lastChapterLabel?: string;
  lastReadAt?: number;
  addedAt: number;
  syncedAt?: number;
}

export interface Settings {
  /** Which content source Discover and Search use (see src/providers). */
  provider: string;
  language: string;
  dataSaver: boolean;
  readerMode: ReaderMode;
  showMature: boolean;
  autoUpdateMinutes: number;
}

export interface State {
  hydrated: boolean;
  entries: Record<string, LibraryEntry>;
  settings: Settings;
  lastUpdateCheck: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'mangadex',
  language: 'en',
  dataSaver: false,
  readerMode: 'auto',
  showMature: false,
  autoUpdateMinutes: 30,
};


// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export interface UpdateResult {
  id: string;
  meta?: Partial<MangaLite>;
  latestUploadedChapter: string | null;
  totalChapters?: number;
  latestChapterLabel?: string;
  latestChapterAt?: string;
}

export type Action =
  | { type: 'hydrate'; payload: Partial<State> }
  | { type: 'toggleFavorite'; manga: MangaLite }
  | { type: 'setStatus'; manga: MangaLite; status: ReadingStatus | null }
  | { type: 'setRead'; manga: MangaLite; keys: string[]; read: boolean }
  | { type: 'openChapter'; manga: MangaLite; chapter: Chapter }
  | { type: 'syncChapters'; manga: MangaLite & { latestUploadedChapter?: string | null }; chapters: Chapter[] }
  | { type: 'clearNew'; id?: string }
  | { type: 'applyUpdates'; results: UpdateResult[]; at: number }
  | { type: 'remove'; id: string }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'reset' };

function blankEntry(m: MangaLite): LibraryEntry {
  return {
    id: m.id,
    title: m.title,
    coverUrl: m.coverUrl,
    type: m.type,
    pubStatus: m.pubStatus,
    favorite: false,
    status: null,
    readChapters: [],
    totalChapters: 0,
    newChapters: 0,
    addedAt: Date.now(),
  };
}

function withEntry(state: State, m: MangaLite, fn: (e: LibraryEntry) => LibraryEntry): State {
  const prev = state.entries[m.id] ?? blankEntry(m);
  // Refresh basic metadata whenever we touch an entry.
  const merged: LibraryEntry = {
    ...prev,
    title: m.title || prev.title,
    coverUrl: m.coverUrl || prev.coverUrl,
    type: m.type || prev.type,
    pubStatus: m.pubStatus ?? prev.pubStatus,
  };
  return { ...state, entries: { ...state.entries, [m.id]: fn(merged) } };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        ...action.payload,
        settings: { ...DEFAULT_SETTINGS, ...(action.payload.settings ?? {}) },
        hydrated: true,
      };

    case 'toggleFavorite':
      return withEntry(state, action.manga, (e) => ({ ...e, favorite: !e.favorite }));

    case 'setStatus':
      return withEntry(state, action.manga, (e) => ({ ...e, status: action.status }));

    case 'setRead':
      return withEntry(state, action.manga, (e) => {
        const set = new Set(e.readChapters);
        for (const k of action.keys) (action.read ? set.add(k) : set.delete(k));
        // Every known chapter read -> the title is Done. Un-reading one moves it back to Reading.
        const finished = e.totalChapters > 0 && set.size >= e.totalChapters;
        let status = e.status;
        if (action.read) {
          if (finished) status = 'completed';
          else if (status === null || status === 'later') status = 'reading';
        } else if (status === 'completed' && !finished) {
          status = 'reading';
        }
        return { ...e, readChapters: [...set], status };
      });

    case 'openChapter':
      return withEntry(state, action.manga, (e) => ({
        ...e,
        status: e.status === null || e.status === 'later' ? 'reading' : e.status,
        lastChapterId: action.chapter.id,
        lastChapterKey: action.chapter.key,
        lastChapterLabel: action.chapter.chapter ? `Ch. ${action.chapter.chapter}` : 'Oneshot',
        lastReadAt: Date.now(),
      }));

    case 'syncChapters': {
      const existing = state.entries[action.manga.id];
      if (!existing) return state; // only track things that are in the library
      const last = action.chapters[action.chapters.length - 1];
      return withEntry(state, action.manga, (e) => ({
        ...e,
        // Opening a Done title and finding more chapters than before means there is more to read.
        status: e.status === 'completed' && e.totalChapters > 0 && action.chapters.length > e.totalChapters ? 'reading' : e.status,
        totalChapters: action.chapters.length,
        latestChapterLabel: last ? (last.chapter ? `Ch. ${last.chapter}` : 'Oneshot') : e.latestChapterLabel,
        latestChapterAt: last?.readableAt ?? e.latestChapterAt,
        latestUploadedChapter:
          action.manga.latestUploadedChapter !== undefined ? action.manga.latestUploadedChapter : e.latestUploadedChapter,
        newChapters: 0,
        syncedAt: Date.now(),
      }));
    }

    case 'clearNew': {
      const entries = { ...state.entries };
      for (const id of action.id ? [action.id] : Object.keys(entries)) {
        if (entries[id]?.newChapters) entries[id] = { ...entries[id], newChapters: 0 };
      }
      return { ...state, entries };
    }

    case 'applyUpdates': {
      const entries = { ...state.entries };
      for (const r of action.results) {
        const e = entries[r.id];
        if (!e) continue;
        const next: LibraryEntry = { ...e, ...(r.meta ?? {}), latestUploadedChapter: r.latestUploadedChapter };
        if (r.totalChapters !== undefined) {
          const delta = e.syncedAt ? Math.max(0, r.totalChapters - e.totalChapters) : 0;
          next.totalChapters = r.totalChapters;
          next.latestChapterLabel = r.latestChapterLabel ?? e.latestChapterLabel;
          next.latestChapterAt = r.latestChapterAt ?? e.latestChapterAt;
          next.syncedAt = action.at;
          if (delta > 0) {
            next.newChapters = e.newChapters + delta;
            next.lastUpdateFoundAt = action.at;
            // New chapters appeared, so a Done title has more to read again.
            if (e.status === 'completed') next.status = 'reading';
          }
        }
        entries[r.id] = next;
      }
      return { ...state, entries, lastUpdateCheck: action.at };
    }

    case 'remove': {
      const e = state.entries[action.id];
      if (!e) return state;
      return { ...state, entries: { ...state.entries, [action.id]: { ...e, favorite: false, status: null } } };
    }

    case 'settings': {
      const settings = { ...state.settings, ...action.patch };
      if (settings.language === state.settings.language) return { ...state, settings };
      // Chapter counts differ per language: force a clean re-sync without "new chapter" noise.
      const entries: Record<string, LibraryEntry> = {};
      for (const [id, e] of Object.entries(state.entries)) {
        entries[id] = { ...e, syncedAt: undefined, latestUploadedChapter: undefined, newChapters: 0 };
      }
      return { ...state, settings, entries, lastUpdateCheck: null };
    }

    case 'reset':
      return { ...state, entries: {}, lastUpdateCheck: null };
  }
}

