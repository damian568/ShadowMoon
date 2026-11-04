// Checks the provider registry with fake providers plus one live MangaDex call.
// Run: npx --yes tsx tools/test-providers.mts
import assert from 'node:assert/strict';

import {
  getChapterPages,
  getChapters,
  getChaptersCached,
  getMangaByIds,
  getMangaCached,
  getProvider,
  listProviders,
  makeId,
  registerProvider,
  searchManga,
  splitId,
  type Chapter,
  type Manga,
  type Provider,
} from '../src/providers';

const manga = (id: string, title: string): Manga => ({
  id, title, description: '', coverUrl: '', coverUrlLarge: '', type: 'manhwa', originalLanguage: 'ko',
  pubStatus: 'ongoing', year: 2024, contentRating: 'safe', tags: [], authors: [], lastChapter: null,
  latestUploadedChapter: 'u1', availableLanguages: ['en'], chapterNumbersResetOnNewVolume: false,
});
const chapter = (n: number): Chapter => ({
  id: `ch${n}`, key: String(n), chapter: String(n), volume: null, title: null, pages: 3,
  externalUrl: null, readableAt: '2026-01-01', group: null,
});

const calls: string[] = [];
const mock: Provider = {
  id: 'mock', name: 'Mock', description: 'test', languages: [{ code: 'en', label: 'English' }],
  types: ['manhwa'], sorts: ['followedCount'],
  async search() { return { items: [manga('abc', 'Mock Title')], total: 1, offset: 0, limit: 24 }; },
  async getManga(id) { calls.push(`getManga:${id}`); return manga(id, `Mock ${id}`); },
  async getChapters(m) { calls.push(`getChapters:${m.id}`); return [chapter(1), chapter(2)]; },
  async getChapterPages(id, saver) { calls.push(`pages:${id}:${saver}`); return [`https://img.test/${id}/1.jpg`]; },
};
const broken: Provider = {
  ...mock, id: 'broken', name: 'Broken',
  async getMangaByIds() { throw new Error('down'); },
};

registerProvider(mock);
registerProvider(broken);

// registration rules
assert.throws(() => registerProvider(mock), /already registered/);
assert.throws(() => registerProvider({ ...mock, id: 'a:b' }), /must not contain/);
assert.deepEqual(listProviders().map((p) => p.id), ['mangadex', 'mock', 'broken']);

// ids: default provider stays bare (old libraries keep working), others are prefixed
assert.equal(makeId('mangadex', 'uuid-1'), 'uuid-1');
assert.equal(makeId('mock', 'abc'), 'mock:abc');
assert.equal(splitId('32d76d19-8a05-4db0-9fc2-e0b0648fe9d0').provider.id, 'mangadex');
assert.equal(splitId('mock:abc').provider.id, 'mock');
assert.equal(splitId('mock:abc').rawId, 'abc');
assert.equal(splitId('nope:abc').provider.id, 'mangadex'); // unknown prefix -> default
assert.equal(getProvider('does-not-exist').id, 'mangadex');

// search results get app-wide ids
const page = await searchManga({ provider: 'mock', language: 'en', ratings: ['safe'] });
assert.equal(page.items[0].id, 'mock:abc');

// calls are routed to the right provider with raw ids
const m = await getMangaCached('mock:abc');
assert.equal(m.id, 'mock:abc');
assert.ok(calls.includes('getManga:abc'));
await getMangaCached('mock:abc');
assert.equal(calls.filter((c) => c === 'getManga:abc').length, 1, 'second call must hit the cache');
const chs = await getChaptersCached(m, 'en');
assert.equal(chs.length, 2);
assert.ok(calls.includes('getChapters:abc'), 'provider must receive the raw id');
assert.deepEqual(await getChapterPages('mock:abc', 'ch1', true), ['https://img.test/ch1/1.jpg']);
assert.ok(calls.includes('pages:ch1:true'));
assert.equal((await getChapters({ ...m, id: 'mock:abc' }, 'en')).length, 2);

// batch lookup: groups per provider, falls back to getManga, and one failing provider is skipped
const batch = await getMangaByIds(['mock:x', 'mock:y', 'broken:z']);
assert.deepEqual(batch.map((b) => b.id).sort(), ['mock:x', 'mock:y']);

// the real default provider works through the registry (live network)
const live = await searchManga({ provider: 'mangadex', type: 'manhwa', order: 'followedCount', language: 'en', ratings: ['safe'], limit: 2 });
assert.ok(live.items.length > 0, 'MangaDex search returned nothing');
assert.ok(!live.items[0].id.includes(':'), 'MangaDex ids stay bare');
const liveChapters = await getChapters(live.items[0], 'en');
console.log(`live MangaDex via registry: "${live.items[0].title}", ${liveChapters.length} chapters`);

console.log('providers: all assertions passed');
