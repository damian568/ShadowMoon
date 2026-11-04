import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { router } from 'expo-router';

import { Chip, SourceIcon } from '../../components/ui';
import { getProvider, listProviders } from '../../providers';
import { useAuth } from '../../store/auth';
import { useLibrary, type ReaderMode } from '../../store/library';
import { useSync, type SyncApi } from '../../sync/SyncProvider';
import { timeAgo } from '../../utils/time';
import { colors, radius, spacing } from '../../theme';

const READER_MODES: { key: ReaderMode; label: string; hint: string }[] = [
  { key: 'auto', label: 'Auto', hint: 'Vertical scroll for manhwa/manhua, page-by-page (right-to-left) for manga.' },
  { key: 'vertical', label: 'Vertical scroll', hint: 'Always scroll pages top to bottom (webtoon style).' },
  { key: 'paged', label: 'Paged', hint: 'Always swipe page by page, right-to-left. Pinch to zoom.' },
];

const UPDATE_INTERVALS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 180, label: '3 hours' },
  { minutes: 0, label: 'Manual' },
];

export default function SettingsScreen() {
  const { state, updateSettings, resetLibrary } = useLibrary();
  const auth = useAuth();
  const sync = useSync();
  const s = state.settings;

  const confirmSignOut = () =>
    Alert.alert(
      'Sign out?',
      'Your library stays on this phone and stops syncing. Signing in again with the same account picks up where you left off. Signing in with a different account replaces this phone’s library with that account’s.',
      [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => auth.signOut().catch((e: Error) => Alert.alert('Could not sign out', e.message)),
      },
    ]);

  const confirmReset = () =>
    Alert.alert('Reset library?', 'This removes all favourites, lists and reading progress from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetLibrary },
    ]);

  const clearCache = async () => {
    await Image.clearDiskCache();
    await Image.clearMemoryCache();
    Alert.alert('Done', 'Image cache cleared.');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
      <Group title="Account">
        {auth.status === 'signedIn' ? (
          <>
            <Row icon="person-circle-outline" title={auth.user?.email ?? 'Signed in'} subtitle="Signed in" />
            <Row
              icon={sync.status === 'error' ? 'cloud-offline-outline' : 'cloud-done-outline'}
              title="Library sync"
              subtitle={syncSubtitle(sync)}
              onPress={() => sync.syncNow()}
            />
            <Row icon="log-out-outline" title="Sign out" onPress={confirmSignOut} />
          </>
        ) : (
          <>
            <Row
              icon="log-in-outline"
              title="Sign in"
              subtitle="Get your favourites and reading progress on this phone."
              onPress={() => router.push('/auth/login')}
            />
            <Row icon="person-add-outline" title="Create an account" onPress={() => router.push('/auth/register')} />
          </>
        )}
      </Group>

      <Group title="Reading">
        <Text style={styles.label}>Reader mode</Text>
        <View style={styles.chipWrap}>
          {READER_MODES.map((m) => (
            <Chip key={m.key} label={m.label} active={s.readerMode === m.key} onPress={() => updateSettings({ readerMode: m.key })} />
          ))}
        </View>
        <Text style={styles.hint}>{READER_MODES.find((m) => m.key === s.readerMode)?.hint}</Text>

        <Row
          icon="cellular-outline"
          title="Data saver"
          subtitle="Load compressed images — faster on mobile data."
          right={<Switch value={s.dataSaver} onValueChange={(v) => updateSettings({ dataSaver: v })} trackColor={{ true: colors.accentStrong }} />}
        />
      </Group>

      {listProviders().length > 1 && (
        <Group title="Source">
          <View style={styles.chipWrap}>
            {listProviders().map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                leading={<SourceIcon name={p.name} iconUrl={p.iconUrl} />}
                active={s.provider === p.id}
                onPress={() => updateSettings({ provider: p.id })}
              />
            ))}
          </View>
          <Text style={styles.hint}>{getProvider(s.provider).description} Your library keeps titles from every source.</Text>
        </Group>
      )}

      <Group title="Chapter language">
        <View style={styles.chipWrap}>
          {getProvider(s.provider).languages.map((l) => (
            <Chip key={l.code} label={l.label} active={s.language === l.code} onPress={() => updateSettings({ language: l.code })} />
          ))}
        </View>
        <Text style={styles.hint}>Only titles with chapters translated into this language are shown.</Text>
      </Group>

      <Group title="Updates">
        <Text style={styles.label}>Check for new chapters every</Text>
        <View style={styles.chipWrap}>
          {UPDATE_INTERVALS.map((u) => (
            <Chip
              key={u.minutes}
              label={u.label}
              active={s.autoUpdateMinutes === u.minutes}
              onPress={() => updateSettings({ autoUpdateMinutes: u.minutes })}
            />
          ))}
        </View>
        <Text style={styles.hint}>Checks run when you open ShadowMoon or return to it. Pull down on the Updates tab to check any time.</Text>
      </Group>

      <Group title="Content">
        <Row
          icon="eye-off-outline"
          title="Show mature titles"
          subtitle="Include titles rated erotica in Discover and Search."
          right={<Switch value={s.showMature} onValueChange={(v) => updateSettings({ showMature: v })} trackColor={{ true: colors.accentStrong }} />}
        />
      </Group>

      <Group title="Storage">
        <Row icon="images-outline" title="Clear image cache" onPress={clearCache} />
        <Row icon="trash-outline" title="Reset library & progress" danger onPress={confirmReset} />
      </Group>

      <Group title="About">
        <Row
          icon="globe-outline"
          title="Content source: MangaDex"
          subtitle="Free, community-run and ad-free. Consider supporting the scanlation groups."
          onPress={() => WebBrowser.openBrowserAsync('https://mangadex.org')}
        />
        <Row icon="moon-outline" title="ShadowMoon" subtitle={`Version ${Constants.expoConfig?.version ?? '1.0.0'} · no ads, no tracking`} />
      </Group>
    </ScrollView>
  );
}

function syncSubtitle(sync: SyncApi): string {
  if (sync.status === 'syncing') return 'Syncing…';
  if (sync.status === 'error') return `Could not sync (${sync.error ?? 'unknown error'}). Tap to try again.`;
  return sync.lastSyncedAt ? `Up to date · ${timeAgo(sync.lastSyncedAt)}. Tap to sync now.` : 'Tap to sync now.';
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function Row({ icon, title, subtitle, right, onPress, danger }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, danger && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textDim} /> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  groupTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  label: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 16 },
});
