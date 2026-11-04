import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { Button, EmptyState, ProgressBar } from '../../components/ui';
import { isInLibrary, progressOf, useLibrary, type LibraryEntry } from '../../store/library';
import { useUpdates } from '../../store/updates';
import { colors, radius, spacing, statusColors, statusLabels } from '../../theme';
import { timeAgo } from '../../utils/time';

const RECENT_DAYS = 14;

export default function UpdatesScreen() {
  const { state, clearNew } = useLibrary();
  const { checking, progress, error, checkNow } = useUpdates();

  // "Now" is read outside of render (rendering must be pure) and refreshed each time the tab is shown.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
    }, []),
  );

  const sections = useMemo(() => {
    const lib = Object.values(state.entries).filter(isInLibrary);
    const fresh = lib.filter((e) => e.newChapters > 0).sort((a, b) => (b.lastUpdateFoundAt ?? 0) - (a.lastUpdateFoundAt ?? 0));
    const cutoff = now - RECENT_DAYS * 24 * 3600 * 1000;
    const recent = lib
      .filter((e) => e.newChapters === 0 && e.latestChapterAt && Date.parse(e.latestChapterAt) > cutoff)
      .sort((a, b) => Date.parse(b.latestChapterAt!) - Date.parse(a.latestChapterAt!));
    const out: { title: string; key: string; data: LibraryEntry[] }[] = [];
    if (fresh.length) out.push({ title: 'New chapters', key: 'new', data: fresh });
    if (recent.length) out.push({ title: `Updated in the last ${RECENT_DAYS} days`, key: 'recent', data: recent });
    return out;
  }, [state.entries, now]);

  const libraryCount = useMemo(() => Object.values(state.entries).filter(isInLibrary).length, [state.entries]);
  const hasNew = sections.some((s) => s.key === 'new');

  return (
    <SectionList
      style={{ flex: 1, backgroundColor: colors.bg }}
      sections={sections}
      keyExtractor={(e) => e.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ paddingBottom: spacing.xl, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={checkNow} tintColor={colors.accent} />}
      ListHeaderComponent={
        <View style={styles.statusCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>
              {checking
                ? progress && progress.total > 0
                  ? `Checking ${progress.done}/${progress.total}…`
                  : 'Checking for updates…'
                : 'Chapter updates'}
            </Text>
            <Text style={styles.statusSub}>
              {error
                ? `⚠︎ ${error}`
                : state.lastUpdateCheck
                  ? `Last checked ${timeAgo(state.lastUpdateCheck)} · ${libraryCount} titles tracked`
                  : `${libraryCount} titles tracked`}
            </Text>
            {checking && progress && progress.total > 0 && (
              <ProgressBar percent={(progress.done / progress.total) * 100} style={{ marginTop: spacing.sm }} />
            )}
          </View>
          <Pressable onPress={checkNow} disabled={checking} style={styles.refreshBtn} hitSlop={8}>
            <Ionicons name="refresh" size={20} color={checking ? colors.textDim : colors.accent} />
          </Pressable>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.key === 'new' && hasNew && (
            <Pressable onPress={() => clearNew()} hitSlop={8}>
              <Text style={styles.markSeen}>Mark all seen</Text>
            </Pressable>
          )}
        </View>
      )}
      renderItem={({ item }) => <UpdateRow entry={item} />}
      ListEmptyComponent={
        <EmptyState
          icon="notifications-outline"
          title={libraryCount ? 'You are all caught up' : 'No titles tracked yet'}
          message={
            libraryCount
              ? 'ShadowMoon checks MangaDex for new chapters whenever you open the app. Pull down to check now.'
              : 'Add titles to your library and new chapters will show up here.'
          }
          action={
            libraryCount ? (
              <Button label="Check now" icon="refresh" onPress={checkNow} loading={checking} style={{ marginTop: spacing.lg }} />
            ) : null
          }
        />
      }
    />
  );
}

function UpdateRow({ entry }: { entry: LibraryEntry }) {
  const { percent, read, total } = progressOf(entry);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/manga/[id]', params: { id: entry.id } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <Image source={entry.coverUrl || undefined} style={styles.cover} contentFit="cover" recyclingKey={entry.id} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={2}>{entry.title}</Text>
        <View style={styles.metaRow}>
          {entry.newChapters > 0 && (
            <View style={styles.newPill}>
              <Text style={styles.newPillText}>+{entry.newChapters} new</Text>
            </View>
          )}
          <Text style={styles.meta}>
            {entry.latestChapterLabel ?? ''}
            {entry.latestChapterAt ? ` · ${timeAgo(Date.parse(entry.latestChapterAt))}` : ''}
          </Text>
        </View>
        <View style={styles.progressRow}>
          <ProgressBar percent={percent} style={{ flex: 1 }} color={entry.status ? statusColors[entry.status] : colors.accent} />
          <Text style={styles.percent}>{total ? `${percent}% · ${read}/${total}` : '—'}</Text>
        </View>
        {entry.status && <Text style={[styles.status, { color: statusColors[entry.status] }]}>{statusLabels[entry.status]}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  statusTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  statusSub: { color: colors.textMuted, fontSize: 13, marginTop: 3 },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  markSeen: { color: colors.accent, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cover: { width: 64, height: 92, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  newPill: { backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  newPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 8 },
  percent: { color: colors.textMuted, fontSize: 12, minWidth: 70, textAlign: 'right' },
  status: { fontSize: 11, fontWeight: '700', marginTop: 4 },
});
