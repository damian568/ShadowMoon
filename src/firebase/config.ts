/**
 * Firebase web-app configuration.
 *
 * Fill these in from the Firebase console: Project settings -> General -> Your apps -> Web app -> SDK setup and
 * configuration. These values identify your project; they are not secrets. Your data is protected by the Firestore
 * security rules, not by hiding this config.
 *
 * Until `apiKey`, `projectId` and `appId` are filled in, the app runs normally without accounts: the sign-in
 * screens open but cannot sign in.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyCmpFQvq27gfxEbufioOonHyQyJ0aTZNDw',
  authDomain: 'shadowmoon-22fe9.firebaseapp.com',
  projectId: 'shadowmoon-22fe9',
  storageBucket: 'shadowmoon-22fe9.firebasestorage.app',
  messagingSenderId: '523927322074',
  appId: '1:523927322074:web:0c2b5f9267f6572c21d4e3',
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
