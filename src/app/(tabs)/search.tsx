import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  getProvider,
  searchAll,
  searchManga,
  splitId,
  usableProviderId,
  visibleProviders,
  type Manga,
  type MangaType,
  type MultiSearchState,
  type SortOrder,
} from '../../providers';
import { externalSites } from '../../providers/external';
import { MangaCard } from '../../components/MangaCard';
import { Chip, EmptyState, ErrorView, SourceIcon } from '../../components/ui';
import { contentRatings, useSettings } from '../../store/library';
import { colors, radius, spacing } from '../../theme';

const TYPES: { key: MangaType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'manhwa', label: 'Manhwa' },
  { key: 'manga', label: 'Manga' },
  { key: 'manhua', label: 'Manhua' },
];

const ORDERS: { key: SortOrder; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'followedCount', label: 'Popular', icon: 'flame' },
  { key: 'latestUploadedChapter', label: 'Updated', icon: 'time' },
  { key: 'rating', label: 'Top rated', icon: 'star' },
  { key: 'createdAt', label: 'New', icon: 'sparkles' },
];

const COLUMNS = 3;
const PAGE = 30;

export default function SearchScreen() {
  const params = useLocalSearchParams<{ type?: string; order?: string; q?: string; n?: string }>();
  const [settings] = useSettings();
  // 'all' searches every source at once when you type a title; browsing (no title) uses your chosen source.
  const [chosenSource, setSource] = useState<string>('all');
  // 18+ sources are left out entirely while "Show mature titles" is off.
  const sources = visibleProviders(settings.showMature);
  const source = chosenSource === 'all' || sources.some((p) => p.id === chosenSource) ? chosenSource : 'all';
  const provider = getProvider(source === 'all' ? usableProviderId(settings.provider, settings.showMature) : source);
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((width - spacing.lg * 2 - spacing.md * (COLUMNS - 1)) / COLUMNS);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<MangaType | 'all'>('all');
  const [order, setOrder] = useState<SortOrder>('followedCount');
  const [items, setItems] = useState<Manga[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const multiState = useRef<MultiSearchState | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // "All sources" + a title: one row per source (source name on top, its titles in a line below).
  const grouped = source === 'all' && !!debounced;
  const groups = useMemo(() => {
    if (!grouped) return [];
    return sources
      .map((p) => ({ id: p.id, name: p.name, iconUrl: p.iconUrl, items: items.filter((m) => splitId(m.id).provider.id === p.id) }))
      .filter((g) => g.items.length > 0);
  }, [grouped, items, sources]);

  // Allow Discover's "See all" to preset filters. This adjusts state while rendering (React's recommended way
  // to react to a changed prop), which also applies the preset on the very first render.
  const [appliedParams, setAppliedParams] = useState<{ type?: string; order?: string; n?: string }>({});
  if (appliedParams.type !== params.type || appliedParams.order !== params.order || appliedParams.n !== params.n) {
    setAppliedParams({ type: params.type, order: params.order, n: params.n });
    // "Search in app" (long-press on a title): type the title in and search every source right away.
    if (params.q && params.n !== appliedParams.n) {
      setQuery(params.q);
      setDebounced(params.q.trim());
      setSource('all');
      setType('all');
    }
    if (params.type && TYPES.some((t) => t.key === params.type)) setType(params.type as MangaType | 'all');
    if (params.order && ORDERS.some((o) => o.key === params.order)) setOrder(params.order as SortOrder);
  }

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(
    async (offset: number) => {
      const id = ++requestId.current;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const base = {
          title: debounced || undefined,
          type,
          order: debounced ? ('relevance' as SortOrder) : order,
          language: settings.language,
          ratings: contentRatings(settings),
          limit: PAGE,
        };
        let pageItems: Manga[];
        if (source === 'all' && debounced) {
          // Search every source at once and merge the results.
          if (offset === 0) multiState.current = undefined;
          const res = await searchAll({ ...base, offset: 0 }, multiState.current);
          if (id !== requestId.current) return;
          multiState.current = res.state;
          pageItems = res.items;
          setHasMore(res.hasMore);
          setTotal(0);
        } else {
          const page = await searchManga({ ...base, provider: source === 'all' ? usableProviderId(settings.provider, settings.showMature) : source, offset });
          if (id !== requestId.current) return;
          pageItems = page.items;
          setHasMore(offset + page.items.length < page.total);
          setTotal(page.total);
        }
        setItems((prev) => {
          if (offset === 0) return pageItems;
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...pageItems.filter((m) => !seen.has(m.id))];
        });
      } catch (e: any) {
        if (id === requestId.current) setError(e?.message ?? 'Search failed');
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debounced, type, order, settings, source],
  );

  // Start (or restart) the search whenever a filter changes. It begins on the next tick, so the loading state
  // is not set synchronously inside the effect; a newer change cancels a search that has not started yet.
  useEffect(() => {
    const t = setTimeout(() => load(0), 0);
    return () => clearTimeout(t);
  }, [load]);

  const onEndReached = () => {
    if (!loading && !loadingMore && hasMore && items.length < 9900) load(items.length);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search manga, manhwa, manhua…"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onSubmitEditing={() => Keyboard.dismiss()}
        />
      </View>

      <View>
        {sources.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingBottom: 0 }]}>
            <Chip label="All sources" icon="globe-outline" active={source === 'all'} color={colors.moon} onPress={() => setSource('all')} />
            {sources.map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                leading={<SourceIcon name={p.name} iconUrl={p.iconUrl} />}
                active={source === p.id}
                color={colors.moon}
                onPress={() => setSource(p.id)}
              />
            ))}
          </ScrollView>
        )}
        {externalSites.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingBottom: 0 }]}>
            {externalSites.map((site) => (
              <Chip
                key={site.id}
                label={debounced && site.searchUrl ? `Search “${debounced}” on ${site.name}` : `Open ${site.name}`}
                leading={<SourceIcon name={site.name} iconUrl={site.iconUrl} />}
                icon="open-outline"
                color={colors.moon}
                onPress={() =>
                  WebBrowser.openBrowserAsync(debounced && site.searchUrl ? site.searchUrl(debounced) : site.homeUrl).catch(() => {})
                }
              />
            ))}
          </ScrollView>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {TYPES.filter((t) => t.key === 'all' || provider.types.includes(t.key as MangaType)).map((t) => (
            <Chip key={t.key} label={t.label} active={type === t.key} onPress={() => setType(t.key)} />
          ))}
        </ScrollView>
        {!debounced && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingTop: 0 }]}>
            {ORDERS.filter((o) => provider.sorts.includes(o.key)).map((o) => (
              <Chip
                key={o.key}
                label={o.label}
                icon={o.icon}
                active={order === o.key}
                color={colors.moon}
                onPress={() => setOrder(o.key)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} size="large" />
      ) : error && items.length === 0 ? (
        <ErrorView message={error} onRetry={() => load(0)} />
      ) : (
        <FlatList
          key={grouped ? 'grouped' : 'grid'} // numColumns can't change on a live list
          data={(grouped ? groups : items) as any[]}
          keyExtractor={(x: any) => x.id}
          numColumns={grouped ? 1 : COLUMNS}
          renderItem={({ item }: { item: any }) =>
            grouped ? (
              <View>
                <View style={styles.groupHeader}>
                  <SourceIcon name={item.name} iconUrl={item.iconUrl} size={22} />
                  <Text style={styles.groupTitle}>{item.name}</Text>
                  <Text style={styles.groupCount}>{item.items.length}</Text>
                </View>
                <FlatList
                  horizontal
                  data={item.items as Manga[]}
                  keyExtractor={(m) => m.id}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
                  renderItem={({ item: m }) => <MangaCard manga={m} width={cardWidth} />}
                />
              </View>
            ) : (
              <MangaCard manga={item} width={cardWidth} />
            )
          }
          columnWrapperStyle={grouped ? undefined : { gap: spacing.md, paddingHorizontal: spacing.lg }}
          contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl, paddingTop: spacing.sm }}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            debounced ? (
              <Text style={styles.resultCount}>
                {source === 'all'
                  ? `${items.length}${hasMore ? '+' : ''} result${items.length === 1 ? '' : 's'} for “${debounced}” from all sources`
                  : `${total.toLocaleString()} result${total === 1 ? '' : 's'} for “${debounced}”`}
              </Text>
            ) : undefined
          }
          ListEmptyComponent={
            <EmptyState icon="planet-outline" title="Nothing found" message="Try a different title or remove filters." />
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ margin: spacing.lg }} /> : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  input: { flex: 1, color: colors.text, fontSize: 16, height: '100%' },
  chips: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  resultCount: { color: colors.textMuted, paddingHorizontal: spacing.lg, fontSize: 13 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  groupTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  groupCount: { color: colors.textMuted, fontSize: 13 },
});
