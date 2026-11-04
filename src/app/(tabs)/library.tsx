import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { MangaCard } from '../../components/MangaCard';
import { Button, Chip, EmptyState } from '../../components/ui';
import { isInLibrary, progressOf, useLibrary, type LibraryEntry, type ReadingStatus } from '../../store/library';
import { colors, radius, spacing, statusColors } from '../../theme';

type Filter = 'all' | 'favorite' | ReadingStatus;
type Sort = 'recent' | 'title' | 'progress' | 'added';

const FILTERS: { key: Filter; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string }[] = [
  { key: 'all', label: 'All', icon: 'albums', color: colors.accent },
  { key: 'favorite', label: 'Favourites', icon: 'heart', color: colors.favorite },
  { key: 'reading', label: 'Reading', icon: 'book', color: statusColors.reading },
  { key: 'completed', label: 'Done', icon: 'checkmark-done', color: statusColors.completed },
  { key: 'later', label: 'For later', icon: 'bookmark', color: statusColors.later },
];

const SORTS: { key: Sort; label: string }[] = [
  { key: 'recent', label: 'Recently read' },
  { key: 'progress', label: 'Progress' },
  { key: 'title', label: 'Title' },
  { key: 'added', label: 'Date added' },
];

const COLUMNS = 3;

export default function LibraryScreen() {
  const { state } = useLibrary();
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((width - spacing.lg * 2 - spacing.md * (COLUMNS - 1)) / COLUMNS);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');

  const all = useMemo(() => Object.values(state.entries).filter(isInLibrary), [state.entries]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, favorite: 0, reading: 0, completed: 0, later: 0 };
    for (const e of all) {
      if (e.favorite) c.favorite++;
      if (e.status) c[e.status]++;
    }
    return c;
  }, [all]);

  const stats = useMemo(() => {
    let read = 0;
    let total = 0;
    for (const e of all) {
      const p = progressOf(e);
      read += p.read;
      total += p.total;
    }
    return { read, total, percent: total ? Math.round((read / total) * 100) : 0 };
  }, [all]);

  const list = useMemo(() => {
    const filtered = all.filter((e) =>
      filter === 'all' ? true : filter === 'favorite' ? e.favorite : e.status === filter,
    );
    const by: Record<Sort, (a: LibraryEntry, b: LibraryEntry) => number> = {
      recent: (a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt),
      title: (a, b) => a.title.localeCompare(b.title),
      progress: (a, b) => progressOf(b).percent - progressOf(a).percent,
      added: (a, b) => b.addedAt - a.addedAt,
    };
    return filtered.sort(by[sort]);
  }, [all, filter, sort]);

  const cycleSort = () => setSort((s) => SORTS[(SORTS.findIndex((x) => x.key === s) + 1) % SORTS.length].key);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.statsCard}>
        <Stat value={String(all.length)} label="Titles" />
        <View style={styles.divider} />
        <Stat value={stats.read.toLocaleString()} label="Chapters read" />
        <View style={styles.divider} />
        <Stat value={`${stats.percent}%`} label="Overall" />
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              icon={f.icon}
              color={f.color}
              active={filter === f.key}
              count={counts[f.key]}
              onPress={() => setFilter(f.key)}
            />
          ))}
        </ScrollView>
      </View>

      <Pressable onPress={cycleSort} style={styles.sortRow} hitSlop={8}>
        <Ionicons name="swap-vertical" size={16} color={colors.textMuted} />
        <Text style={styles.sortText}>{SORTS.find((s) => s.key === sort)?.label}</Text>
      </Pressable>

      <FlatList
        data={list}
        keyExtractor={(e) => e.id}
        numColumns={COLUMNS}
        renderItem={({ item }) => <MangaCard manga={item} width={cardWidth} subtitle={subtitleFor(item)} />}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState
            icon={filter === 'favorite' ? 'heart-outline' : 'library-outline'}
            title={all.length ? 'Nothing here yet' : 'Your library is empty'}
            message={
              all.length
                ? 'Titles you mark with this status will show up here.'
                : 'Open any title and tap ♥ Favourite, Reading, Done or For later to add it.'
            }
            action={
              all.length ? null : (
                <Button label="Discover titles" icon="compass" onPress={() => router.push('/')} style={{ marginTop: spacing.lg }} />
              )
            }
          />
        }
      />
    </View>
  );
}

function subtitleFor(e: LibraryEntry): string {
  const { percent, read, total } = progressOf(e);
  if (total === 0) return read > 0 ? `${read} read` : 'Not started';
  if (read === 0) return `${total} chapters`;
  return `${percent}% · ${read}/${total}`;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statsCard: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  divider: { width: 1, backgroundColor: colors.border },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  chips: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    alignSelf: 'flex-start',
  },
  sortText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
});
