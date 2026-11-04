/**
 * Account state for the whole app.
 *
 * - 'unavailable': Firebase is not configured yet (see src/firebase/config.ts); the app works without an account.
 * - 'loading':     checking whether a user is already signed in (stored on the device).
 * - 'signedOut' / 'signedIn'.
 *
 * The actions throw an Error whose message is already user-friendly.
 */
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { isFirebaseConfigured } from '../firebase/config';
import { getFirebaseAuth } from '../firebase/client';
import { friendlyAuthError } from '../utils/auth';

export type AuthStatus = 'unavailable' | 'loading' | 'signedOut' | 'signedIn';

export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface AuthApi {
  status: AuthStatus;
  user: AuthUser | null;
  /** False until the Firebase config has been filled in. */
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const NOT_CONFIGURED = 'Accounts are not set up yet.';

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isFirebaseConfigured ? 'loading' : 'unavailable');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    // Fires once with the stored user (or null), then on every sign-in and sign-out.
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, email: u.email } : null);
      setStatus(u ? 'signedIn' : 'signedOut');
    });
  }, []);

  const run = useCallback(async (action: (auth: NonNullable<ReturnType<typeof getFirebaseAuth>>) => Promise<unknown>) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error(NOT_CONFIGURED);
    try {
      await action(auth);
    } catch (e) {
      throw new Error(friendlyAuthError(e));
    }
  }, []);

  const api = useMemo<AuthApi>(
    () => ({
      status,
      user,
      configured: isFirebaseConfigured,
      signIn: (email, password) => run((auth) => signInWithEmailAndPassword(auth, email.trim(), password)),
      register: (email, password) => run((auth) => createUserWithEmailAndPassword(auth, email.trim(), password)),
      signOut: () => run((auth) => firebaseSignOut(auth)),
      resetPassword: (email) => run((auth) => sendPasswordResetEmail(auth, email.trim())),
    }),
    [status, user, run],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
