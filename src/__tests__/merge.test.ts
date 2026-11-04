import type { LibraryEntry } from '../store/reducer';
import {
  chunk,
  docIdFor,
  entriesToUpload,
  entryFromSynced,
  hashSynced,
  mergeEntry,
  mergeLibrary,
  parseSynced,
  readKeys,
  readLogOf,
  toSynced,
  type SyncedEntry,
} from '../sync/merge';

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'm1',
  title: 'Manga One',
  coverUrl: 'c.jpg',
  type: 'manhwa',
  favorite: false,
  status: null,
  readChapters: [],
  totalChapters: 0,
  newChapters: 0,
  addedAt: 100,
  ...over,
});

const synced = (over: Partial<SyncedEntry> = {}): SyncedEntry => ({
  id: 'm1',
  title: 'Manga One',
  coverUrl: 'c.jpg',
  type: 'manhwa',
  pubStatus: null,
  favorite: false,
  favoriteAt: 0,
  status: null,
  statusAt: 0,
  readLog: {},
  lastChapterId: null,
  lastChapterKey: null,
  lastChapterLabel: null,
  lastReadAt: 0,
  addedAt: 100,
  updatedAt: 0,
  ...over,
});

describe('docIdFor', () => {
  it('keeps simple ids as they are', () => {
    expect(docIdFor('0a1b2c3d-uuid')).toBe('0a1b2c3d-uuid');
  });

  it('encodes characters Firestore does not allow in ids ("/")', () => {
    expect(docIdFor('asura:a/b')).not.toContain('/');
    expect(docIdFor('mangaread:solo-leveling')).toBe('mangaread%3Asolo-leveling');
  });

  it('avoids the ids Firestore reserves', () => {
    expect(docIdFor('..')).toBe('~..');
    expect(docIdFor('.')).toBe('~.');
    expect(docIdFor('__name__')).toBe('~__name__');
  });

  it('gives different titles different ids', () => {
    const ids = ['a', 'a:b', 'a%3Ab', 'vortex:the-hero\'s-ballad', 'vortex:the-heros-ballad'].map(docIdFor);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('read log', () => {
  it('seeds chapters from before syncing existed with the time the title was last read', () => {
    expect(readLogOf({ readChapters: ['1', '2'], lastReadAt: 500, addedAt: 100 })).toEqual({ 1: 500, 2: 500 });
  });

  it('falls back to the time the title was added, and never to zero', () => {
    expect(readLogOf({ readChapters: ['1'], addedAt: 100 })).toEqual({ 1: 100 });
    expect(readLogOf({ readChapters: ['1'], addedAt: 0 })).toEqual({ 1: 1 });
  });

  it('keeps recorded entries, including "marked unread" ones, and does not re-seed them', () => {
    const log = readLogOf({ readChapters: ['1'], readLog: { 1: 900, 2: -950 }, lastReadAt: 10, addedAt: 5 });
    expect(log).toEqual({ 1: 900, 2: -950 });
  });

  it('readKeys lists only chapters currently read', () => {
    expect(readKeys({ 1: 5, 2: -6, 3: 7 })).toEqual(['1', '3']);
  });
});

describe('toSynced / entryFromSynced / parseSynced', () => {
  it('never produces undefined values (Firestore rejects them)', () => {
    const s = toSynced(entry());
    expect(Object.values(s).every((v) => v !== undefined)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('round-trips the synced fields and leaves device-only fields empty', () => {
    const local = entry({
      favorite: true,
      favoriteAt: 5,
      status: 'reading',
      statusAt: 6,
      readChapters: ['1', '2'],
      readLog: { 1: 10, 2: 11 },
      lastChapterId: 'c2',
      lastChapterKey: '2',
      lastChapterLabel: 'Ch. 2',
      lastReadAt: 11,
      updatedAt: 11,
      totalChapters: 50,
      newChapters: 3,
    });
    const back = entryFromSynced(toSynced(local));
    expect(back).toMatchObject({
      favorite: true,
      status: 'reading',
      readChapters: ['1', '2'],
      lastChapterId: 'c2',
      lastReadAt: 11,
      addedAt: 100,
    });
    expect(back.totalChapters).toBe(0);
    expect(back.newChapters).toBe(0);
  });

  it('parseSynced accepts a good document', () => {
    const doc = toSynced(entry({ favorite: true, favoriteAt: 3, readChapters: ['1'], readLog: { 1: 9 } }));
    expect(parseSynced(doc)).toEqual(doc);
  });

  it('parseSynced uses the fallback id, and rejects documents that cannot be used', () => {
    expect(parseSynced({ title: 'x' }, 'fallback')?.id).toBe('fallback');
    expect(parseSynced({ title: 'x' })).toBeNull();
    expect(parseSynced(null)).toBeNull();
    expect(parseSynced('nope')).toBeNull();
    expect(parseSynced(42)).toBeNull();
  });

  it('parseSynced cleans up wrong types instead of trusting them', () => {
    const parsed = parseSynced({
      id: 'x',
      type: 'comic',
      status: 'finished',
      favorite: 'yes',
      favoriteAt: 'soon',
      readLog: { 1: 5, 2: 'read', 3: 0, 4: Infinity, 5: -7 },
      lastReadAt: NaN,
    })!;
    expect(parsed.type).toBe('other');
    expect(parsed.status).toBeNull();
    expect(parsed.favorite).toBe(false);
    expect(parsed.favoriteAt).toBe(0);
    expect(parsed.readLog).toEqual({ 1: 5, 5: -7 });
    expect(parsed.lastReadAt).toBe(0);
  });
});

describe('mergeEntry', () => {
  it('creates the title when it only exists in the cloud', () => {
    const merged = mergeEntry(undefined, synced({ favorite: true, favoriteAt: 5, readLog: { 1: 9, 2: -8 } }));
    expect(merged.favorite).toBe(true);
    expect(merged.readChapters).toEqual(['1']);
  });

  it('keeps chapters read on either phone', () => {
    const local = entry({ readChapters: ['1', '2'], readLog: { 1: 10, 2: 11 } });
    const merged = mergeEntry(local, synced({ readLog: { 3: 12, 4: 13 } }));
    expect(merged.readChapters.sort()).toEqual(['1', '2', '3', '4']);
  });

  it('a newer "marked unread" wins over an older "read"', () => {
    const local = entry({ readChapters: ['1', '2'], readLog: { 1: 10, 2: 11 } });
    const merged = mergeEntry(local, synced({ readLog: { 2: -50 } }));
    expect(merged.readChapters).toEqual(['1']);
    expect(merged.readLog).toMatchObject({ 2: -50 });
  });

  it('a newer "read" wins over an older "marked unread"', () => {
    const local = entry({ readChapters: [], readLog: { 2: -20 } });
    expect(mergeEntry(local, synced({ readLog: { 2: 60 } })).readChapters).toEqual(['2']);
  });

  it('keeps the local value on an exact tie', () => {
    const local = entry({ readChapters: [], readLog: { 2: -30 } });
    expect(mergeEntry(local, synced({ readLog: { 2: 30 } })).readChapters).toEqual([]);
  });

  it('treats chapters read before syncing existed as old: a later unread elsewhere wins', () => {
    const legacy = entry({ readChapters: ['1', '2'], lastReadAt: 500 }); // no readLog yet
    const merged = mergeEntry(legacy, synced({ readLog: { 2: -900 } }));
    expect(merged.readChapters).toEqual(['1']);
  });

  it('decides the favourite and the status separately, by their own times', () => {
    const local = entry({ favorite: true, favoriteAt: 10, status: 'later', statusAt: 90 });
    const merged = mergeEntry(local, synced({ favorite: false, favoriteAt: 50, status: 'reading', statusAt: 20 }));
    expect(merged.favorite).toBe(false); // the cloud's change was newer
    expect(merged.status).toBe('later'); // this phone's change was newer
    expect(merged.favoriteAt).toBe(50);
    expect(merged.statusAt).toBe(90);
  });

  it('keeps the local favourite and status on a tie', () => {
    const local = entry({ favorite: true, favoriteAt: 10, status: 'later', statusAt: 10 });
    const merged = mergeEntry(local, synced({ favorite: false, favoriteAt: 10, status: 'reading', statusAt: 10 }));
    expect(merged).toMatchObject({ favorite: true, status: 'later' });
  });

  it('moves the reading position to whichever phone read most recently', () => {
    const local = entry({ lastChapterId: 'c3', lastChapterKey: '3', lastChapterLabel: 'Ch. 3', lastReadAt: 100 });
    const newer = mergeEntry(local, synced({ lastChapterId: 'c9', lastChapterKey: '9', lastChapterLabel: 'Ch. 9', lastReadAt: 200 }));
    expect(newer).toMatchObject({ lastChapterId: 'c9', lastChapterLabel: 'Ch. 9', lastReadAt: 200 });
    const older = mergeEntry(local, synced({ lastChapterId: 'c1', lastChapterKey: '1', lastChapterLabel: 'Ch. 1', lastReadAt: 50 }));
    expect(older).toMatchObject({ lastChapterId: 'c3', lastReadAt: 100 });
  });

  it('does not touch the fields that belong to one device', () => {
    const local = entry({ totalChapters: 80, newChapters: 4, latestChapterLabel: 'Ch. 80', syncedAt: 123 });
    const merged = mergeEntry(local, synced({ favorite: true, favoriteAt: 5 }));
    expect(merged).toMatchObject({ totalChapters: 80, newChapters: 4, latestChapterLabel: 'Ch. 80', syncedAt: 123 });
  });

  it('keeps the earliest added date and fills in missing details from the cloud', () => {
    const merged = mergeEntry(entry({ title: '', coverUrl: '', addedAt: 300 }), synced({ title: 'From cloud', coverUrl: 'cloud.jpg', addedAt: 100 }));
    expect(merged).toMatchObject({ title: 'From cloud', coverUrl: 'cloud.jpg', addedAt: 100 });
    expect(mergeEntry(entry({ title: 'Mine' }), synced({ title: 'Theirs' })).title).toBe('Mine');
  });

  it('merging the same cloud copy again changes nothing (idempotent)', () => {
    const local = entry({ readChapters: ['1'], readLog: { 1: 10 }, favorite: true, favoriteAt: 4 });
    const remote = synced({ readLog: { 2: 20, 1: -30 }, status: 'reading', statusAt: 8 });
    const once = mergeEntry(local, remote);
    const twice = mergeEntry(once, remote);
    expect(twice).toEqual(once);
  });

  it('both phones end up with the same library whichever way they merge', () => {
    const a = entry({ readChapters: ['1', '2'], readLog: { 1: 10, 2: 11 }, favorite: true, favoriteAt: 40, status: 'reading', statusAt: 12, lastChapterKey: '2', lastReadAt: 11 });
    const b = entry({ readChapters: ['3'], readLog: { 3: 30, 2: -25 }, favorite: false, favoriteAt: 20, status: 'completed', statusAt: 35, lastChapterKey: '3', lastReadAt: 30 });
    const aIntoB = mergeEntry(b, toSynced(a));
    const bIntoA = mergeEntry(a, toSynced(b));
    for (const field of ['favorite', 'status', 'lastChapterKey', 'lastReadAt', 'favoriteAt', 'statusAt'] as const) {
      expect(aIntoB[field]).toEqual(bIntoA[field]);
    }
    expect(aIntoB.readChapters.sort()).toEqual(bIntoA.readChapters.sort());
    expect(aIntoB.readChapters.sort()).toEqual(['1', '3']);
    expect(aIntoB).toMatchObject({ favorite: true, status: 'completed', lastChapterKey: '3' });
  });
});

describe('mergeLibrary', () => {
  it('keeps titles that exist on only one side and merges the ones on both', () => {
    const local = { a: entry({ id: 'a' }), shared: entry({ id: 'shared', readChapters: ['1'], readLog: { 1: 5 } }) };
    const remote = { b: synced({ id: 'b' }), shared: synced({ id: 'shared', readLog: { 2: 9 } }) };
    const merged = mergeLibrary(local, remote);
    expect(Object.keys(merged).sort()).toEqual(['a', 'b', 'shared']);
    expect(merged.shared.readChapters.sort()).toEqual(['1', '2']);
  });

  it('does not change the local library when the cloud is empty', () => {
    const local = { a: entry({ id: 'a' }) };
    expect(mergeLibrary(local, {})).toEqual(local);
  });
});

describe('deciding what to upload', () => {
  it('hashSynced ignores the order of the chapter log', () => {
    expect(hashSynced(synced({ readLog: { 1: 5, 2: 6 } }))).toBe(hashSynced(synced({ readLog: { 2: 6, 1: 5 } })));
    expect(hashSynced(synced({ readLog: { 1: 5 } }))).not.toBe(hashSynced(synced({ readLog: { 1: -5 } })));
  });

  it('uploads everything when nothing is known to be in the cloud yet', () => {
    const entries = { a: entry({ id: 'a' }), b: entry({ id: 'b' }) };
    expect(entriesToUpload(entries, new Map()).map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('uploads nothing when the cloud already holds exactly this', () => {
    const entries = { a: entry({ id: 'a', favorite: true, favoriteAt: 3 }) };
    const known = new Map(entriesToUpload(entries, new Map()).map((p) => [p.id, p.hash]));
    expect(entriesToUpload(entries, known)).toEqual([]);
  });

  it('uploads only the titles that changed', () => {
    const before = { a: entry({ id: 'a' }), b: entry({ id: 'b' }) };
    const known = new Map(entriesToUpload(before, new Map()).map((p) => [p.id, p.hash]));
    const after = { ...before, b: { ...before.b, favorite: true, favoriteAt: 9 } };
    expect(entriesToUpload(after, known).map((p) => p.id)).toEqual(['b']);
  });

  it('does not re-upload a title that was just merged from the cloud unchanged', () => {
    const remote = synced({ id: 'a', favorite: true, favoriteAt: 5, readLog: { 1: 7 } });
    const merged = mergeLibrary({}, { a: remote });
    const known = new Map([['a', hashSynced(remote)]]);
    expect(entriesToUpload(merged, known)).toEqual([]);
  });

  it('does upload a title where this phone is ahead of the cloud', () => {
    const remote = synced({ id: 'a', readLog: { 1: 7 } });
    const merged = mergeLibrary({ a: entry({ id: 'a', readChapters: ['1', '2'], readLog: { 1: 7, 2: 20 } }) }, { a: remote });
    const pending = entriesToUpload(merged, new Map([['a', hashSynced(remote)]]));
    expect(pending.map((p) => p.id)).toEqual(['a']);
    expect(pending[0].data.readLog).toEqual({ 1: 7, 2: 20 });
  });
});

describe('chunk', () => {
  it('splits a list into pieces of at most the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
});
