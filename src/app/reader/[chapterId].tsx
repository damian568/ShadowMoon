import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type ListViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  chapterLabel,
  getChapterPages,
  getChaptersCached,
  getMangaCached,
  isReadable,
  kindOfId,
  type Chapter,
} from '../../providers';
import { NovelReader } from '../../components/NovelReader';
import { Button, ErrorView, Loading } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { toLite, useLibrary } from '../../store/library';
import { colors as appColors, darkColors as colors, radius, spacing } from '../../theme';

type Mode = 'vertical' | 'paged';

const VIEWABILITY = { itemVisiblePercentThreshold: 10 };

export default function ReaderScreen() {
  const { chapterId, mangaId } = useLocalSearchParams<{ chapterId: string; mangaId: string }>();
  // Fresh reader state for every chapter (page index, read marker, loaded data).
  // Light novels are text, so they get their own reader.
  if (kindOfId(mangaId) === 'novel') return <NovelReader key={chapterId} chapterId={chapterId} mangaId={mangaId} />;
  return <Reader key={chapterId} chapterId={chapterId} mangaId={mangaId} />;
}

function Reader({ chapterId, mangaId }: { chapterId: string; mangaId: string }) {
  const lib = useLibrary();
  const { language, dataSaver, readerMode } = lib.state.settings;
  const insets = useSafeAreaInsets();
  const [pageToken, setPageToken] = useState(0);

  const q = useAsync(async () => {
    const [manga, pages] = await Promise.all([getMangaCached(mangaId), getChapterPages(mangaId, chapterId, dataSaver)]);
    const chapters = await getChaptersCached(manga, language);
    return { manga, chapters, pages };
  }, [chapterId, mangaId, language, dataSaver]);

  // The image server URL expires after a while; re-request it if images start failing.
  // Remember which chapter the refreshed pages belong to, so they are ignored automatically after navigating.
  const [fresh, setFresh] = useState<{ chapterId: string; pages: string[] } | null>(null);
  const freshPages = fresh?.chapterId === chapterId ? fresh.pages : null;
  const refreshPages = useCallback(async () => {
    try {
      setFresh({ chapterId, pages: await getChapterPages(mangaId, chapterId, dataSaver) });
      setPageToken((t) => t + 1);
    } catch {}
  }, [mangaId, chapterId, dataSaver]);

  const manga = q.data?.manga;
  const chapters = q.data?.chapters;
  const pages = freshPages ?? q.data?.pages ?? [];
  const index = chapters?.findIndex((c) => c.id === chapterId) ?? -1;
  const chapter: Chapter | undefined = index >= 0 ? chapters![index] : undefined;
  const prev = index > 0 ? chapters![index - 1] : undefined;
  const next = chapters && index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : undefined;

  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const mode: Mode =
    modeOverride ?? (readerMode === 'auto' ? (manga?.type === 'manga' ? 'paged' : 'vertical') : readerMode);

  const [uiVisible, setUiVisible] = useState(true);
  const [page, setPage] = useState(0);
  const toggleUi = useCallback(() => setUiVisible((v) => !v), []);

  // Record "currently reading" as soon as we know which chapter this is.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (manga && chapter && opened.current !== chapter.id) {
      opened.current = chapter.id;
      lib.openChapter(toLite(manga), chapter);
    }
  }, [manga, chapter, lib]);

  // Mark as read when the last page is reached.
  const markedRead = useRef<string | null>(null);
  const onReachedEnd = useCallback(() => {
    if (!manga || !chapter || markedRead.current === chapter.id) return;
    markedRead.current = chapter.id;
    const lite = toLite(manga);
    // The store marks the title "Done" automatically once every chapter has been read.
    lib.setRead(lite, [chapter.key], true);
  }, [manga, chapter, lib]);

  useEffect(() => {
    if (pages.length > 0 && page >= pages.length - 1) onReachedEnd();
  }, [page, pages.length, onReachedEnd]);

  const goTo = useCallback(
    async (c: Chapter | undefined) => {
      if (!c) return;
      if (isReadable(c)) {
        router.replace({ pathname: '/reader/[chapterId]', params: { chapterId: c.id, mangaId } });
      } else if (c.externalUrl) {
        if (manga) lib.openChapter(toLite(manga), c);
        await WebBrowser.openBrowserAsync(c.externalUrl, { controlsColor: colors.accent });
      }
    },
    [mangaId, manga, lib],
  );

  if (q.loading && !q.data) {
    return (
      <View style={[styles.root, { backgroundColor: appColors.bg }]}>
        <StatusBar hidden />
        <Loading label="Loading pages…" />
        <CloseButton top={insets.top} />
      </View>
    );
  }
  if (q.error && !q.data) {
    return (
      <View style={[styles.root, { backgroundColor: appColors.bg }]}>
        <ErrorView message={q.error} onRetry={q.reload} />
        <CloseButton top={insets.top} />
      </View>
    );
  }
  if (!manga) return null;

  const endCard = (
    <EndCard
      chapter={chapter}
      next={next}
      onNext={() => goTo(next)}
      onDetails={() => router.back()}
      mangaTitle={manga.title}
    />
  );

  return (
    <View style={styles.root}>
      <StatusBar hidden={!uiVisible} style="light" />
      {pages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={styles.noPages}>This chapter has no pages on MangaDex.</Text>
          {endCard}
        </View>
      ) : mode === 'vertical' ? (
        <VerticalReader
          key={`v-${chapterId}-${pageToken}`}
          pages={pages}
          onTap={toggleUi}
          onPage={setPage}
          onImageError={refreshPages}
          footer={endCard}
        />
      ) : (
        <PagedReader
          key={`p-${chapterId}-${pageToken}`}
          pages={pages}
          onTap={toggleUi}
          onPage={setPage}
          onImageError={refreshPages}
          endCard={endCard}
        />
      )}

      {uiVisible && (
        <>
          <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.topTitle} numberOfLines={1}>{manga.title}</Text>
              <Text style={styles.topSub} numberOfLines={1}>
                {chapter ? chapterLabel(chapter, true) : 'Chapter'}
              </Text>
            </View>
            <Pressable
              onPress={() => setModeOverride(mode === 'vertical' ? 'paged' : 'vertical')}
              hitSlop={12}
              style={styles.iconBtn}
            >
              <Ionicons name={mode === 'vertical' ? 'swap-vertical' : 'swap-horizontal'} size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
            <Pressable onPress={() => goTo(prev)} disabled={!prev} style={[styles.navBtn, !prev && { opacity: 0.35 }]}>
              <Ionicons name="play-skip-back" size={18} color={colors.text} />
              <Text style={styles.navText}>Prev</Text>
            </Pressable>
            <Text style={styles.pageText}>
              {pages.length ? `${Math.min(page + 1, pages.length)} / ${pages.length}` : '—'}
            </Text>
            <Pressable onPress={() => goTo(next)} disabled={!next} style={[styles.navBtn, !next && { opacity: 0.35 }]}>
              <Text style={styles.navText}>Next</Text>
              <Ionicons name="play-skip-forward" size={18} color={colors.text} />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Vertical (webtoon) reader
// ---------------------------------------------------------------------------

function VerticalReader({ pages, onTap, onPage, onImageError, footer }: {
  pages: string[];
  onTap: () => void;
  onPage: (i: number) => void;
  onImageError: () => void;
  footer: React.ReactElement;
}) {
  const { width } = useWindowDimensions();
  const [ratios, setRatios] = useState<Record<number, number>>({});

  const onLoad = useCallback((i: number, w: number, h: number) => {
    if (!w || !h) return;
    setRatios((r) => (r[i] === h / w ? r : { ...r, [i]: h / w }));
  }, []);

  // FlatList needs a permanent onViewableItemsChanged, so it reads the latest onPage through a ref.
  const onPageRef = useRef(onPage);
  useEffect(() => {
    onPageRef.current = onPage;
  });
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const last = viewableItems[viewableItems.length - 1];
    if (last?.index != null) onPageRef.current(last.index);
  });

  return (
    <FlatList
      data={pages}
      keyExtractor={(u, i) => `${i}-${u}`}
      extraData={ratios}
      renderItem={({ item, index }) => (
        <VerticalPage
          url={item}
          index={index}
          width={width}
          ratio={ratios[index]}
          onLoad={onLoad}
          onTap={onTap}
          onError={onImageError}
        />
      )}
      ListFooterComponent={footer}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={VIEWABILITY}
      initialNumToRender={3}
      maxToRenderPerBatch={3}
      windowSize={9}
      showsVerticalScrollIndicator={false}
    />
  );
}

const VerticalPage = memo(function VerticalPage({ url, index, width, ratio, onLoad, onTap, onError }: {
  url: string;
  index: number;
  width: number;
  ratio?: number;
  onLoad: (i: number, w: number, h: number) => void;
  onTap: () => void;
  onError: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const height = width * (ratio ?? 1.45);
  return (
    <Pressable onPress={onTap} style={{ width, height, backgroundColor: '#000' }}>
      {!ratio && !failed && (
        <View style={styles.pageLoading}>
          <ActivityIndicator color={colors.textDim} />
          <Text style={styles.pageNumber}>{index + 1}</Text>
        </View>
      )}
      {failed ? (
        <Pressable
          style={styles.pageLoading}
          onPress={() => {
            setFailed(false);
            onError();
          }}
        >
          <Ionicons name="refresh" size={28} color={colors.textMuted} />
          <Text style={styles.pageNumber}>Couldn&apos;t load page {index + 1} · tap to retry</Text>
        </Pressable>
      ) : (
        <Image
          source={url}
          style={{ width, height }}
          contentFit="fill"
          cachePolicy="memory-disk"
          recyclingKey={url}
          onLoad={(e) => onLoad(index, e.source.width, e.source.height)}
          onError={() => setFailed(true)}
        />
      )}
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Paged (right-to-left) reader
// ---------------------------------------------------------------------------

function PagedReader({ pages, onTap, onPage, onImageError, endCard }: {
  pages: string[];
  onTap: () => void;
  onPage: (i: number) => void;
  onImageError: () => void;
  endCard: React.ReactElement;
}) {
  const { width, height } = useWindowDimensions();
  const listRef = useRef<FlatList<string>>(null);
  const current = useRef(0);
  const items = useMemo(() => [...pages, '__end__'], [pages]);

  const scrollTo = (i: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, i));
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
    current.current = clamped;
    onPage(Math.min(clamped, pages.length - 1));
  };

  // Right-to-left: tapping the left edge goes forward, the right edge goes back.
  const onPress = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.pageX;
    if (x < width * 0.3) scrollTo(current.current + 1);
    else if (x > width * 0.7) scrollTo(current.current - 1);
    else onTap();
  };

  return (
    <FlatList
      ref={listRef}
      data={items}
      horizontal
      inverted
      pagingEnabled
      keyExtractor={(u, i) => `${i}-${u}`}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      showsHorizontalScrollIndicator={false}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={5}
      onMomentumScrollEnd={(e) => {
        const i = Math.round(e.nativeEvent.contentOffset.x / width);
        current.current = i;
        onPage(Math.min(i, pages.length - 1));
      }}
      renderItem={({ item, index }) =>
        item === '__end__' ? (
          <View style={{ width, height, justifyContent: 'center' }}>{endCard}</View>
        ) : (
          <ZoomPage url={item} index={index} width={width} height={height} onPress={onPress} onError={onImageError} />
        )
      }
    />
  );
}

const ZoomPage = memo(function ZoomPage({ url, index, width, height, onPress, onError }: {
  url: string;
  index: number;
  width: number;
  height: number;
  onPress: (e: GestureResponderEvent) => void;
  onError: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      maximumZoomScale={3}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onPress} style={{ width, height }}>
        {!loaded && !failed && (
          <View style={styles.pageLoading}>
            <ActivityIndicator color={colors.textDim} />
            <Text style={styles.pageNumber}>{index + 1}</Text>
          </View>
        )}
        {failed ? (
          <Pressable
            style={styles.pageLoading}
            onPress={() => {
              setFailed(false);
              onError();
            }}
          >
            <Ionicons name="refresh" size={28} color={colors.textMuted} />
            <Text style={styles.pageNumber}>Couldn&apos;t load page {index + 1} · tap to retry</Text>
          </Pressable>
        ) : (
          <Image
            source={url}
            style={{ width, height }}
            contentFit="contain"
            cachePolicy="memory-disk"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
      </Pressable>
    </ScrollView>
  );
});

// ---------------------------------------------------------------------------

function EndCard({ chapter, next, onNext, onDetails, mangaTitle }: {
  chapter?: Chapter;
  next?: Chapter;
  onNext: () => void;
  onDetails: () => void;
  mangaTitle: string;
}) {
  return (
    <View style={styles.endCard}>
      <Ionicons name="moon" size={28} color={colors.accent} />
      <Text style={styles.endTitle}>{chapter ? `End of ${chapterLabel(chapter)}` : 'End of chapter'}</Text>
      <Text style={styles.endSub} numberOfLines={2}>{mangaTitle}</Text>
      {next ? (
        <Button
          label={`Next: ${chapterLabel(next)}${isReadable(next) ? '' : ' (official site)'}`}
          icon={isReadable(next) ? 'play-skip-forward' : 'open-outline'}
          onPress={onNext}
          style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
        />
      ) : (
        <Text style={[styles.endSub, { marginTop: spacing.md }]}>You&apos;re all caught up! 🎉</Text>
      )}
      <Button label="Back to chapters" variant="secondary" onPress={onDetails} style={{ marginTop: spacing.sm, alignSelf: 'stretch' }} />
    </View>
  );
}

function CloseButton({ top }: { top: number }) {
  return (
    <Pressable onPress={() => router.back()} style={[styles.iconBtn, { position: 'absolute', top: top + 6, left: spacing.md }]}>
      <Ionicons name="close" size={24} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.overlay,
  },
  topTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  topSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.overlay,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  navText: { color: colors.text, fontWeight: '700' },
  pageText: { color: colors.textMuted, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pageLoading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8 },
  pageNumber: { color: colors.textDim, fontSize: 13 },
  noPages: { color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
  endCard: {
    alignItems: 'center',
    margin: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: 120,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  endTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.sm },
  endSub: { color: colors.textMuted, fontSize: 14, marginTop: 4, textAlign: 'center' },
});
