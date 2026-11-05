import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Alert } from 'react-native';

/** Open the Search tab with the title already typed in (searches every source). */
export function searchInApp(title: string) {
  // `n` makes every request unique, so searching the same title twice still reruns the search.
  router.navigate({ pathname: '/search', params: { q: title, n: String(Date.now()) } });
}

/** Long-press menu for a title: copy it, or search for it straight away in the app. */
export function showTitleActions(title: string) {
  Haptics.selectionAsync().catch(() => {});
  Alert.alert(title, undefined, [
    { text: 'Copy title', onPress: () => Clipboard.setStringAsync(title).catch(() => {}) },
    { text: 'Search in app', onPress: () => searchInApp(title) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
