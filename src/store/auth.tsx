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
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail,
  type User,
} from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { isFirebaseConfigured } from '../firebase/config';
import { getFirebaseAuth } from '../firebase/client';
import { friendlyAuthError, isWrongCredential, normalizeNickname } from '../utils/auth';

export type AuthStatus = 'unavailable' | 'loading' | 'signedOut' | 'signedIn';

export interface AuthUser {
  uid: string;
  email: string | null;
  /** The nickname, if one was chosen. */
  displayName: string | null;
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
  /** Change the nickname shown in the app. */
  updateNickname: (nickname: string) => Promise<void>;
  /**
   * Ask Firebase to change the sign-in email. A confirmation link is sent to the NEW address and the email only
   * changes after it is opened.
   */
  changeEmail: (newEmail: string, currentPassword: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Re-read the account from Firebase (for example after confirming a new email). */
  refreshUser: () => Promise<void>;
}

const NOT_CONFIGURED = 'Accounts are not set up yet.';

const Ctx = createContext<AuthApi | null>(null);

const toAuthUser = (u: User): AuthUser => ({ uid: u.uid, email: u.email, displayName: u.displayName });

/** Keep the same object when nothing changed, so re-reading the account does not cause extra re-renders. */
const keepIfSame = (prev: AuthUser | null, next: AuthUser): AuthUser =>
  prev && prev.uid === next.uid && prev.email === next.email && prev.displayName === next.displayName ? prev : next;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isFirebaseConfigured ? 'loading' : 'unavailable');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    // Fires once with the stored user (or null), then on every sign-in and sign-out.
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? toAuthUser(u) : null);
      setStatus(u ? 'signedIn' : 'signedOut');
    });
  }, []);

  /** Turn a Firebase error into a friendly one; errors we threw ourselves already have friendly text. */
  const friendly = (e: unknown): Error =>
    typeof e === 'object' && e && 'code' in e ? new Error(friendlyAuthError(e)) : e instanceof Error ? e : new Error(friendlyAuthError(e));

  const run = useCallback(async (action: (auth: NonNullable<ReturnType<typeof getFirebaseAuth>>) => Promise<unknown>) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error(NOT_CONFIGURED);
    try {
      await action(auth);
    } catch (e) {
      throw friendly(e);
    }
  }, []);

  /** Run something for the signed-in user. */
  const runUser = useCallback(async (action: (user: User) => Promise<unknown>) => {
    const current = getFirebaseAuth()?.currentUser;
    if (!current) throw new Error('You are not signed in.');
    try {
      await action(current);
    } catch (e) {
      throw friendly(e);
    }
  }, []);

  const api = useMemo<AuthApi>(() => {
    /** Email and password changes are sensitive: Firebase wants the current password first. */
    const reauthenticate = async (current: User, password: string) => {
      if (!current.email) throw new Error('This account has no email address.');
      try {
        await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
      } catch (e) {
        if (isWrongCredential(e)) throw new Error('The current password is not correct.');
        throw e;
      }
    };

    return {
      status,
      user,
      configured: isFirebaseConfigured,
      signIn: (email, password) => run((auth) => signInWithEmailAndPassword(auth, email.trim(), password)),
      register: (email, password) => run((auth) => createUserWithEmailAndPassword(auth, email.trim(), password)),
      signOut: () => run((auth) => firebaseSignOut(auth)),
      resetPassword: (email) => run((auth) => sendPasswordResetEmail(auth, email.trim())),
      updateNickname: (nickname) =>
        runUser(async (current) => {
          await updateProfile(current, { displayName: normalizeNickname(nickname) });
          setUser((prev) => keepIfSame(prev, toAuthUser(current))); // onAuthStateChanged does not fire for profile edits
        }),
      changeEmail: (newEmail, currentPassword) =>
        runUser(async (current) => {
          await reauthenticate(current, currentPassword);
          await verifyBeforeUpdateEmail(current, newEmail.trim());
        }),
      changePassword: (currentPassword, newPassword) =>
        runUser(async (current) => {
          await reauthenticate(current, currentPassword);
          await updatePassword(current, newPassword);
        }),
      refreshUser: async () => {
        const current = getFirebaseAuth()?.currentUser;
        if (!current) return;
        try {
          await current.reload();
          setUser((prev) => keepIfSame(prev, toAuthUser(current)));
        } catch {
          // Offline or token expired: keep showing what we have.
        }
      },
    };
  }, [status, user, run, runUser]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
