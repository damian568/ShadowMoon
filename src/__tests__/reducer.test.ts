import type { Chapter } from '../providers/types';
import { DEFAULT_SETTINGS, reducer, type Action, type MangaLite, type State } from '../store/reducer';

const manga: MangaLite = { id: 'm1', title: 'Manga One', coverUrl: 'c.jpg', type: 'manhwa' };

const fresh = (): State => ({ hydrated: true, entries: {}, settings: DEFAULT_SETTINGS, lastUpdateCheck: null });

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
const chapters = (count: number) => Array.from({ length: count }, (_, i) => chapter(i + 1));

const run = (state: State, ...actions: Action[]) => actions.reduce(reducer, state);

/** A library entry that is tracked and synced with `count` chapters. */
const synced = (count: number) =>
  run(fresh(), { type: 'setStatus', manga, status: 'reading' }, { type: 'syncChapters', manga, chapters: chapters(count) });

describe('favourites and status', () => {
  it('toggles favourite on and off', () => {
    const on = run(fresh(), { type: 'toggleFavorite', manga });
    expect(on.entries.m1.favorite).toBe(true);
    expect(run(on, { type: 'toggleFavorite', manga }).entries.m1.favorite).toBe(false);
  });

  it('sets a reading status', () => {
    expect(run(fresh(), { type: 'setStatus', manga, status: 'later' }).entries.m1.status).toBe('later');
  });

  it('remove clears favourite and status but keeps the entry (and its progress)', () => {
    let s = run(synced(3), { type: 'toggleFavorite', manga }, { type: 'setRead', manga, keys: ['1'], read: true });
    s = run(s, { type: 'remove', id: 'm1' });
    expect(s.entries.m1.favorite).toBe(false);
    expect(s.entries.m1.status).toBeNull();
    expect(s.entries.m1.readChapters).toEqual(['1']);
  });
});

describe('read progress and the Done status', () => {
  it('reading a chapter moves a title that has no status to Reading', () => {
    const s = run(fresh(), { type: 'setRead', manga, keys: ['1'], read: true });
    expect(s.entries.m1.status).toBe('reading');
    expect(s.entries.m1.readChapters).toEqual(['1']);
  });

  it('moves a "For later" title to Reading when you read something', () => {
    const s = run(fresh(), { type: 'setStatus', manga, status: 'later' }, { type: 'setRead', manga, keys: ['1'], read: true });
    expect(s.entries.m1.status).toBe('reading');
  });

  it('marks the title Done once every known chapter is read', () => {
    const s = run(synced(3), { type: 'setRead', manga, keys: ['1', '2', '3'], read: true });
    expect(s.entries.m1.status).toBe('completed');
  });

  it('marks Done when the last chapter is read one at a time', () => {
    let s = synced(3);
    for (const k of ['1', '2']) s = run(s, { type: 'setRead', manga, keys: [k], read: true });
    expect(s.entries.m1.status).toBe('reading');
    s = run(s, { type: 'setRead', manga, keys: ['3'], read: true });
    expect(s.entries.m1.status).toBe('completed');
  });

  it('stays Reading while chapters are unread', () => {
    expect(run(synced(3), { type: 'setRead', manga, keys: ['1', '2'], read: true }).entries.m1.status).toBe('reading');
  });

  it('never finishes a title whose chapter count is unknown yet', () => {
    const s = run(fresh(), { type: 'setRead', manga, keys: ['1', '2', '3'], read: true });
    expect(s.entries.m1.totalChapters).toBe(0);
    expect(s.entries.m1.status).toBe('reading');
  });

  it('moves a Done title back to Reading when a chapter is marked unread', () => {
    let s = run(synced(3), { type: 'setRead', manga, keys: ['1', '2', '3'], read: true });
    s = run(s, { type: 'setRead', manga, keys: ['2'], read: false });
    expect(s.entries.m1.status).toBe('reading');
    expect(s.entries.m1.readChapters.sort()).toEqual(['1', '3']);
  });

  it('keeps a manually chosen Done status when you un-read nothing', () => {
    const s = run(synced(3), { type: 'setStatus', manga, status: 'completed' });
    expect(s.entries.m1.status).toBe('completed');
  });

  it('does not double count a chapter read twice', () => {
    const s = run(synced(3), { type: 'setRead', manga, keys: ['1'], read: true }, { type: 'setRead', manga, keys: ['1'], read: true });
    expect(s.entries.m1.readChapters).toEqual(['1']);
  });
});

describe('opening a chapter', () => {
  it('records where you stopped and moves the title to Reading', () => {
    const s = run(fresh(), { type: 'openChapter', manga, chapter: chapter(7) });
    expect(s.entries.m1).toMatchObject({ status: 'reading', lastChapterId: 'ch-7', lastChapterKey: '7', lastChapterLabel: 'Ch. 7' });
    expect(s.entries.m1.lastReadAt).toEqual(expect.any(Number));
  });

  it('keeps a Done title as Done', () => {
    const s = run(synced(1), { type: 'setRead', manga, keys: ['1'], read: true }, { type: 'openChapter', manga, chapter: chapter(1) });
    expect(s.entries.m1.status).toBe('completed');
  });
});

describe('syncing chapters', () => {
  it('only tracks titles that are in the library', () => {
    expect(run(fresh(), { type: 'syncChapters', manga, chapters: chapters(5) }).entries).toEqual({});
  });

  it('stores the chapter count and latest chapter, and clears the new badge', () => {
    let s = run(synced(2), { type: 'syncChapters', manga, chapters: chapters(5) });
    expect(s.entries.m1.totalChapters).toBe(5);
    expect(s.entries.m1.latestChapterLabel).toBe('Ch. 5');
    expect(s.entries.m1.newChapters).toBe(0);
    expect(s.entries.m1.syncedAt).toEqual(expect.any(Number));
    s = run(s, { type: 'syncChapters', manga, chapters: [] });
    expect(s.entries.m1.totalChapters).toBe(0);
  });

  describe('a Done title', () => {
    const done = () => run(synced(3), { type: 'setRead', manga, keys: ['1', '2', '3'], read: true });

    it('goes back to Reading when opening it reveals new chapters (before the update check ran)', () => {
      expect(done().entries.m1.status).toBe('completed');
      const s = run(done(), { type: 'syncChapters', manga, chapters: chapters(5) });
      expect(s.entries.m1.status).toBe('reading');
      expect(s.entries.m1.totalChapters).toBe(5);
    });

    it('then becomes Done again after the new chapters are read', () => {
      let s = run(done(), { type: 'syncChapters', manga, chapters: chapters(5) });
      s = run(s, { type: 'setRead', manga, keys: ['4'], read: true });
      expect(s.entries.m1.status).toBe('reading');
      s = run(s, { type: 'setRead', manga, keys: ['5'], read: true });
      expect(s.entries.m1.status).toBe('completed');
    });

    it('stays Done when the chapter count has not grown', () => {
      expect(run(done(), { type: 'syncChapters', manga, chapters: chapters(3) }).entries.m1.status).toBe('completed');
    });

    it('stays Done if you set it by hand, as long as no new chapters appear', () => {
      const manual = run(synced(3), { type: 'setStatus', manga, status: 'completed' });
      expect(run(manual, { type: 'syncChapters', manga, chapters: chapters(3) }).entries.m1.status).toBe('completed');
    });

    it('stays Done if a refresh briefly reports fewer chapters', () => {
      expect(run(done(), { type: 'syncChapters', manga, chapters: chapters(2) }).entries.m1.status).toBe('completed');
    });
  });
});

describe('update checker', () => {
  const update = (state: State, total: number, at = 1000) =>
    run(state, {
      type: 'applyUpdates',
      at,
      results: [{ id: 'm1', latestUploadedChapter: `ch-${total}`, totalChapters: total, latestChapterLabel: `Ch. ${total}` }],
    });

  it('counts new chapters and remembers when they were found', () => {
    const s = update(synced(3), 5);
    expect(s.entries.m1.newChapters).toBe(2);
    expect(s.entries.m1.totalChapters).toBe(5);
    expect(s.entries.m1.lastUpdateFoundAt).toBe(1000);
    expect(s.lastUpdateCheck).toBe(1000);
  });

  it("doesn't report new chapters the first time a title is seen", () => {
    const s = update(run(fresh(), { type: 'setStatus', manga, status: 'reading' }), 5);
    expect(s.entries.m1.newChapters).toBe(0);
    expect(s.entries.m1.totalChapters).toBe(5);
  });

  it('adds up new chapters across checks', () => {
    expect(update(update(synced(3), 4, 1000), 6, 2000).entries.m1.newChapters).toBe(3);
  });

  it('moves a Done title back to Reading when new chapters appear', () => {
    const done = run(synced(3), { type: 'setRead', manga, keys: ['1', '2', '3'], read: true });
    expect(done.entries.m1.status).toBe('completed');
    expect(update(done, 4).entries.m1.status).toBe('reading');
  });

  it('keeps Done when nothing new was found', () => {
    const done = run(synced(3), { type: 'setRead', manga, keys: ['1', '2', '3'], read: true });
    expect(update(done, 3).entries.m1.status).toBe('completed');
  });

  it('clearNew clears one title or all of them', () => {
    const s = update(synced(3), 5);
    expect(run(s, { type: 'clearNew', id: 'm1' }).entries.m1.newChapters).toBe(0);
    expect(run(s, { type: 'clearNew' }).entries.m1.newChapters).toBe(0);
  });

  it('ignores updates for titles that are not in the library', () => {
    expect(update(fresh(), 5).entries).toEqual({});
  });
});

describe('settings and housekeeping', () => {
  it('hydrate merges stored settings over the defaults and marks the store ready', () => {
    const s = reducer({ ...fresh(), hydrated: false }, { type: 'hydrate', payload: { settings: { ...DEFAULT_SETTINGS, language: 'fr' } } });
    expect(s.hydrated).toBe(true);
    expect(s.settings.language).toBe('fr');
    expect(s.settings.provider).toBe(DEFAULT_SETTINGS.provider);
  });

  it('changing a non-language setting leaves progress alone', () => {
    const s = run(synced(3), { type: 'settings', patch: { dataSaver: true } });
    expect(s.settings.dataSaver).toBe(true);
    expect(s.entries.m1.totalChapters).toBe(3);
  });

  it('changing the chapter language forces a clean re-sync without "new chapter" noise', () => {
    let s = update(synced(3), 5);
    s = run(s, { type: 'settings', patch: { language: 'es' } });
    expect(s.entries.m1.syncedAt).toBeUndefined();
    expect(s.entries.m1.newChapters).toBe(0);
    expect(s.lastUpdateCheck).toBeNull();
  });

  it('reset clears the library', () => {
    expect(run(synced(3), { type: 'reset' }).entries).toEqual({});
  });

  function update(state: State, total: number): State {
    return run(state, { type: 'applyUpdates', at: 1, results: [{ id: 'm1', latestUploadedChapter: null, totalChapters: total }] });
  }
});
