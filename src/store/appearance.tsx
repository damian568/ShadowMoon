import React, { createContext, useContext, useEffect } from 'react';
import { Appearance } from 'react-native';

import { applyScheme, type Scheme } from '../theme';
import { useAuth } from './auth';
import { useLibrary } from './library';
import { schemeFor } from './reducer';

const Ctx = createContext<Scheme>('dark');

/**
 * Applies the Dark/Light scheme to the whole app: Always dark, except for a signed-in reader of Light Novels, who follows Settings → Appearance (saved with the account). Components call `useScheme()`, so
 * they re-render when it changes and pick up the new colours from `colors` (src/theme.ts).
 */
export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { state } = useLibrary();
  const auth = useAuth();
  // No account (signed out, or accounts not set up): always dark. While the sign-in state is still loading, trust the
  // saved choice so a signed-in reader does not see a flash of the wrong colours.
  const hasAccount = auth.status === 'signedIn' || auth.status === 'loading';
  const scheme = schemeFor(state.settings, hasAccount);
  applyScheme(scheme); // before the children render, so they already see the right colours

  // Native pieces (alerts, keyboard, action sheets) follow the same scheme.
  useEffect(() => {
    try {
      Appearance.setColorScheme(scheme);
    } catch {}
  }, [scheme]);

  return <Ctx.Provider value={scheme}>{children}</Ctx.Provider>;
}

/** The scheme in use. Call it in a component that uses colours, so the component re-renders when the scheme changes. */
export const useScheme = (): Scheme => useContext(Ctx);
