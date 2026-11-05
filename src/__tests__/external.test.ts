import { externalSites } from '../providers/external';

describe('link-only sites', () => {
  it('have unique ids and use https everywhere (iOS blocks plain http)', () => {
    const ids = externalSites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const site of externalSites) {
      expect(site.homeUrl).toMatch(/^https:\/\//);
      expect(site.searchUrl('x')).toMatch(/^https:\/\//);
      if (site.iconUrl) expect(site.iconUrl).toMatch(/^https:\/\//);
    }
  });

  it('lists MangaFire and Comix', () => {
    expect(externalSites.map((s) => s.id)).toEqual(expect.arrayContaining(['mangafire', 'comix']));
  });

  it.each(externalSites.map((s) => [s.name, s] as const))('%s: encodes the search text safely', (_name, site) => {
    const url = site.searchUrl('love & war? #1');
    expect(url).toContain('love%20%26%20war%3F%20%231');
    expect(url.split('?').length).toBe(2); // the text cannot start a second query string
    expect(url).not.toContain(' ');
  });

  it('Comix opens its browse page with the keyword', () => {
    const comix = externalSites.find((s) => s.id === 'comix')!;
    expect(comix.searchUrl('solo')).toBe('https://comix.to/browse?keyword=solo');
    expect(comix.homeUrl).toBe('https://comix.to/');
  });
});
