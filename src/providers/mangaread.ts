/**
 * MangaRead — https://www.mangaread.org (a standard WordPress "Madara" site; see madara.ts)
 */
import { createMadaraProvider } from './madara';

export const mangareadProvider = createMadaraProvider({
  id: 'mangaread',
  name: 'MangaRead',
  description: 'Reads titles and chapters from mangaread.org (English). No API — parsed from the website.',
  base: 'https://www.mangaread.org',
  iconUrl: 'https://www.mangaread.org/wp-content/uploads/2017/10/cropped-unnamed-32x32.png',
});
