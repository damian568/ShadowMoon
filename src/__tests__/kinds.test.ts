/**
 * Manga and light novels are two libraries: the saved titles are shared storage (so sync needs no changes), but each
 * screen only sees the titles of the kind chosen in Settings, and the source in use is the one of that kind.
 */
import { activeProviderId, libraryOfKind } from '../store/library';
import { DEFAULT_SETTINGS, reducer, type Action, type LibraryEntry, type MangaLite, type State } from '../store/reducer';

// library.tsx imports AsyncStorage, which has no native module under Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const comic: MangaLite = { id: 'mangaread:solo', title: 'Solo', coverUrl: '', type: 'manhwa' };
const bareComic: MangaLite = { id: 'a1b2c3', title: 'MangaDex title', coverUrl: '', type: 'manga' };
const novel: MangaLite = { id: 'novelbin:my-novel', title: 'My Novel', coverUrl: '', type: 'novel' };
const otherNovel: MangaLite = { id: 'rinkonovels:cry', title: 'Cry', coverUrl: '', type: 'novel' };

const fresh = (): State => ({ hydrated: true, entries: {}, settings: DEFAULT_SETTINGS, lastUpdateCheck: null });
const run = (state: State, ...actions: Action[]) => actions.reduce(reducer, state);

const withTitles = () =>
  run(
    fresh(),
    ...[comic, bareComic, novel, otherNovel].map((manga): Action => ({ type: 'setStatus', manga, status: 'reading' })),
  );

const titles = (list: LibraryEntry[]) => list.map((e) => e.title).sort();

describe('two libraries', () => {
  it('starts on manga, with a novel source ready', () => {
    expect(DEFAULT_SETTINGS.contentKind).toBe('manga');
    expect(DEFAULT_SETTINGS.novelProvider).toBe('rinkonovels');
    expect(DEFAULT_SETTINGS.appearance).toBe('dark');
  });

  it('shows only the titles of the chosen kind', () => {
    const s = withTitles();
    expect(titles(libraryOfKind(s.entries, 'manga'))).toEqual(['MangaDex title', 'Solo']);
    expect(titles(libraryOfKind(s.entries, 'novel'))).toEqual(['Cry', 'My Novel']);
  });

  it('leaves out titles that are not in a library (no favourite, no list)', () => {
    const s = run(withTitles(), { type: 'remove', id: novel.id });
    expect(titles(libraryOfKind(s.entries, 'novel'))).toEqual(['Cry']);
  });

  it('keeps both libraries when switching, so nothing is deleted', () => {
    const s = run(withTitles(), { type: 'settings', patch: { contentKind: 'novel' } });
    expect(Object.keys(s.entries)).toHaveLength(4);
    const back = run(s, { type: 'settings', patch: { contentKind: 'manga' } });
    expect(titles(libraryOfKind(back.entries, back.settings.contentKind))).toEqual(['MangaDex title', 'Solo']);
  });

  it('asks for a new update check when the kind changes (the other library is stale)', () => {
    const checked: State = { ...fresh(), lastUpdateCheck: 123 };
    expect(run(checked, { type: 'settings', patch: { contentKind: 'novel' } }).lastUpdateCheck).toBeNull();
    expect(run(checked, { type: 'settings', patch: { dataSaver: true } }).lastUpdateCheck).toBe(123);
  });
});

describe('the source in use', () => {
  it('is the manga source or the novel source, per the chosen kind', () => {
    const base = { ...DEFAULT_SETTINGS, provider: 'mangaread', novelProvider: 'novelbin' };
    expect(activeProviderId({ ...base, contentKind: 'manga' })).toBe('mangaread');
    expect(activeProviderId({ ...base, contentKind: 'novel' })).toBe('novelbin');
  });

  it('never mixes the kinds up (a manga source chosen for novels falls back to the default novel source)', () => {
    expect(activeProviderId({ ...DEFAULT_SETTINGS, contentKind: 'novel', novelProvider: 'mangadex' })).toBe('rinkonovels');
    expect(activeProviderId({ ...DEFAULT_SETTINGS, contentKind: 'manga', provider: 'novelbin' })).toBe('mangadex');
  });
});
