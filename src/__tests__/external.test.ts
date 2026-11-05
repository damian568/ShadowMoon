import { externalSites } from '../providers/external';

const withSearch = externalSites.filter((s) => s.searchUrl);

describe('link-only sites', () => {
  it('have unique ids and use https everywhere (iOS blocks plain http)', () => {
    const ids = externalSites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const site of externalSites) {
      expect(site.homeUrl).toMatch(/^https:\/\//);
      if (site.searchUrl) expect(site.searchUrl('x')).toMatch(/^https:\/\//);
      if (site.iconUrl) expect(site.iconUrl).toMatch(/^https:\/\//);
    }
  });

  it('lists MangaFire, Comix, Toonz, Komix and Atsumaru', () => {
    expect(externalSites.map((s) => s.id)).toEqual(expect.arrayContaining(['mangafire', 'comix', 'toonz', 'komix', 'atsumaru']));
  });

  it.each(withSearch.map((s) => [s.name, s] as const))('%s: encodes the search text safely', (_name, site) => {
    const url = site.searchUrl!('love & war? #1');
    expect(url).toContain('love%20%26%20war%3F%20%231');
    expect(url.split('?').length).toBe(2); // the text cannot start a second query string
    expect(url).not.toContain(' ');
  });

  it('Comix opens its browse page with the keyword', () => {
    const comix = externalSites.find((s) => s.id === 'comix')!;
    expect(comix.searchUrl!('solo')).toBe('https://comix.to/browse?keyword=solo');
    expect(comix.homeUrl).toBe('https://comix.to/');
  });

  it('Toonz opens its search page with the text', () => {
    expect(externalSites.find((s) => s.id === 'toonz')!.searchUrl!('solo leveling')).toBe('https://toonz.to/search?q=solo%20leveling');
  });

  it('Komix and Atsumaru only open the site, because their search address cannot be confirmed', () => {
    for (const id of ['komix', 'atsumaru']) expect(externalSites.find((s) => s.id === id)!.searchUrl).toBeUndefined();
  });
});
