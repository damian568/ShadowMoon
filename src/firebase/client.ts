/**
 * Creates the Firebase app and its services, once. Each getter returns null while Firebase is not configured, so
 * the rest of the app can simply skip anything cloud-related.
 *
 * The signed-in user is stored with AsyncStorage so you stay signed in after closing the app.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, getReactNativePersistence, initializeAuth, type Auth } from 'firebase/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';

import { firebaseConfig, isFirebaseConfigured } from './config';

let auth: Auth | null = null;
let db: Firestore | null = null;

function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseConfigured) return null;
  if (auth) return auth;
  const app = getFirebaseApp();
  try {
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    // Already initialised (for example after a fast refresh): reuse that instance.
    auth = getAuth(app);
  }
  return auth;
}

export function getFirebaseDb(): Firestore | null {
  if (!isFirebaseConfigured) return null;
  if (db) return db;
  const app = getFirebaseApp();
  try {
    // Auto-detect lets Firestore fall back to long polling on networks where React Native's streaming connection
    // is blocked or hangs.
    db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    db = getFirestore(app);
  }
  return db;
}
