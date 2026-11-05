/**
 * Websites that can't be read inside ShadowMoon (their pages are built by JavaScript behind bot checks,
 * so there is nothing for the app to parse). They are offered as links that open in the in-app browser.
 * Reading happens on the website itself, so there is no library or progress tracking for them.
 */
export interface ExternalSite {
  id: string;
  name: string;
  iconUrl?: string;
  /** Opened when there is no search text. */
  homeUrl: string;
  /** Opened with the user's search text. */
  searchUrl: (query: string) => string;
}

export const externalSites: readonly ExternalSite[] = [
  {
    id: 'mangafire',
    name: 'MangaFire',
    iconUrl: 'https://mangafire.to/assets/mangafire/logo-sm.png',
    homeUrl: 'https://mangafire.to/',
    searchUrl: (q) => `https://mangafire.to/filter?keyword=${encodeURIComponent(q)}`,
  },
  {
    id: 'comix',
    name: 'Comix',
    iconUrl: 'https://comix.to/assets/uploads/35595e3de3c99889c1bd2c56f3e3714fc0c457.png',
    homeUrl: 'https://comix.to/',
    // /browse is the site's browse page; the keyword option is the usual one but could not be confirmed from outside
    // the app, because the results are drawn by the site's own script.
    searchUrl: (q) => `https://comix.to/browse?keyword=${encodeURIComponent(q)}`,
  },
];
