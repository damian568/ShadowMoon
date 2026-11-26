import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import React, { useCallback } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UpdateProgress, snapshotFrom } from '../components/UpdateProgress';
import { Button } from '../components/ui';
import { useScheme } from '../store/appearance';
import { colors, radius, spacing, themedStyles } from '../theme';
import { describeUpdate } from '../utils/appUpdate';

/** Settings → App updates: check for a new version by hand and watch it download. */
export default function AppUpdateScreen() {
  useScheme();
  // The update library does not exist on the web, so there is nothing to show or check.
  return Platform.OS === 'web' ? <Unavailable /> : <Body />;
}

function Unavailable() {
  useScheme();
  return (
    <View style={[styles.root, { justifyContent: 'center' }]}>
      <UpdateProgress view={describeUpdate({ enabled: false, checking: false, downloading: false, available: false, pending: false, restarting: false, checked: false })} />
    </View>
  );
}

function Body() {
  useScheme();
  const u = Updates.useUpdates();
  const view = describeUpdate(snapshotFrom(u));
  const busy = u.isChecking || u.isDownloading || u.isRestarting;

  const check = useCallback(async () => {
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) await Updates.fetchUpdateAsync();
    } catch {
      // the library reports the reason through its state, which the screen already shows
    }
  }, []);
  const restart = useCallback(() => {
    Updates.reloadAsync().catch(() => {});
  }, []);

  const info: [string, string][] = [
    ['Version', Constants.expoConfig?.version ?? '1.0.0'],
    ['Update', Updates.updateId ? Updates.updateId.slice(0, 8) : 'Built into the app'],
    ['Channel', Updates.channel ?? '—'],
    ['Published', Updates.createdAt ? Updates.createdAt.toLocaleString() : '—'],
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Ionicons name={view.phase === 'upToDate' ? 'checkmark-circle-outline' : 'cloud-download-outline'} size={56} color={view.phase === 'error' ? colors.danger : colors.accent} />
        <UpdateProgress view={view} />
      </View>

      {Updates.isEnabled &&
        (view.phase === 'ready' ? (
          <Button label="Restart now" icon="refresh" onPress={restart} />
        ) : (
          <Button label="Check for updates" icon="cloud-download-outline" onPress={check} loading={busy} disabled={busy} />
        ))}

      <View style={styles.card}>
        {info.map(([label, value], i) => (
          <View key={label} style={[styles.infoRow, i > 0 && styles.infoBorder]}>
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.hint}>
        The app also checks for a new version each time it opens. If one is found, it downloads here and the app restarts by itself.
      </Text>
    </ScrollView>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, padding: spacing.md },
  infoBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  infoLabel: { color: colors.textMuted, fontSize: 14 },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  hint: { color: colors.textDim, fontSize: 13, lineHeight: 18, textAlign: 'center' },
}));
