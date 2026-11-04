/**
 * Keeps the library in step with the signed-in account's cloud copy (see src/sync/merge.ts for the rules).
 *
 * - On sign-in, and when the app comes back to the foreground, the cloud library is downloaded and merged into
 *   the one on this phone.
 * - A few seconds after the library changes, whatever differs from the cloud is uploaded.
 * - Nothing is uploaded until the first download has been merged, so an old copy can never overwrite newer data.
 * - Signed out, or Firebase not set up: it does nothing, and the app works on the phone alone as before.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../store/auth';
import { useLibrary, useStableCallback } from '../store/library';
import { entriesToUpload, hashSynced } from './merge';
import { fetchRemoteLibrary, uploadEntries } from './remote';

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error';

export interface SyncApi {
  status: SyncStatus;
  /** When the last successful download or upload finished. */
  lastSyncedAt: number | null;
  error: string | null;
  /** Download and merge now (also uploads anything that differs). */
  syncNow: () => Promise<void>;
}

/** Wait this long after the last change before uploading, so a burst of changes is sent together. */
const UPLOAD_DELAY_MS = 2500;
/** Coming back to the app re-downloads the library at most this often (each download reads every title). */
const FOREGROUND_REFRESH_MS = 2 * 60 * 1000;

const Ctx = createContext<SyncApi | null>(null);

const messageOf = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong.');

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { state, adoptAccount, mergeRemote } = useLibrary();
  const uid = auth.status === 'signedIn' ? (auth.user?.uid ?? null) : null;
  const hydrated = state.hydrated;

  const [status, setStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The account whose cloud library has been downloaded and merged: only then may we upload. */
  const [readyUid, setReadyUid] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /** title id -> hash of what the cloud holds (set from downloads and uploads). */
  const known = useRef(new Map<string, string>());
  const downloading = useRef(false);
  const uploading = useRef(false);
  const lastPullAt = useRef(0);

  // A different account means a different cloud library.
  useEffect(() => {
    known.current.clear();
    lastPullAt.current = 0;
  }, [uid]);

  const syncNow = useStableCallback(async () => {
    if (!uid || !hydrated || downloading.current) return;
    downloading.current = true;
    setStatus('syncing');
    setError(null);
    try {
      adoptAccount(uid);
      const remote = await fetchRemoteLibrary(uid);
      for (const entry of Object.values(remote)) known.current.set(entry.id, hashSynced(entry));
      mergeRemote(remote);
      lastPullAt.current = Date.now();
      setReadyUid(uid);
      setStatus('synced');
      setLastSyncedAt(Date.now());
    } catch (e) {
      setStatus('error');
      setError(messageOf(e));
    } finally {
      downloading.current = false;
    }
  });

  // Sync when an account signs in (and once the saved library has loaded).
  useEffect(() => {
    if (!uid || !hydrated) return;
    const timer = setTimeout(() => syncNow(), 0);
    return () => clearTimeout(timer);
  }, [uid, hydrated, syncNow]);

  // Sync when coming back to the app, unless it just happened.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && Date.now() - lastPullAt.current > FOREGROUND_REFRESH_MS) syncNow();
    });
    return () => subscription.remove();
  }, [syncNow]);

  // Upload what changed. Runs again after every change, and after an upload ends (the `tick`).
  useEffect(() => {
    if (!uid || readyUid !== uid || !hydrated) return;
    const pending = entriesToUpload(state.entries, known.current);
    if (pending.length === 0) return;
    const timer = setTimeout(async () => {
      if (uploading.current) return;
      uploading.current = true;
      setStatus('syncing');
      try {
        await uploadEntries(uid, pending);
        for (const item of pending) known.current.set(item.id, item.hash);
        setStatus('synced');
        setLastSyncedAt(Date.now());
        setError(null);
      } catch (e) {
        setStatus('error');
        setError(messageOf(e));
      } finally {
        uploading.current = false;
        setTick((t) => t + 1); // look again: more may have changed while uploading
      }
    }, UPLOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.entries, uid, readyUid, hydrated, tick]);

  const api = useMemo<SyncApi>(
    () => ({
      status: !uid ? 'off' : status === 'idle' ? 'syncing' : status,
      lastSyncedAt,
      error,
      syncNow,
    }),
    [uid, status, lastSyncedAt, error, syncNow],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSync(): SyncApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync must be used inside SyncProvider');
  return v;
}
