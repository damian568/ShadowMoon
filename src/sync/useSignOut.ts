import { Image } from 'expo-image';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '../store/auth';
import { useLibrary, useStableCallback } from '../store/library';
import { useSync } from './SyncProvider';
import { signOutSafely } from './signout';

const askAboutUnsavedChanges = () =>
  new Promise<boolean>((resolve) => {
    Alert.alert(
      'Some changes are not saved',
      'Your latest changes could not be saved to your account (are you offline?). If you sign out now they will be lost. Sign out anyway?',
      [
        { text: 'Stay signed in', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Sign out anyway', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

/**
 * Returns a function that asks for confirmation and then signs out, resetting this phone to defaults.
 * The library and settings stay in the account and come back when you sign in again.
 */
export function useSignOut(): () => void {
  const auth = useAuth();
  const sync = useSync();
  const { resetAll } = useLibrary();

  const run = useStableCallback(async () => {
    try {
      await signOutSafely({
        flush: sync.flush,
        confirmLoss: askAboutUnsavedChanges,
        signOut: auth.signOut,
        reset: async () => {
          resetAll();
          try {
            await Image.clearDiskCache();
            await Image.clearMemoryCache();
          } catch {
            // The cache is only a convenience: a failure here must not stop the sign-out.
          }
        },
      });
    } catch (e) {
      Alert.alert('Could not sign out', e instanceof Error ? e.message : 'Please try again.');
    }
  });

  return useCallback(() => {
    Alert.alert(
      'Sign out?',
      'Your library and settings are removed from this phone. They stay saved in your account and come back when you sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            run();
          },
        },
      ],
    );
  }, [run]);
}
