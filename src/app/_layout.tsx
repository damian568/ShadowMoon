import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';

import { AppearanceProvider, useScheme } from '../store/appearance';
import { AuthProvider } from '../store/auth';
import { LibraryProvider } from '../store/library';
import { UpdatesProvider } from '../store/updates';
import { SyncProvider } from '../sync/SyncProvider';
import { colors } from '../theme';

export default function RootLayout() {
  return (
    <AuthProvider>
      <LibraryProvider>
        <AppearanceProvider>
          <SyncProvider>
            <UpdatesProvider>
              <ThemedNavigator />
            </UpdatesProvider>
          </SyncProvider>
        </AppearanceProvider>
      </LibraryProvider>
    </AuthProvider>
  );
}

/** The navigator and its colours; it re-renders when the Dark/Light setting changes. */
function ThemedNavigator() {
  const scheme = useScheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.bg,
      card: colors.bg,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemeProvider value={theme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="manga/[id]" options={{ title: '', headerTransparent: true }} />
          <Stack.Screen
            name="reader/[chapterId]"
            options={{ headerShown: false, animation: 'fade', gestureEnabled: true }}
          />
          <Stack.Screen name="profile" options={{ title: 'Profile' }} />
          <Stack.Screen name="auth/login" options={{ title: 'Sign in', presentation: 'modal' }} />
          <Stack.Screen name="auth/register" options={{ title: 'Create account', presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </View>
  );
}
