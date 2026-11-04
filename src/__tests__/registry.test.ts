/**
 * Tests for the provider registry (src/providers/index.ts). The real providers are replaced with fakes,
 * so these tests exercise only the registry's own logic: ids, multi-source search and type look-ups.
 */
import {
  DEFAULT_PROVIDER_ID,
  getChaptersCached,
  getManga,
  getMangaByIds,
  getMangaCached,
  getProvider,
  listProviders,
  makeId,
  registerProvider,
  searchAll,
  searchManga,
  splitId,
} from '../providers';
import type { Manga, Provider } from '../providers/types';
import { fakeManga, fakeProvider, pageOf, searchOpts } from './helpers';

// jest.mock calls are hoisted above the imports. A mock factory can't use imported values, so it
// builds its fake with require().
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../providers/mangadex', () => ({ mangadexProvider: require('./helpers').fakeProvider('mangadex') }));
jest.mock('../providers/mangaread', () => ({ mangareadProvider: require('./helpers').fakeProvider('mangaread') }));
jest.mock('../providers/vortex', () => ({ vortexProvider: require('./helpers').fakeProvider('vortex') }));
jest.mock('../providers/asura', () => ({ asuraProvider: require('./helpers').fakeProvider('asura') }));
jest.mock('../providers/themesia', () => ({
  kingofshojoProvider: require('./helpers').fakeProvider('kingofshojo'),
  arenascanProvider: require('./helpers').fakeProvider('arenascan'),
  thunderscansProvider: require('./helpers').fakeProvider('thunderscans'),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

const provider = (id: string) => listProviders().find((p) => p.id === id)!;
const search = (id: string) => provider(id).search as jest.Mock;
const getMangaMock = (id: string) => provider(id).getManga as jest.Mock;

beforeEach(() => {
  // Every provider returns nothing unless a test says otherwise.
  for (const p of listProviders()) {
    (p.search as jest.Mock).mockReset().mockImplementation(async (o) => pageOf([], 0, o.offset ?? 0));
    (p.getManga as jest.Mock).mockReset().mockImplementation(async (id: string) => fakeManga(id));
  }
});

const m = (id: string, over: Partial<Manga> = {}) => fakeManga(id, over);
const ids = (items: Manga[]) => items.map((x) => x.id);

// --- ids ---------------------------------------------------------------------

describe('ids', () => {
  it('keeps the default provider\'s ids bare (so libraries saved before multi-source still work)', () => {
    expect(DEFAULT_PROVIDER_ID).toBe('mangadex');
    expect(makeId('mangadex', 'abc')).toBe('abc');
  });

  it('prefixes every other provider\'s ids', () => {
    expect(makeId('mangaread', 'solo')).toBe('mangaread:solo');
  });

  it('splits an app id back into provider and raw id', () => {
    expect(splitId('mangaread:solo')).toMatchObject({ rawId: 'solo', provider: { id: 'mangaread' } });
    expect(splitId('1234-uuid')).toMatchObject({ rawId: '1234-uuid', provider: { id: 'mangadex' } });
  });

  it('keeps colons that belong to the raw id and falls back to the default provider for unknown prefixes', () => {
    expect(splitId("vortex:the-hero's:ballad").rawId).toBe("the-hero's:ballad");
    expect(splitId('nope:thing')).toMatchObject({ rawId: 'nope:thing', provider: { id: 'mangadex' } });
  });

  it('getProvider falls back to the default for unknown or missing ids', () => {
    expect(getProvider('vortex').id).toBe('vortex');
    expect(getProvider('does-not-exist').id).toBe('mangadex');
    expect(getProvider(undefined).id).toBe('mangadex');
  });
});

describe('registerProvider', () => {
  it('adds a provider', () => {
    registerProvider(fakeProvider('extra'));
    expect(listProviders().some((p) => p.id === 'extra')).toBe(true);
    expect(makeId('extra', 'x')).toBe('extra:x');
  });

  it('rejects a duplicate id', () => {
    expect(() => registerProvider(fakeProvider('mangaread'))).toThrow('already registered');
  });

  it('rejects an id containing ":"', () => {
    expect(() => registerProvider(fakeProvider('bad:id'))).toThrow('must not contain ":"');
  });
});

// --- single-source calls -----------------------------------------------------------

describe('searchManga', () => {
  it('gives each result an app-wide id', async () => {
    search('mangaread').mockResolvedValue(pageOf([m('solo')]));
    const page = await searchManga({ ...searchOpts(), provider: 'mangaread' });
    expect(ids(page.items)).toEqual(['mangaread:solo']);
  });

  it('uses the default provider when none is named', async () => {
    search('mangadex').mockResolvedValue(pageOf([m('uuid-1')]));
    expect(ids((await searchManga(searchOpts())).items)).toEqual(['uuid-1']);
  });
});

describe('getManga', () => {
  it('routes by id prefix and re-attaches the app-wide id', async () => {
    getMangaMock('vortex').mockResolvedValue(m('the-hero'));
    const manga = await getManga('vortex:the-hero');
    expect(getMangaMock('vortex')).toHaveBeenCalledWith('the-hero');
    expect(manga.id).toBe('vortex:the-hero');
  });

  it('getMangaCached reuses a recent result unless forced', async () => {
    getMangaMock('asura').mockResolvedValue(m('cached-one'));
    await getMangaCached('asura:cached-one');
    await getMangaCached('asura:cached-one');
    expect(getMangaMock('asura')).toHaveBeenCalledTimes(1);
    await getMangaCached('asura:cached-one', true);
    expect(getMangaMock('asura')).toHaveBeenCalledTimes(2);
  });
});

describe('getChaptersCached', () => {
  it('caches chapters per title and language', async () => {
    const getChapters = provider('mangaread').getChapters as jest.Mock;
    getChapters.mockReset().mockResolvedValue([]);
    const manga = m('mangaread:chap-cache');
    await getChaptersCached(manga, 'en');
    await getChaptersCached(manga, 'en');
    await getChaptersCached(manga, 'fr');
    expect(getChapters).toHaveBeenCalledTimes(2);
    expect(getChapters).toHaveBeenCalledWith(expect.objectContaining({ id: 'chap-cache' }), 'en'); // raw id is passed on
  });
});

describe('getMangaByIds', () => {
  it('looks titles up per provider and skips ones that fail', async () => {
    getMangaMock('mangaread').mockImplementation(async (id: string) => {
      if (id === 'gone') throw new Error('404');
      return m(id);
    });
    const found = await getMangaByIds(['mangaread:here', 'mangaread:gone']);
    expect(ids(found)).toEqual(['mangaread:here']);
  });

  it('uses a provider\'s batch lookup when it has one', async () => {
    const batch = jest.fn(async (list: string[]) => list.map((x) => m(x)));
    (provider('mangadex') as Provider).getMangaByIds = batch;
    expect(ids(await getMangaByIds(['a', 'b']))).toEqual(['a', 'b']);
    expect(batch).toHaveBeenCalledWith(['a', 'b']);
  });

  it('lets one provider fail without losing the others', async () => {
    (provider('mangadex') as Provider).getMangaByIds = jest.fn(async () => {
      throw new Error('down');
    });
    getMangaMock('vortex').mockImplementation(async (id: string) => m(id));
    expect(ids(await getMangaByIds(['a', 'vortex:b']))).toEqual(['vortex:b']);
  });
});

// --- searching every source at once ------------------------------------------------------

describe('searchAll', () => {
  it('merges every source, interleaving so no site floods the top', async () => {
    search('mangadex').mockResolvedValue(pageOf([m('a1'), m('a2'), m('a3')], 3, 0, 30));
    search('mangaread').mockResolvedValue(pageOf([m('b1'), m('b2')], 2, 0, 12));
    const res = await searchAll(searchOpts({ title: 'x' }));
    expect(ids(res.items)).toEqual(['a1', 'mangaread:b1', 'a2', 'mangaread:b2', 'a3']);
  });

  it('skips a source that fails and still returns the others', async () => {
    search('mangadex').mockResolvedValue(pageOf([m('a1')], 1));
    search('vortex').mockRejectedValue(new Error('blocked'));
    const res = await searchAll(searchOpts({ title: 'x' }));
    expect(ids(res.items)).toEqual(['a1']);
    expect(res.state.done).toContain('vortex');
  });

  it('throws when every source fails on the first page', async () => {
    for (const p of listProviders()) search(p.id).mockRejectedValue(new Error('no network'));
    await expect(searchAll(searchOpts({ title: 'x' }))).rejects.toThrow('no network');
  });

  it('does not throw when sources are merely empty', async () => {
    const res = await searchAll(searchOpts({ title: 'x' }));
    expect(res.items).toEqual([]);
    expect(res.hasMore).toBe(false);
  });

  it('only queries sources that offer the chosen language', async () => {
    (provider('mangadex') as Provider).languages = [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }];
    search('mangadex').mockResolvedValue(pageOf([m('fr-title')], 1));
    await searchAll(searchOpts({ title: 'x', language: 'fr' }));
    expect(search('mangadex')).toHaveBeenCalled();
    expect(search('mangaread')).not.toHaveBeenCalled(); // English only
    expect(search('vortex')).not.toHaveBeenCalled();
  });

  it('forces the title order and gives each source its own paging offset', async () => {
    search('mangadex').mockResolvedValue(pageOf([m('a1')], 100, 0, 30)); // more to come
    search('mangaread').mockResolvedValue(pageOf([m('b1')], 20, 0, 12)); // more to come
    const first = await searchAll(searchOpts({ title: 'x' }));
    expect(first.state.offsets).toMatchObject({ mangadex: 30, mangaread: 12 });
    expect(first.hasMore).toBe(true);

    search('mangadex').mockClear();
    search('mangaread').mockClear();
    await searchAll(searchOpts({ title: 'x' }), first.state);
    expect(search('mangadex')).toHaveBeenCalledWith(expect.objectContaining({ offset: 30 }));
    expect(search('mangaread')).toHaveBeenCalledWith(expect.objectContaining({ offset: 12 }));
  });

  it('stops asking a source once it has no more results, until none are left', async () => {
    search('mangadex').mockResolvedValue(pageOf([m('a1')], 1, 0, 30)); // everything fit on page one
    search('mangaread').mockResolvedValue(pageOf([m('b1')], 40, 0, 12)); // more to come
    const first = await searchAll(searchOpts({ title: 'x' }));
    expect(first.state.done).toContain('mangadex');
    expect(first.hasMore).toBe(true);

    search('mangadex').mockClear();
    search('mangaread').mockResolvedValue(pageOf([m('b2')], 40, 12, 12)).mockResolvedValueOnce(pageOf([m('b2')], 13, 12, 12));
    const second = await searchAll(searchOpts({ title: 'x' }), first.state);
    expect(search('mangadex')).not.toHaveBeenCalled();
    expect(ids(second.items)).toEqual(['mangaread:b2']);
    expect(second.hasMore).toBe(false);
  });

  it('treats an empty page as the end for that source', async () => {
    search('mangadex').mockResolvedValue(pageOf([], 999, 0, 30));
    expect((await searchAll(searchOpts({ title: 'x' }))).state.done).toContain('mangadex');
  });

  it('does not throw on a later page when a source fails (only the first page throws)', async () => {
    search('mangadex').mockResolvedValue(pageOf([m('a1')], 100, 0, 30));
    const first = await searchAll(searchOpts({ title: 'x' }));
    search('mangadex').mockRejectedValue(new Error('rate limited'));
    const second = await searchAll(searchOpts({ title: 'x' }), first.state);
    expect(second.items).toEqual([]);
    expect(second.state.done).toContain('mangadex');
  });
});

// --- type look-up -----------------------------------------------------------------------

describe('type filter on sources that do not show a title\'s type', () => {
  it('looks the type up from the title page and keeps only matching titles', async () => {
    search('mangaread').mockResolvedValue(pageOf([m('t1', { type: 'other' }), m('t2', { type: 'other' }), m('t3', { type: 'manhwa' })]));
    getMangaMock('mangaread').mockImplementation(async (id: string) => m(id, { type: id === 't1' ? 'manhwa' : 'manga' }));
    const page = await searchManga({ ...searchOpts({ type: 'manhwa' }), provider: 'mangaread' });
    expect(ids(page.items)).toEqual(['mangaread:t1', 'mangaread:t3']);
    expect(page.items.every((x) => x.type === 'manhwa')).toBe(true);
  });

  it('looks each title up only once, even across searches', async () => {
    search('mangaread').mockResolvedValue(pageOf([m('u1', { type: 'other' })]));
    getMangaMock('mangaread').mockImplementation(async (id: string) => m(id, { type: 'manga' }));
    await searchManga({ ...searchOpts({ type: 'manga' }), provider: 'mangaread' });
    await searchManga({ ...searchOpts({ type: 'manga' }), provider: 'mangaread' });
    await searchManga({ ...searchOpts({ type: 'manhwa' }), provider: 'mangaread' });
    expect(getMangaMock('mangaread')).toHaveBeenCalledTimes(1);
  });

  it('drops titles whose type could not be found out', async () => {
    search('mangaread').mockResolvedValue(pageOf([m('v1', { type: 'other' }), m('v2', { type: 'other' })]));
    getMangaMock('mangaread').mockImplementation(async (id: string) => {
      if (id === 'v1') throw new Error('timeout');
      return m(id, { type: 'manhua' });
    });
    const page = await searchManga({ ...searchOpts({ type: 'manhua' }), provider: 'mangaread' });
    expect(ids(page.items)).toEqual(['mangaread:v2']);
  });

  it('does no look-ups without a type filter', async () => {
    search('mangaread').mockResolvedValue(pageOf([m('w1', { type: 'other' })]));
    await searchManga({ ...searchOpts(), provider: 'mangaread' });
    await searchManga({ ...searchOpts({ type: 'all' }), provider: 'mangaread' });
    expect(getMangaMock('mangaread')).not.toHaveBeenCalled();
  });

  it('does no look-ups for titles that already have a type', async () => {
    search('mangadex').mockResolvedValue(pageOf([m('x1', { type: 'manhwa' }), m('x2', { type: 'manga' })]));
    const page = await searchManga({ ...searchOpts({ type: 'manhwa' }), provider: 'mangadex' });
    expect(ids(page.items)).toEqual(['x1']);
    expect(getMangaMock('mangadex')).not.toHaveBeenCalled();
  });

  it('applies to the merged all-sources search too', async () => {
    search('mangadex').mockResolvedValue(pageOf([m('y1', { type: 'manga' }), m('y2', { type: 'manhwa' })]));
    search('mangaread').mockResolvedValue(pageOf([m('y3', { type: 'other' })]));
    getMangaMock('mangaread').mockResolvedValue(m('y3', { type: 'manhwa' }));
    const res = await searchAll(searchOpts({ title: 'x', type: 'manhwa' }));
    expect(ids(res.items).sort()).toEqual(['mangaread:y3', 'y2']);
  });
});
