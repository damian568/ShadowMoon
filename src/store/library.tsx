import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';

import type { Chapter, ContentRating, Manga, MangaType } from '../providers/types';
import {
  DEFAULT_SETTINGS,
  reducer,
  type LibraryEntry,
  type MangaLite,
  type ReadingStatus,
  type Settings,
  type State,
  type UpdateResult,
} from './reducer';

export type { LibraryEntry, MangaLite, ReaderMode, ReadingStatus, Settings, UpdateResult } from './reducer';

const STORAGE_KEY = 'shadowmoon:state:v1';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface LibraryApi {
  state: State;
  toggleFavorite: (m: MangaLite) => void;
  setStatus: (m: MangaLite, status: ReadingStatus | null) => void;
  setRead: (m: MangaLite, keys: string[], read: boolean) => void;
  openChapter: (m: MangaLite, chapter: Chapter) => void;
  syncChapters: (m: MangaLite & { latestUploadedChapter?: string | null }, chapters: Chapter[]) => void;
  clearNew: (id?: string) => void;
  applyUpdates: (results: UpdateResult[]) => void;
  remove: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetLibrary: () => void;
}

const Ctx = createContext<LibraryApi | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    hydrated: false,
    entries: {},
    settings: DEFAULT_SETTINGS,
    lastUpdateCheck: null,
  });

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => dispatch({ type: 'hydrate', payload: raw ? JSON.parse(raw) : {} }))
      .catch(() => dispatch({ type: 'hydrate', payload: {} }));
  }, []);

  // Persist (debounced) after every change once loaded.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state.hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { hydrated, ...data } = state;
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
    }, 400);
  }, [state]);

  const api = useMemo<LibraryApi>(
    () => ({
      state,
      toggleFavorite: (manga) => dispatch({ type: 'toggleFavorite', manga }),
      setStatus: (manga, status) => dispatch({ type: 'setStatus', manga, status }),
      setRead: (manga, keys, read) => dispatch({ type: 'setRead', manga, keys, read }),
      openChapter: (manga, chapter) => dispatch({ type: 'openChapter', manga, chapter }),
      syncChapters: (manga, chapters) => dispatch({ type: 'syncChapters', manga, chapters }),
      clearNew: (id) => dispatch({ type: 'clearNew', id }),
      applyUpdates: (results) => dispatch({ type: 'applyUpdates', results, at: Date.now() }),
      remove: (id) => dispatch({ type: 'remove', id }),
      updateSettings: (patch) => dispatch({ type: 'settings', patch }),
      resetLibrary: () => dispatch({ type: 'reset' }),
    }),
    [state],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary must be used inside LibraryProvider');
  return v;
}

export function useEntry(id: string | undefined): LibraryEntry | undefined {
  const { state } = useLibrary();
  return id ? state.entries[id] : undefined;
}

export function useSettings() {
  const { state, updateSettings } = useLibrary();
  return [state.settings, updateSettings] as const;
}

export function contentRatings(settings: Settings): ContentRating[] {
  return settings.showMature ? ['safe', 'suggestive', 'erotica'] : ['safe', 'suggestive'];
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export const isInLibrary = (e: LibraryEntry | undefined): e is LibraryEntry => !!e && (e.favorite || e.status !== null);

export function progressOf(e: LibraryEntry | undefined, validKeys?: Set<string>) {
  if (!e) return { read: 0, total: 0, percent: 0 };
  const read = validKeys ? e.readChapters.filter((k) => validKeys.has(k)).length : e.readChapters.length;
  const total = validKeys ? validKeys.size : e.totalChapters;
  const percent = total > 0 ? Math.min(100, Math.round((read / total) * 100)) : 0;
  return { read: Math.min(read, total || read), total, percent };
}

export function toLite(m: Manga): MangaLite {
  return { id: m.id, title: m.title, coverUrl: m.coverUrl, type: m.type as MangaType, pubStatus: m.pubStatus };
}

export function useLibraryList(filter: 'all' | 'favorite' | ReadingStatus) {
  const { state } = useLibrary();
  return useMemo(() => {
    const list = Object.values(state.entries).filter(isInLibrary);
    if (filter === 'all') return list;
    if (filter === 'favorite') return list.filter((e) => e.favorite);
    return list.filter((e) => e.status === filter);
  }, [state.entries, filter]);
}

export function useTotalNew() {
  const { state } = useLibrary();
  return useMemo(
    () => Object.values(state.entries).reduce((n, e) => n + (isInLibrary(e) ? e.newChapters : 0), 0),
    [state.entries],
  );
}

/** A function with a permanent identity that always runs the latest `fn` (handy for effects and listeners). */
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Parameters<T>): ReturnType<T> => ref.current(...args), []) as T;
}
