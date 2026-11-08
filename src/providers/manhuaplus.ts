/**
 * ManhuaPlus — https://manhuaplus.com (a standard WordPress "Madara" site; see madara.ts)
 */
import { createMadaraProvider } from './madara';

export const manhuaplusProvider = createMadaraProvider({
  id: 'manhuaplus',
  name: 'ManhuaPlus',
  description: 'Manhua, manhwa and manga from manhuaplus.com (English). No API — parsed from the website.',
  base: 'https://manhuaplus.com',
  iconUrl: 'https://manhuaplus.com/favicon.ico',
});
