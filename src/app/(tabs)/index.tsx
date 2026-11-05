import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getProvider, searchManga, usableProviderId, type Manga, type MangaType, type SortOrder } from '../../providers';
import { MangaCard } from '../../components/MangaCard';
import { ProgressBar, SectionHeader } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { contentRatings, isInLibrary, progressOf, useLibrary, useSettings, type LibraryEntry } from '../../store/library';
import { colors, radius, spacing } from '../../theme';

const SECTIONS: { key: string; title: string; subtitle: string; type: MangaType | 'all'; order: SortOrder }[] = [
  { key: 'manhwa', title: 'Popular Manhwa', subtitle: 'Korean webtoons everyone follows', type: 'manhwa', order: 'followedCount' },
  { key: 'manga', title: 'Popular Manga', subtitle: 'Japanese favourites', type: 'manga', order: 'followedCount' },
  { key: 'fresh', title: 'Freshly Updated', subtitle: 'New chapters just dropped', type: 'all', order: 'latestUploadedChapter' },
  { key: 'rated', title: 'Top Rated', subtitle: 'Highest community scores', type: 'all', order: 'rating' },
  { key: 'manhua', title: 'Popular Manhua', subtitle: 'Chinese comics', type: 'manhua', order: 'followedCount' },
];

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { state } = useLibrary();
  const provider = getProvider(usableProviderId(state.settings.provider, state.settings.showMature));
  const [refreshKey, setRefreshKey] = useState(0);

  const continueReading = useMemo(
    () =>
      Object.values(state.entries)
        .filter((e) => isInLibrary(e) && e.lastReadAt && e.lastChapterId && e.status !== 'completed')
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
        .slice(0, 10),
    [state.entries],
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => setRefreshKey((k) => k + 1)} tintColor={colors.accent} />
      }
    >
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Ionicons name="moon" size={22} color={colors.moon} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.appName}>ShadowMoon</Text>
          <Text style={styles.tagline}>Manga & Manhwa · no ads, ever</Text>
        </View>
        <Pressable onPress={() => router.push('/search')} hitSlop={12} style={styles.searchBtn}>
          <Ionicons name="search" size={20} color={colors.text} />
        </Pressable>
      </View>

      {continueReading.length > 0 && (
        <>
          <SectionHeader title="Continue Reading" subtitle="Pick up where you left off" />
          <FlatList
            horizontal
            data={continueReading}
            keyExtractor={(e) => e.id}
            renderItem={({ item }) => <ContinueCard entry={item} />}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
            showsHorizontalScrollIndicator={false}
          />
        </>
      )}

      {SECTIONS.filter(
        (s) => provider.sorts.includes(s.order) && (s.type === 'all' || provider.types.includes(s.type)),
      ).map((s) => (
        <DiscoverSection key={`${provider.id}-${s.key}`} section={s} refreshKey={refreshKey} />
      ))}

      <Text style={styles.credit}>Content provided by {provider.name}</Text>
    </ScrollView>
  );
}

function DiscoverSection({ section, refreshKey }: { section: (typeof SECTIONS)[number]; refreshKey: number }) {
  const [settings] = useSettings();
  const ratings = contentRatings(settings);
  const { data, loading, error, reload } = useAsync<Manga[]>(
    () =>
      searchManga({
        provider: usableProviderId(settings.provider, settings.showMature),
        type: section.type,
        order: section.order,
        language: settings.language,
        ratings,
        limit: 15,
      }).then((p) => p.items),
    [section.key, settings.provider, settings.language, settings.showMature, refreshKey],
  );

  return (
    <View>
      <SectionHeader
        title={section.title}
        subtitle={section.subtitle}
        right={
          <Pressable
            hitSlop={10}
            onPress={() => router.push({ pathname: '/search', params: { type: section.type, order: section.order } })}
          >
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        }
      />
      {loading ? (
        <View style={styles.placeholderRow}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <Pressable style={styles.placeholderRow} onPress={reload}>
          <Text style={{ color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xl }}>
            Couldn&apos;t load · tap to retry{'\n'}
            <Text style={{ fontSize: 12, color: colors.textDim }}>{error}</Text>
          </Text>
        </Pressable>
      ) : (
        <FlatList
          horizontal
          data={data}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MangaCard manga={item} width={118} />}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
          showsHorizontalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function ContinueCard({ entry }: { entry: LibraryEntry }) {
  const { percent, read, total } = progressOf(entry);
  return (
    <Pressable
      style={({ pressed }) => [styles.continueCard, pressed && { opacity: 0.8 }]}
      onPress={() =>
        router.push({ pathname: '/reader/[chapterId]', params: { chapterId: entry.lastChapterId!, mangaId: entry.id } })
      }
      onLongPress={() => router.push({ pathname: '/manga/[id]', params: { id: entry.id } })}
    >
      <Image source={entry.coverUrl || undefined} style={styles.continueCover} contentFit="cover" recyclingKey={entry.id} />
      <View style={{ flex: 1, justifyContent: 'space-between', paddingVertical: 2 }}>
        <View>
          <Text style={styles.continueTitle} numberOfLines={2}>{entry.title}</Text>
          <Text style={styles.continueMeta}>Last: {entry.lastChapterLabel}</Text>
        </View>
        <View>
          <View style={styles.continueRow}>
            <Ionicons name="play-circle" size={16} color={colors.accent} />
            <Text style={styles.continueAction}>Continue</Text>
            <Text style={styles.continuePercent}>{total > 0 ? `${percent}% · ${read}/${total}` : ''}</Text>
          </View>
          <ProgressBar percent={percent} style={{ marginTop: 6 }} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  appName: { color: colors.text, fontSize: 26, fontWeight: '900', letterSpacing: 0.3 },
  tagline: { color: colors.textMuted, fontSize: 13 },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeAll: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  placeholderRow: { height: 200, alignItems: 'center', justifyContent: 'center' },
  continueCard: {
    width: 290,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  continueCover: { width: 70, height: 100, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  continueTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  continueMeta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  continueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  continueAction: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  continuePercent: { color: colors.textMuted, fontSize: 12, marginLeft: 'auto' },
  credit: { color: colors.textDim, textAlign: 'center', fontSize: 12, marginTop: spacing.xl },
});
