/**
 * Provider registry + the only API the screens use for content.
 *
 * ids
 * ---
 * Providers work with their own raw ids. The registry turns them into app-wide ids:
 *   - the default provider (MangaDex) keeps its bare id, so libraries saved before multi-provider
 *     support keep working;
 *   - every other provider is prefixed: "<providerId>:<rawId>".
 * Chapter ids stay raw; they are always used together with the app-wide manga id.
 */
import { mangadexProvider } from './mangadex';
import { mangareadProvider } from './mangaread';
import { asuraProvider } from './asura';
import { rinkoProvider } from './rinko';
import { mgekoProvider } from './mgeko';
import { arenascanProvider, kingofshojoProvider, rokariProvider, thunderscansProvider } from './themesia';
import { vortexProvider } from './vortex';
import type { Chapter, Manga, MangaStats, MangaType, Page, Provider, SearchOptions } from './types';

export * from './types';

export const DEFAULT_PROVIDER_ID = mangadexProvider.id;

const providers: Provider[] = [mangadexProvider, mangareadProvider, kingofshojoProvider, arenascanProvider, vortexProvider, asuraProvider, thunderscansProvider, mgekoProvider, rokariProvider, rinkoProvider];

/** Add a new source. Call once at startup (see README, "Adding a provider"). */
export function registerProvider(p: Provider) {
  if (providers.some((x) => x.id === p.id)) throw new Error(`Provider "${p.id}" is already registered`);
  if (p.id.includes(':')) throw new Error('Provider ids must not contain ":"');
  providers.push(p);
}

export const listProviders = (): readonly Provider[] => providers;

export function getProvider(id: string | undefined): Provider {
  return providers.find((p) => p.id === id) ?? providers.find((p) => p.id === DEFAULT_PROVIDER_ID)!;
}

export const makeId = (providerId: string, rawId: string) =>
  providerId === DEFAULT_PROVIDER_ID ? rawId : `${providerId}:${rawId}`;

export function splitId(id: string): { provider: Provider; rawId: string } {
  const i = id.indexOf(':');
  if (i > 0) {
    const p = providers.find((x) => x.id === id.slice(0, i));
    if (p) return { provider: p, rawId: id.slice(i + 1) };
  }
  return { provider: getProvider(DEFAULT_PROVIDER_ID), rawId: id };
}

const globalize = (p: Provider, m: Manga): Manga => ({ ...m, id: makeId(p.id, m.id) });
const localize = (m: Manga): Manga => ({ ...m, id: splitId(m.id).rawId });

// ---------------------------------------------------------------------------
// Calls used by the app
// ---------------------------------------------------------------------------

export async function searchManga(opts: SearchOptions & { provider?: string }): Promise<Page<Manga>> {
  const p = getProvider(opts.provider);
  const page = await p.search(opts);
  let items = page.items.map((m) => globalize(p, m));
  if (opts.type && opts.type !== 'all') items = await keepType(p, items, opts.type);
  return { ...page, items };
}

// Some sites don't show a title's type in their lists. When a type filter is on, look the real type up once
// (from the title page) and remember it, so such titles are filtered properly instead of slipping through.
const typeCache = new Map<string, MangaType>();

async function keepType(p: Provider, items: Manga[], type: MangaType): Promise<Manga[]> {
  const unknown = items.filter((m) => m.type === 'other' && !typeCache.has(m.id));
  await Promise.allSettled(
    unknown.map(async (m) => {
      const detail = await p.getManga(splitId(m.id).rawId);
      typeCache.set(m.id, detail.type);
    }),
  );
  return items
    .map((m) => (m.type === 'other' && typeCache.has(m.id) ? { ...m, type: typeCache.get(m.id)! } : m))
    .filter((m) => m.type === type);
}

/** Paging state for `searchAll`: how far each source has been read, and which are exhausted or failed. */
export interface MultiSearchState {
  offsets: Record<string, number>;
  done: string[];
}

/**
 * Search every source that offers the chosen language at once and interleave the results
 * (best match of each source first). A source that fails or has no more results is skipped,
 * so one site being down never breaks the search. Pass the returned `state` back for the next page.
 */
export async function searchAll(
  opts: SearchOptions,
  state: MultiSearchState = { offsets: {}, done: [] },
): Promise<{ items: Manga[]; state: MultiSearchState; hasMore: boolean }> {
  const active = providers.filter((p) => !state.done.includes(p.id) && p.languages.some((l) => l.code === opts.language));
  const settled = await Promise.allSettled(
    active.map((p) => searchManga({ ...opts, provider: p.id, offset: state.offsets[p.id] ?? 0 })),
  );

  const offsets = { ...state.offsets };
  const done = [...state.done];
  const lists: Manga[][] = [];
  let firstError: unknown;
  settled.forEach((res, i) => {
    const p = active[i];
    if (res.status === 'rejected') {
      firstError ??= res.reason;
      done.push(p.id);
      return;
    }
    const page = res.value;
    lists.push(page.items);
    offsets[p.id] = page.offset + page.limit;
    if (page.items.length === 0 || page.offset + page.limit >= page.total) done.push(p.id);
  });

  // Every source failed on the very first page: surface the error instead of "nothing found".
  if (active.length > 0 && lists.length === 0 && Object.keys(state.offsets).length === 0) throw firstError;

  // Round-robin interleave so no single source floods the top of the list.
  const items: Manga[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) items.push(l[i]);
  }
  const hasMore = providers.some((p) => !done.includes(p.id) && p.languages.some((l) => l.code === opts.language));
  return { items, state: { offsets, done }, hasMore };
}

export async function getManga(id: string): Promise<Manga> {
  const { provider, rawId } = splitId(id);
  return globalize(provider, await provider.getManga(rawId));
}

/** Batch lookup across providers (used by the update checker). Missing titles are skipped. */
export async function getMangaByIds(ids: string[]): Promise<Manga[]> {
  const byProvider = new Map<Provider, string[]>();
  for (const id of ids) {
    const { provider, rawId } = splitId(id);
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), rawId]);
  }
  const out: Manga[] = [];
  for (const [p, raws] of byProvider) {
    try {
      const found = p.getMangaByIds
        ? await p.getMangaByIds(raws)
        : (await Promise.allSettled(raws.map((r) => p.getManga(r)))).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      out.push(...found.map((m) => globalize(p, m)));
    } catch (e) {
      // One provider being down must not stop updates for the others — unless it's the only one.
      if (byProvider.size === 1) throw e;
    }
  }
  return out;
}

export async function getChapters(manga: Pick<Manga, 'id' | 'chapterNumbersResetOnNewVolume'>, language: string): Promise<Chapter[]> {
  const { provider, rawId } = splitId(manga.id);
  return provider.getChapters({ ...(manga as Manga), id: rawId }, language);
}

export function getChapterPages(mangaId: string, chapterId: string, dataSaver: boolean): Promise<string[]> {
  return splitId(mangaId).provider.getChapterPages(chapterId, dataSaver);
}

export async function getStats(id: string): Promise<MangaStats | null> {
  const { provider, rawId } = splitId(id);
  return provider.getStats ? provider.getStats(rawId) : null;
}

// ---------------------------------------------------------------------------
// Tiny in-memory cache so the detail screen and the reader share data
// ---------------------------------------------------------------------------

const TTL = 10 * 60 * 1000;
const mangaCache = new Map<string, { at: number; value: Manga }>();
const chapterCache = new Map<string, { at: number; value: Chapter[] }>();

export async function getMangaCached(id: string, force = false): Promise<Manga> {
  const hit = mangaCache.get(id);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await getManga(id);
  mangaCache.set(id, { at: Date.now(), value });
  return value;
}

export async function getChaptersCached(manga: Manga, language: string, force = false): Promise<Chapter[]> {
  const key = `${manga.id}:${language}`;
  const hit = chapterCache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await getChapters(manga, language);
  chapterCache.set(key, { at: Date.now(), value });
  return value;
}

export function primeChapterCache(mangaId: string, language: string, chapters: Chapter[]) {
  chapterCache.set(`${mangaId}:${language}`, { at: Date.now(), value: chapters });
}

// Exposed for tests.
export const _internal = { localize };
