/**
 * Signing out resets this phone to a fresh install, so the order of the steps matters:
 *
 *  1. Save any changes that have not reached the account yet. If that is not possible (offline, a server error)
 *     ask the user, because signing out would lose those changes.
 *  2. Sign out. If this fails, nothing has been cleared: the user is still signed in with everything intact.
 *  3. Only then clear the library and settings from the phone.
 *
 * Pure logic (no React, no Firebase) so it can be tested; see src/sync/useSignOut.ts for the screen side.
 */
export interface SignOutSteps {
  /** Upload pending changes. Resolves true when nothing unsaved remains. */
  flush: () => Promise<boolean>;
  /** Ask whether to sign out even though some changes could not be saved. */
  confirmLoss: () => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Clear the library and settings from this phone. */
  reset: () => void | Promise<void>;
}

export type SignOutResult = 'signed-out' | 'cancelled';

export async function signOutSafely(steps: SignOutSteps): Promise<SignOutResult> {
  let saved = false;
  try {
    saved = await steps.flush();
  } catch {
    saved = false;
  }
  if (!saved && !(await steps.confirmLoss())) return 'cancelled';

  await steps.signOut(); // throws on failure, which leaves the phone untouched
  await steps.reset();
  return 'signed-out';
}
