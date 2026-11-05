import { contentRatings } from '../store/library';
import { DEFAULT_SETTINGS } from '../store/reducer';

// library.tsx imports AsyncStorage, which has no native module under Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('contentRatings', () => {
  it('hides 18+ titles by default', () => {
    expect(DEFAULT_SETTINGS.showMature).toBe(false);
    expect(contentRatings(DEFAULT_SETTINGS)).toEqual(['safe', 'suggestive']);
  });

  it('includes erotica and adult titles only when "Show mature titles" is on', () => {
    expect(contentRatings({ ...DEFAULT_SETTINGS, showMature: true })).toEqual(['safe', 'suggestive', 'erotica', 'pornographic']);
  });
});
