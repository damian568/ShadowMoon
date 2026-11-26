import Ionicons from '@expo/vector-icons/Ionicons';
import * as Updates from 'expo-updates';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useScheme } from '../store/appearance';
import { colors, themedStyles } from '../theme';
import { describeUpdate } from '../utils/appUpdate';
import { snapshotFrom, UpdateProgress } from './UpdateProgress';

/**
 * Checks for a new version of the app when it starts. If one is found, a full screen shows it downloading with a
 * progress bar, then the app restarts into the new version by itself. "Skip for now" keeps using the current version
 * (the download finishes in the background and is used the next time the app opens).
 * Nothing happens in Expo Go, while developing or on the web, where the app cannot update itself.
 */
export function UpdateOverlay() {
  if (Platform.OS === 'web') return null;
  return <LaunchUpdate />;
}

function LaunchUpdate() {
  useScheme();
  const u = Updates.useUpdates();
  const [launching, setLaunching] = useState(Updates.isEnabled);
  const skipped = useRef(false);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    let alive = true;
    (async () => {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (check.isAvailable) {
          await Updates.fetchUpdateAsync();
          if (!skipped.current) await Updates.reloadAsync(); // restarts into the new version; nothing after this runs
        }
      } catch {
        // The "App updates" screen shows the reason; the app simply carries on with the version it has.
      }
      if (alive && !skipped.current) setLaunching(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The library may already have downloaded the update by itself while the app was starting.
  useEffect(() => {
    if (launching && u.isUpdatePending && !skipped.current) Updates.reloadAsync().catch(() => setLaunching(false));
  }, [launching, u.isUpdatePending]);

  const visible = launching && (u.isDownloading || u.isUpdatePending || u.isRestarting);
  if (!visible) return null;

  const view = describeUpdate(snapshotFrom(u));
  return (
    <View style={styles.cover} accessibilityViewIsModal>
      <View style={styles.card}>
        <Ionicons name="cloud-download-outline" size={56} color={colors.accent} />
        <UpdateProgress view={view} />
        <Pressable
          onPress={() => {
            skipped.current = true;
            setLaunching(false);
          }}
          hitSlop={12}
          disabled={u.isRestarting}
        >
          <Text style={styles.skip}>Skip for now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: { alignSelf: 'stretch', alignItems: 'center', gap: 24, maxWidth: 420, width: '100%' },
  skip: { color: colors.textMuted, fontSize: 14, fontWeight: '600', paddingVertical: 6 },
}));
