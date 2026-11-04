import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';

import { AuthProvider } from '../store/auth';
import { LibraryProvider } from '../store/library';
import { UpdatesProvider } from '../store/updates';
import { SyncProvider } from '../sync/SyncProvider';
import { colors } from '../theme';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
};

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemeProvider value={theme}>
        <AuthProvider>
          <LibraryProvider>
            <SyncProvider>
              <UpdatesProvider>
                <StatusBar style="light" />
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
                  <Stack.Screen name="auth/login" options={{ title: 'Sign in', presentation: 'modal' }} />
                  <Stack.Screen name="auth/register" options={{ title: 'Create account', presentation: 'modal' }} />
                </Stack>
              </UpdatesProvider>
            </SyncProvider>
          </LibraryProvider>
        </AuthProvider>
      </ThemeProvider>
    </View>
  );
}
