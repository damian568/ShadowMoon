/**
 * Type declaration for a function that exists at runtime in React Native but is missing from Firebase's typings.
 *
 * @firebase/auth lists a general `types` file before its `react-native` entry, so TypeScript reads the web
 * typings, while Expo's bundler picks the React Native build that really exports `getReactNativePersistence`.
 * This is the documented way to keep users signed in on React Native (see Expo's Firebase guide).
 */
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  /** The part of AsyncStorage that Firebase needs. */
  interface ReactNativeAsyncStorage {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
  }

  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
