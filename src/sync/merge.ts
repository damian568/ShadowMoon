/**
 * Library sync: how one title's data is stored in the cloud and how two copies (this phone and the cloud) merge.
 *
 * Every user action stamps the thing it changed with the time it happened, and a merge keeps, field by field,
 * whichever side changed it last:
 *  - favourite and status each have their own timestamp;
 *  - every chapter has its own entry in `readLog`: a positive number means "read at that time", a negative number
 *    means "marked unread at that time". So chapters read on two phones are all kept, and an explicit "mark as
 *    unread" is not undone by the other phone still showing it as read;
 *  - the reading position (last chapter opened) follows `lastReadAt`.
 *
 * Things that belong to one device (chapter counts, "new chapter" badges, last update check) are not synced.
 * Times come from each phone's clock, so a badly wrong clock can make an old change look newer.
 *
 * Pure functions only: no network, no React. See src/sync/SyncProvider.tsx for the part that talks to Firestore.
 */
import type { MangaType } from '../providers/types';
import type { LibraryEntry, ReadingStatus } from '../store/reducer';

/** One title as stored in Firestore: users/{uid}/library/{docId}. JSON-safe (no undefined values). */
export interface SyncedEntry {
  id: string;
  title: string;
  coverUrl: string;
  type: MangaType;
  pubStatus: string | null;
  favorite: boolean;
  favoriteAt: number;
  status: ReadingStatus | null;
  statusAt: number;
  /** chapter key -> +time (read) or -time (marked unread) */
  readLog: Record<string, number>;
  lastChapterId: string | null;
  lastChapterKey: string | null;
  lastChapterLabel: string | null;
  lastReadAt: number;
  addedAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * A Firestore-safe document id for an app-wide title id (which can hold ":" or other characters).
 * The real id is stored inside the document, so this only needs to be valid and unique.
 */
export function docIdFor(id: string): string {
  const encoded = encodeURIComponent(id);
  // Firestore forbids ids that are only dots or that look like __name__.
  return /^\.+$|^__.*__$/.test(encoded) ? `~${encoded}` : encoded;
}

// ---------------------------------------------------------------------------
// Read log
// ---------------------------------------------------------------------------

/**
 * The per-chapter log of an entry. Entries saved before syncing existed have `readChapters` but no log;
 * those chapters count as read at the time the title was last read (or added).
 */
export function readLogOf(e: Pick<LibraryEntry, 'readChapters' | 'readLog' | 'lastReadAt' | 'addedAt'>): Record<string, number> {
  const log: Record<string, number> = { ...(e.readLog ?? {}) };
  const seedTime = Math.max(1, e.lastReadAt ?? e.addedAt ?? 1);
  for (const key of e.readChapters) if (!(key in log)) log[key] = seedTime;
  return log;
}

/** The chapter keys a log says are read. */
export const readKeys = (log: Record<string, number>): string[] => Object.keys(log).filter((k) => log[k] > 0);

/** Per chapter, keep whichever side's change is newer. On an exact tie, keep `a`. */
function mergeLogs(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (!(key in out) || Math.abs(value) > Math.abs(out[key])) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Local entry <-> cloud entry
// ---------------------------------------------------------------------------

export function toSynced(e: LibraryEntry): SyncedEntry {
  return {
    id: e.id,
    title: e.title,
    coverUrl: e.coverUrl,
    type: e.type,
    pubStatus: e.pubStatus ?? null,
    favorite: e.favorite,
    favoriteAt: e.favoriteAt ?? 0,
    status: e.status,
    statusAt: e.statusAt ?? 0,
    readLog: readLogOf(e),
    lastChapterId: e.lastChapterId ?? null,
    lastChapterKey: e.lastChapterKey ?? null,
    lastChapterLabel: e.lastChapterLabel ?? null,
    lastReadAt: e.lastReadAt ?? 0,
    addedAt: e.addedAt,
    updatedAt: e.updatedAt ?? 0,
  };
}

/** A new local entry built from a cloud entry (device-only fields start empty and are filled by the next refresh). */
export function entryFromSynced(s: SyncedEntry): LibraryEntry {
  return {
    id: s.id,
    title: s.title,
    coverUrl: s.coverUrl,
    type: s.type,
    pubStatus: s.pubStatus ?? undefined,
    favorite: s.favorite,
    favoriteAt: s.favoriteAt,
    status: s.status,
    statusAt: s.statusAt,
    readLog: s.readLog,
    readChapters: readKeys(s.readLog),
    totalChapters: 0,
    newChapters: 0,
    lastChapterId: s.lastChapterId ?? undefined,
    lastChapterKey: s.lastChapterKey ?? undefined,
    lastChapterLabel: s.lastChapterLabel ?? undefined,
    lastReadAt: s.lastReadAt || undefined,
    addedAt: s.addedAt,
    updatedAt: s.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Merge the cloud copy of one title into the local copy (or create it locally). */
export function mergeEntry(local: LibraryEntry | undefined, remote: SyncedEntry): LibraryEntry {
  if (!local) return entryFromSynced(remote);

  const log = mergeLogs(readLogOf(local), remote.readLog);

  const localFavoriteAt = local.favoriteAt ?? 0;
  const remoteFavoriteWins = remote.favoriteAt > localFavoriteAt;
  const localStatusAt = local.statusAt ?? 0;
  const remoteStatusWins = remote.statusAt > localStatusAt;
  const remotePositionWins = remote.lastReadAt > (local.lastReadAt ?? 0);

  return {
    ...local, // keeps device-only fields: totalChapters, newChapters, latest*, syncedAt, ...
    title: local.title || remote.title,
    coverUrl: local.coverUrl || remote.coverUrl,
    type: local.type || remote.type,
    pubStatus: local.pubStatus ?? remote.pubStatus ?? undefined,
    favorite: remoteFavoriteWins ? remote.favorite : local.favorite,
    favoriteAt: Math.max(localFavoriteAt, remote.favoriteAt),
    status: remoteStatusWins ? remote.status : local.status,
    statusAt: Math.max(localStatusAt, remote.statusAt),
    readLog: log,
    readChapters: readKeys(log),
    ...(remotePositionWins
      ? {
          lastChapterId: remote.lastChapterId ?? undefined,
          lastChapterKey: remote.lastChapterKey ?? undefined,
          lastChapterLabel: remote.lastChapterLabel ?? undefined,
          lastReadAt: remote.lastReadAt,
        }
      : {}),
    addedAt: Math.min(local.addedAt, remote.addedAt || local.addedAt),
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt),
  };
}

/** Merge the whole cloud library into the local one. Titles only on one side are kept. */
export function mergeLibrary(
  local: Record<string, LibraryEntry>,
  remote: Record<string, SyncedEntry>,
): Record<string, LibraryEntry> {
  const out: Record<string, LibraryEntry> = { ...local };
  for (const [id, entry] of Object.entries(remote)) out[id] = mergeEntry(local[id], entry);
  return out;
}

// ---------------------------------------------------------------------------
// Reading cloud documents safely
// ---------------------------------------------------------------------------

const TYPES: MangaType[] = ['manga', 'manhwa', 'manhua', 'other'];
const STATUSES: ReadingStatus[] = ['reading', 'completed', 'later'];

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNumber = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Turn whatever is stored in a cloud document into a SyncedEntry, or null if it is unusable. */
export function parseSynced(data: unknown, fallbackId?: string): SyncedEntry | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const id = asString(d.id) || fallbackId;
  if (!id) return null;

  const readLog: Record<string, number> = {};
  if (d.readLog && typeof d.readLog === 'object') {
    for (const [key, value] of Object.entries(d.readLog as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value !== 0) readLog[key] = value;
    }
  }

  const type = TYPES.find((t) => t === d.type) ?? 'other';
  const status = STATUSES.find((s) => s === d.status) ?? null;
  return {
    id,
    title: asString(d.title) ?? '',
    coverUrl: asString(d.coverUrl) ?? '',
    type,
    pubStatus: asString(d.pubStatus),
    favorite: d.favorite === true,
    favoriteAt: asNumber(d.favoriteAt),
    status,
    statusAt: asNumber(d.statusAt),
    readLog,
    lastChapterId: asString(d.lastChapterId),
    lastChapterKey: asString(d.lastChapterKey),
    lastChapterLabel: asString(d.lastChapterLabel),
    lastReadAt: asNumber(d.lastReadAt),
    addedAt: asNumber(d.addedAt, Date.now()),
    updatedAt: asNumber(d.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Deciding what to upload
// ---------------------------------------------------------------------------

/** Split a list into pieces of at most `size` (Firestore accepts at most 500 writes per batch). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A stable string for a cloud entry (fixed key order, sorted chapter keys), used to see whether it changed. */
export function hashSynced(s: SyncedEntry): string {
  const sortedLog: Record<string, number> = {};
  for (const key of Object.keys(s.readLog).sort()) sortedLog[key] = s.readLog[key];
  return JSON.stringify({ ...s, readLog: sortedLog });
}

export interface PendingUpload {
  id: string;
  data: SyncedEntry;
  hash: string;
}

/** Titles whose cloud form differs from what was last uploaded or downloaded (`known`: id -> hash). */
export function entriesToUpload(entries: Record<string, LibraryEntry>, known: ReadonlyMap<string, string>): PendingUpload[] {
  const out: PendingUpload[] = [];
  for (const entry of Object.values(entries)) {
    const data = toSynced(entry);
    const hash = hashSynced(data);
    if (known.get(entry.id) !== hash) out.push({ id: entry.id, data, hash });
  }
  return out;
}
