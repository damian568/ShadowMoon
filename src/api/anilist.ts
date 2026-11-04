/**
 * AniList (https://anilist.gitbook.io/anilist-apiv2-docs) — free GraphQL API, no key needed.
 * It has no chapter images, so ShadowMoon uses it only for community score / popularity
 * of a title that was found on MangaDex.
 */

const ENDPOINT = 'https://graphql.anilist.co';

export interface AniListInfo {
  id: number;
  /** 0–100 */
  score: number | null;
  popularity: number | null;
  url: string;
}

interface Candidate {
  id: number;
  siteUrl: string;
  averageScore: number | null;
  popularity: number | null;
  countryOfOrigin: string | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[] | null;
}

const QUERY = `
query ($search: String) {
  Page(perPage: 8) {
    media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
      id siteUrl averageScore popularity countryOfOrigin synonyms
      title { romaji english native }
    }
  }
}`;

const COUNTRY: Record<string, string> = { manga: 'JP', manhwa: 'KR', manhua: 'CN' };

export const normalize = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export function pickMatch(candidates: Candidate[], names: string[], type: string): Candidate | null {
  const wanted = new Set(names.map(normalize).filter(Boolean));
  const country = COUNTRY[type];
  const matches = candidates.filter((c) => {
    if (country && c.countryOfOrigin && c.countryOfOrigin !== country) return false;
    const all = [c.title.romaji, c.title.english, c.title.native, ...(c.synonyms ?? [])];
    return all.some((t) => wanted.has(normalize(t)));
  });
  // Most popular exact-title match (avoids spin-offs that share a synonym).
  return matches.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0] ?? null;
}

const cache = new Map<string, AniListInfo | null>();

export async function getAniListInfo(manga: { id: string; title: string; altTitle?: string; type: string }): Promise<AniListInfo | null> {
  if (cache.has(manga.id)) return cache.get(manga.id)!;
  const names = [manga.title, manga.altTitle].filter(Boolean) as string[];
  let result: AniListInfo | null = null;
  try {
    for (const search of names) {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { search } }),
      });
      if (!res.ok) break;
      const json = await res.json();
      const hit = pickMatch(json?.data?.Page?.media ?? [], names, manga.type);
      if (hit) {
        result = { id: hit.id, score: hit.averageScore, popularity: hit.popularity, url: hit.siteUrl };
        break;
      }
    }
  } catch {
    return null; // network problem: don't cache, try again next time
  }
  cache.set(manga.id, result);
  return result;
}
