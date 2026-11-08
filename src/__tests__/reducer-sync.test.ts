import type { Chapter } from '../providers/types';
import { DEFAULT_SETTINGS, reducer, type Action, type MangaLite, type State } from '../store/reducer';
import { toSynced } from '../sync/merge';

const manga: MangaLite = { id: 'm1', title: 'Manga One', coverUrl: 'c.jpg', type: 'manhwa' };
const fresh = (): State => ({ hydrated: true, entries: {}, settings: DEFAULT_SETTINGS, lastUpdateCheck: null, syncedUid: null });
const run = (state: State, ...actions: Action[]) => actions.reduce(reducer, state);

const chapter = (n: number): Chapter => ({
  id: `ch-${n}`,
  key: String(n),
  chapter: String(n),
  volume: null,
  title: null,
  pages: 10,
  externalUrl: null,
  readableAt: '2026-01-01T00:00:00.000Z',
  group: null,
});

/** Run `fn` with the clock set to `ms`, so each action in a test happens at a known time. */
const at = <T>(ms: number, fn: () => T): T => {
  jest.setSystemTime(ms);
  return fn();
};

beforeEach(() => jest.useFakeTimers().setSystemTime(1000));
afterEach(() => jest.useRealTimers());

describe('change times', () => {
  it('toggling the favourite stamps the favourite and the entry', () => {
    const e = at(5000, () => run(fresh(), { type: 'toggleFavorite', manga })).entries.m1;
    expect(e).toMatchObject({ favorite: true, favoriteAt: 5000, updatedAt: 5000 });
  });

  it('setting a status stamps the status, but only when it really changes', () => {
    let s = at(2000, () => run(fresh(), { type: 'setStatus', manga, status: 'reading' }));
    expect(s.entries.m1.statusAt).toBe(2000);
    s = at(3000, () => run(s, { type: 'setStatus', manga, status: 'reading' }));
    expect(s.entries.m1.statusAt).toBe(2000); // unchanged status keeps its original time
    s = at(4000, () => run(s, { type: 'setStatus', manga, status: 'later' }));
    expect(s.entries.m1.statusAt).toBe(4000);
  });

  it('reading a chapter logs it as read at that time; un-reading logs a negative time', () => {
    let s = at(2000, () => run(fresh(), { type: 'setRead', manga, keys: ['1', '2'], read: true }));
    expect(s.entries.m1.readLog).toEqual({ 1: 2000, 2: 2000 });
    s = at(3000, () => run(s, { type: 'setRead', manga, keys: ['2'], read: false }));
    expect(s.entries.m1.readLog).toEqual({ 1: 2000, 2: -3000 });
    expect(s.entries.m1.readChapters).toEqual(['1']);
    s = at(4000, () => run(s, { type: 'setRead', manga, keys: ['2'], read: true }));
    expect(s.entries.m1.readLog![2]).toBe(4000);
  });

  it('reading a chapter that moves the title to Reading stamps the status', () => {
    const s = at(2500, () => run(fresh(), { type: 'setRead', manga, keys: ['1'], read: true }));
    expect(s.entries.m1).toMatchObject({ status: 'reading', statusAt: 2500 });
  });

  it('chapters read before syncing existed are seeded into the log on the next change', () => {
    const legacy: State = {
      ...fresh(),
      entries: {
        m1: { id: 'm1', title: 'Manga One', coverUrl: '', type: 'manhwa', favorite: false, status: 'reading', readChapters: ['1', '2'], totalChapters: 0, newChapters: 0, addedAt: 100, lastReadAt: 700 },
      },
    };
    const s = at(2000, () => run(legacy, { type: 'setRead', manga, keys: ['3'], read: true }));
    expect(s.entries.m1.readLog).toEqual({ 1: 700, 2: 700, 3: 2000 });
  });

  it('opening a chapter stamps the reading position', () => {
    const e = at(6000, () => run(fresh(), { type: 'openChapter', manga, chapter: chapter(7) })).entries.m1;
    expect(e).toMatchObject({ lastChapterKey: '7', lastReadAt: 6000, status: 'reading', statusAt: 6000, updatedAt: 6000 });
  });

  it('removing a title from the lists stamps both the favourite and the status', () => {
    let s = at(2000, () => run(fresh(), { type: 'toggleFavorite', manga }, { type: 'setStatus', manga, status: 'reading' }));
    s = at(9000, () => run(s, { type: 'remove', id: 'm1' }));
    expect(s.entries.m1).toMatchObject({ favorite: false, favoriteAt: 9000, status: null, statusAt: 9000 });
  });

  it('a Done title going back to Reading (new chapters) stamps the status', () => {
    let s = at(1000, () => run(fresh(), { type: 'setStatus', manga, status: 'reading' }, { type: 'syncChapters', manga, chapters: [chapter(1), chapter(2)] }));
    s = at(2000, () => run(s, { type: 'setRead', manga, keys: ['1', '2'], read: true }));
    expect(s.entries.m1).toMatchObject({ status: 'completed', statusAt: 2000 });
    s = at(3000, () => run(s, { type: 'syncChapters', manga, chapters: [chapter(1), chapter(2), chapter(3)] }));
    expect(s.entries.m1).toMatchObject({ status: 'reading', statusAt: 3000 });
  });
});

describe('adoptAccount', () => {
  const withLibrary = () => run(fresh(), { type: 'toggleFavorite', manga });

  it('a phone that was never synced keeps its library and just records the account', () => {
    const s = run(withLibrary(), { type: 'adoptAccount', uid: 'alice' });
    expect(s.syncedUid).toBe('alice');
    expect(Object.keys(s.entries)).toEqual(['m1']);
  });

  it('does nothing when the same account is adopted again', () => {
    const once = run(withLibrary(), { type: 'adoptAccount', uid: 'alice' });
    expect(run(once, { type: 'adoptAccount', uid: 'alice' })).toBe(once);
  });

  it("clears the previous account's library when a different account signs in", () => {
    const alice = run(withLibrary(), { type: 'adoptAccount', uid: 'alice' });
    const bob = run(alice, { type: 'adoptAccount', uid: 'bob' });
    expect(bob.syncedUid).toBe('bob');
    expect(bob.entries).toEqual({});
  });

  it('keeps the same account\'s library after signing out and back in', () => {
    const alice = run(withLibrary(), { type: 'adoptAccount', uid: 'alice' });
    expect(run(alice, { type: 'adoptAccount', uid: 'alice' }).entries.m1).toBeDefined();
  });

  it('is remembered when the saved state is loaded again', () => {
    const loaded = reducer({ ...fresh(), hydrated: false }, { type: 'hydrate', payload: { syncedUid: 'alice', entries: {} } });
    expect(loaded.syncedUid).toBe('alice');
  });
});

describe('two phones', () => {
  it('a new phone gets the whole library from the cloud', () => {
    const phoneA = at(2000, () =>
      run(
        fresh(),
        { type: 'toggleFavorite', manga },
        { type: 'setRead', manga, keys: ['1', '2', '3'], read: true },
        { type: 'openChapter', manga, chapter: chapter(3) },
      ),
    );
    const cloud = Object.fromEntries(Object.values(phoneA.entries).map((e) => [e.id, toSynced(e)]));

    const newPhone = run(fresh(), { type: 'adoptAccount', uid: 'alice' }, { type: 'mergeRemote', remote: cloud });
    expect(newPhone.entries.m1).toMatchObject({
      favorite: true,
      status: 'reading',
      lastChapterKey: '3',
      title: 'Manga One',
    });
    expect(newPhone.entries.m1.readChapters.sort()).toEqual(['1', '2', '3']);
  });

  it('changes made on both phones are combined, and both phones agree afterwards', () => {
    // Both start from the same synced library: chapters 1-2 read.
    const base = at(1000, () => run(fresh(), { type: 'setRead', manga, keys: ['1', '2'], read: true }));
    const cloud0 = Object.fromEntries(Object.values(base.entries).map((e) => [e.id, toSynced(e)]));
    let a = run(fresh(), { type: 'mergeRemote', remote: cloud0 });
    let b = run(fresh(), { type: 'mergeRemote', remote: cloud0 });

    // Phone A: reads chapter 3, favourites the title.
    a = at(2000, () => run(a, { type: 'setRead', manga, keys: ['3'], read: true }, { type: 'toggleFavorite', manga }));
    // Phone B (later): reads chapter 4, marks chapter 1 unread.
    b = at(3000, () => run(b, { type: 'setRead', manga, keys: ['4'], read: true }, { type: 'setRead', manga, keys: ['1'], read: false }));

    const fromA = Object.fromEntries(Object.values(a.entries).map((e) => [e.id, toSynced(e)]));
    const fromB = Object.fromEntries(Object.values(b.entries).map((e) => [e.id, toSynced(e)]));
    const aSees = run(a, { type: 'mergeRemote', remote: fromB });
    const bSees = run(b, { type: 'mergeRemote', remote: fromA });

    for (const merged of [aSees.entries.m1, bSees.entries.m1]) {
      expect(merged.readChapters.sort()).toEqual(['2', '3', '4']); // 1 was un-read later, 3 and 4 both kept
      expect(merged.favorite).toBe(true);
    }
    expect(aSees.entries.m1.status).toBe(bSees.entries.m1.status);
  });

  it('an old copy of the library cannot undo a newer change', () => {
    const stale = at(1000, () => run(fresh(), { type: 'setRead', manga, keys: ['1', '2'], read: true }));
    let phone = run(fresh(), { type: 'mergeRemote', remote: Object.fromEntries(Object.values(stale.entries).map((e) => [e.id, toSynced(e)])) });
    phone = at(5000, () => run(phone, { type: 'setRead', manga, keys: ['2'], read: false }));
    // The stale copy arrives again (for example a slow download): chapter 2 stays un-read.
    const merged = run(phone, { type: 'mergeRemote', remote: Object.fromEntries(Object.values(stale.entries).map((e) => [e.id, toSynced(e)])) });
    expect(merged.entries.m1.readChapters).toEqual(['1']);
  });
});

describe('the Dark/Light choice belongs to the account', () => {
  it('records when it changed, but not when it is set to what it already is', () => {
    const light = run(fresh(), { type: 'settings', patch: { appearance: 'light' } });
    expect(light.settings.appearance).toBe('light');
    expect(light.settings.appearanceAt).toBeGreaterThan(0);
    const same = run(light, { type: 'settings', patch: { appearance: 'light' } });
    expect(same.settings.appearanceAt).toBe(light.settings.appearanceAt);
    expect(run(fresh(), { type: 'settings', patch: { dataSaver: true } }).settings.appearanceAt).toBeUndefined();
  });

  it('is restored from the account on a new phone', () => {
    const s = run(fresh(), { type: 'adoptAccount', uid: 'alice' }, { type: 'mergeAppearance', appearance: 'light', at: 500 });
    expect(s.settings).toMatchObject({ appearance: 'light', appearanceAt: 500 });
  });

  it('keeps whichever copy changed last', () => {
    const phone = run(fresh(), { type: 'mergeAppearance', appearance: 'light', at: 500 });
    expect(run(phone, { type: 'mergeAppearance', appearance: 'dark', at: 400 })).toBe(phone); // older: ignored
    expect(run(phone, { type: 'mergeAppearance', appearance: 'light', at: 500 })).toBe(phone); // same: nothing to do
    expect(run(phone, { type: 'mergeAppearance', appearance: 'dark', at: 600 }).settings.appearance).toBe('dark'); // newer wins
  });

  it('goes back to dark when signing out, and is not carried over to another account', () => {
    const alice = run(fresh(), { type: 'adoptAccount', uid: 'alice' }, { type: 'mergeAppearance', appearance: 'light', at: 500 });
    expect(run(alice, { type: 'resetAll' }).settings).toMatchObject({ appearance: 'dark' });
    const bob = run(alice, { type: 'adoptAccount', uid: 'bob' });
    expect(bob.settings.appearance).toBe('dark');
    expect(bob.settings.appearanceAt).toBeUndefined();
  });
});
