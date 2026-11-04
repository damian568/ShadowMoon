import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getChapters, getMangaByIds, primeChapterCache } from '../providers';
import { isInLibrary, toLite, useLibrary, useStableCallback, type UpdateResult } from './library';

interface UpdatesApi {
  checking: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  checkNow: () => Promise<void>;
}

const Ctx = createContext<UpdatesApi | null>(null);

/**
 * Checks MangaDex for new chapters of everything in the library.
 * 1. One batched request (100 titles each) returns `latestUploadedChapter` for every title.
 * 2. Only titles where that changed get their chapter list re-fetched.
 * Runs on launch and whenever the app returns to the foreground (if the last check is stale).
 */
export function UpdatesProvider({ children }: { children: React.ReactNode }) {
  const { state, applyUpdates } = useLibrary();
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<UpdatesApi['progress']>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const checkNow = useStableCallback(async () => {
    if (running.current) return;
    const tracked = Object.values(state.entries).filter(isInLibrary);
    const language = state.settings.language;
    running.current = true;
    setChecking(true);
    setError(null);
    const results: UpdateResult[] = [];
    try {
      const ids = tracked.map((e) => e.id);
      const toRefresh: { manga: Awaited<ReturnType<typeof getMangaByIds>>[number]; result: UpdateResult }[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const mangas = await getMangaByIds(ids.slice(i, i + 100));
        for (const m of mangas) {
          const e = state.entries[m.id];
          const result: UpdateResult = { id: m.id, meta: toLite(m), latestUploadedChapter: m.latestUploadedChapter };
          results.push(result);
          if (!e.syncedAt || (e.latestUploadedChapter ?? null) !== (m.latestUploadedChapter ?? null)) {
            toRefresh.push({ manga: m, result });
          }
        }
      }
      setProgress({ done: 0, total: toRefresh.length });
      for (let i = 0; i < toRefresh.length; i++) {
        const { manga, result } = toRefresh[i];
        try {
          const chapters = await getChapters(manga, language);
          primeChapterCache(manga.id, language, chapters);
          const last = chapters[chapters.length - 1];
          result.totalChapters = chapters.length;
          result.latestChapterLabel = last ? (last.chapter ? `Ch. ${last.chapter}` : 'Oneshot') : undefined;
          result.latestChapterAt = last?.readableAt;
        } catch {
          // Leave latestUploadedChapter unchanged so it is retried next time.
          result.latestUploadedChapter = state.entries[manga.id]?.latestUploadedChapter ?? null;
        }
        setProgress({ done: i + 1, total: toRefresh.length });
      }
      applyUpdates(results);
    } catch (e: any) {
      if (results.length) applyUpdates(results);
      setError(e?.message ?? 'Could not check for updates');
    } finally {
      running.current = false;
      setChecking(false);
      setProgress(null);
    }
  });

  // Automatic checks: after loading, and when coming back to the app.
  const maybeAutoCheck = useStableCallback(() => {
    if (!state.hydrated) return;
    const staleMs = state.settings.autoUpdateMinutes * 60 * 1000;
    if (staleMs <= 0) return;
    if (!state.lastUpdateCheck || Date.now() - state.lastUpdateCheck > staleMs) checkNow();
  });

  useEffect(() => {
    if (state.hydrated) maybeAutoCheck();
  }, [state.hydrated, maybeAutoCheck]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && maybeAutoCheck());
    return () => sub.remove();
  }, [maybeAutoCheck]);

  return <Ctx.Provider value={{ checking, progress, error, checkNow }}>{children}</Ctx.Provider>;
}

export function useUpdates(): UpdatesApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUpdates must be used inside UpdatesProvider');
  return v;
}
