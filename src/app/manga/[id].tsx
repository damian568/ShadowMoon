import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAniListInfo, type AniListInfo } from '../../api/anilist';
import {
  chapterLabel,
  getChaptersCached,
  getMangaCached,
  getStats,
  isReadable,
  type Chapter,
  type MangaStats,
} from '../../providers';
import { Button, ErrorView, Loading, ProgressBar } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import {
  progressOf,
  toLite,
  useEntry,
  useLibrary,
  type LibraryEntry,
  type MangaLite,
  type ReadingStatus,
} from '../../store/library';
import { colors, radius, spacing, statusColors, statusLabels, typeColors } from '../../theme';
import { shortDate } from '../../utils/time';

const STATUS_BUTTONS: { key: ReadingStatus; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'reading', icon: 'book' },
  { key: 'completed', icon: 'checkmark-done' },
  { key: 'later', icon: 'bookmark' },
];

const tap = () => Haptics.selectionAsync().catch(() => {});

export default function MangaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const lib = useLibrary();
  const entry = useEntry(id);
  const language = lib.state.settings.language;
  const [descending, setDescending] = useState(true);

  const q = useAsync(
    async (force) => {
      const manga = await getMangaCached(id, force);
      const chapters = await getChaptersCached(manga, language, force);
      return { manga, chapters };
    },
    [id, language],
  );
  const stats = useAsync<MangaStats | null>(() => getStats(id).catch(() => null), [id]);
  const anilist = useAsync<AniListInfo | null>(
    async () => {
      const m = await getMangaCached(id);
      return getAniListInfo(m);
    },
    [id],
  );

  const manga = q.data?.manga;
  const chapters = q.data?.chapters;

  // Keep library bookkeeping (chapter totals, "new" badge) in sync with what we just loaded.
  useEffect(() => {
    if (!manga || !chapters || !entry) return;
    if (
      !entry.syncedAt ||
      entry.totalChapters !== chapters.length ||
      entry.newChapters > 0 ||
      (entry.latestUploadedChapter ?? null) !== (manga.latestUploadedChapter ?? null)
    ) {
      lib.syncChapters({ ...toLite(manga), latestUploadedChapter: manga.latestUploadedChapter }, chapters);
    }
  }, [manga, chapters, entry, lib]);

  const lite: MangaLite | undefined = manga ? toLite(manga) : entry;
  const readSet = useMemo(() => new Set(entry?.readChapters ?? []), [entry?.readChapters]);
  const validKeys = useMemo(() => (chapters ? new Set(chapters.map((c) => c.key)) : undefined), [chapters]);
  const progress = progressOf(entry, validKeys);

  const continueTarget = useMemo(() => findContinueTarget(chapters, entry, readSet), [chapters, entry, readSet]);
  const listData = useMemo(() => (chapters ? (descending ? [...chapters].reverse() : chapters) : []), [chapters, descending]);

  const openChapter = useCallback(
    async (c: Chapter) => {
      if (!lite) return;
      lib.openChapter(lite, c);
      if (isReadable(c)) {
        router.push({ pathname: '/reader/[chapterId]', params: { chapterId: c.id, mangaId: id } });
      } else if (c.externalUrl) {
        await WebBrowser.openBrowserAsync(c.externalUrl, { controlsColor: colors.accent });
      }
    },
    [lite, lib, id],
  );

  const toggleRead = useCallback(
    (c: Chapter) => {
      if (!lite) return;
      tap();
      lib.setRead(lite, [c.key], !readSet.has(c.key));
    },
    [lite, lib, readSet],
  );

  const chapterMenu = useCallback(
    (c: Chapter) => {
      if (!lite || !chapters) return;
      const idx = chapters.findIndex((x) => x.key === c.key);
      const previous = chapters.slice(0, idx + 1).map((x) => x.key);
      const isRead = readSet.has(c.key);
      const actions = [
        { label: isRead ? 'Mark as unread' : 'Mark as read', run: () => lib.setRead(lite, [c.key], !isRead) },
        { label: 'Mark this and all previous as read', run: () => lib.setRead(lite, previous, true) },
        { label: 'Mark this and all previous as unread', run: () => lib.setRead(lite, previous, false) },
      ];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { title: chapterLabel(c, true), options: [...actions.map((a) => a.label), 'Cancel'], cancelButtonIndex: actions.length, userInterfaceStyle: 'dark' },
          (i) => actions[i]?.run(),
        );
      } else {
        Alert.alert(chapterLabel(c, true), undefined, [
          ...actions.map((a) => ({ text: a.label, onPress: a.run })),
          { text: 'Cancel', style: 'cancel' as const },
        ]);
      }
    },
    [lite, chapters, readSet, lib],
  );

  const setStatus = (status: ReadingStatus) => {
    if (!lite) return;
    tap();
    const next = entry?.status === status ? null : status;
    lib.setStatus(lite, next);
    if (next === 'completed' && chapters?.length && progress.percent < 100) {
      Alert.alert('Mark every chapter as read?', `This sets your progress to 100% (${chapters.length} chapters).`, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Mark all read', onPress: () => lib.setRead(lite, chapters.map((c) => c.key), true) },
      ]);
    }
  };

  const toggleFavorite = () => {
    if (!lite) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    lib.toggleFavorite(lite);
  };

  if (q.loading && !q.data) return <Loading label="Opening…" />;
  if (q.error && !q.data) return <ErrorView message={q.error} onRetry={q.reload} />;
  if (!manga || !chapters) return null;

  const readableCount = chapters.filter(isReadable).length;

  const header = (
    <View>
      <View style={[styles.backdrop, { height: 260 + insets.top }]}>
        <Image source={manga.coverUrlLarge || undefined} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={28} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,20,0.55)' }]} />
        <View style={styles.backdropFade} />
      </View>

      <View style={[styles.top, { paddingTop: insets.top + 56 }]}>
        <Image source={manga.coverUrlLarge || undefined} style={styles.cover} contentFit="cover" transition={200} />
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <Pill label={manga.type === 'other' ? 'Comic' : capitalize(manga.type)} color={typeColors[manga.type]} />
            <Pill label={capitalize(manga.pubStatus)} color={manga.pubStatus === 'ongoing' ? colors.success : colors.textMuted} />
          </View>
          <Text style={styles.title} numberOfLines={4}>{manga.title}</Text>
          {manga.authors.length > 0 && <Text style={styles.authors} numberOfLines={1}>{manga.authors.join(', ')}</Text>}
          <View style={styles.metaRow}>
            {stats.data?.rating ? <Meta icon="star" text={stats.data.rating.toFixed(1)} color={colors.warning} /> : null}
            {anilist.data?.score ? (
              <Pressable onPress={() => WebBrowser.openBrowserAsync(anilist.data!.url)} hitSlop={8}>
                <Meta icon="stats-chart" text={`AniList ${anilist.data.score}%`} color={colors.accent} />
              </Pressable>
            ) : null}
            {stats.data?.follows ? <Meta icon="people" text={compact(stats.data.follows)} /> : null}
            {manga.year ? <Meta icon="calendar" text={String(manga.year)} /> : null}
          </View>
        </View>
      </View>

      {/* Library actions */}
      <View style={styles.actions}>
        <Pressable onPress={toggleFavorite} style={[styles.favBtn, entry?.favorite && { backgroundColor: colors.favorite, borderColor: colors.favorite }]}>
          <Ionicons name={entry?.favorite ? 'heart' : 'heart-outline'} size={22} color={entry?.favorite ? '#fff' : colors.favorite} />
        </Pressable>
        {STATUS_BUTTONS.map((b) => {
          const active = entry?.status === b.key;
          return (
            <Pressable
              key={b.key}
              onPress={() => setStatus(b.key)}
              style={[styles.statusBtn, active && { backgroundColor: statusColors[b.key], borderColor: statusColors[b.key] }]}
            >
              <Ionicons name={b.icon} size={16} color={active ? colors.bg : statusColors[b.key]} />
              <Text style={[styles.statusText, active && { color: colors.bg }]} numberOfLines={1}>{statusLabels[b.key]}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Progress */}
      <View style={styles.progressCard}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={styles.percent}>{progress.percent}%</Text>
          <Text style={styles.progressLabel}>
            {'  '}read · {progress.read} of {progress.total} chapters
          </Text>
        </View>
        <ProgressBar percent={progress.percent} height={8} style={{ marginTop: spacing.sm }} color={entry?.status ? statusColors[entry.status] : colors.accent} />
        {continueTarget && (
          <Button
            label={continueTarget.label}
            icon={isReadable(continueTarget.chapter) ? 'play' : 'open-outline'}
            onPress={() => openChapter(continueTarget.chapter)}
            style={{ marginTop: spacing.md }}
          />
        )}
      </View>

      {chapters.length > 0 && readableCount === 0 && (
        <View style={styles.notice}>
          <Ionicons name="information-circle" size={18} color={colors.warning} />
          <Text style={styles.noticeText}>
            This title is officially licensed — chapters open on the publisher&apos;s site. You can still track your progress here.
          </Text>
        </View>
      )}

      {manga.description ? <Description text={manga.description} /> : null}

      {manga.tags.length > 0 && (
        <View style={styles.tags}>
          {manga.tags.slice(0, 12).map((t) => (
            <View key={t} style={styles.tag}>
              <Text style={styles.tagText}>{t}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.chapterHeader}>
        <Text style={styles.chapterCount}>{chapters.length} Chapters</Text>
        <Pressable onPress={() => setDescending((d) => !d)} hitSlop={8} style={styles.sortBtn}>
          <Ionicons name={descending ? 'arrow-down' : 'arrow-up'} size={16} color={colors.accent} />
          <Text style={styles.sortText}>{descending ? 'Newest' : 'Oldest'}</Text>
        </Pressable>
        <Pressable
          hitSlop={8}
          style={styles.sortBtn}
          onPress={() => {
            if (!lite) return;
            const allRead = progress.read >= chapters.length;
            lib.setRead(lite, chapters.map((c) => c.key), !allRead);
          }}
        >
          <Ionicons name="checkmark-done" size={16} color={colors.accent} />
          <Text style={styles.sortText}>{progress.read >= chapters.length && chapters.length > 0 ? 'Unread all' : 'Read all'}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.bg }}
        data={listData}
        keyExtractor={(c) => c.key}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <ChapterRow
            chapter={item}
            read={readSet.has(item.key)}
            current={entry?.lastChapterKey === item.key}
            onPress={openChapter}
            onToggleRead={toggleRead}
            onLongPress={chapterMenu}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.emptyChapters}>
            No chapters available in this language yet. Try another language in Settings.
          </Text>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} tintColor={colors.accent} />}
        initialNumToRender={20}
        windowSize={11}
      />
    </>
  );
}

function findContinueTarget(chapters: Chapter[] | undefined, entry: LibraryEntry | undefined, readSet: Set<string>) {
  if (!chapters || chapters.length === 0) return null;
  const label = (prefix: string, c: Chapter) => `${prefix} · ${c.chapter ? `Chapter ${c.chapter}` : 'Oneshot'}`;
  if (readSet.size === 0 && !entry?.lastChapterKey) return { chapter: chapters[0], label: label('Start reading', chapters[0]) };
  // Resume a chapter that was opened but not finished.
  if (entry?.lastChapterKey && !readSet.has(entry.lastChapterKey)) {
    const c = chapters.find((x) => x.key === entry.lastChapterKey);
    if (c) return { chapter: c, label: label('Continue', c) };
  }
  let lastRead = -1;
  chapters.forEach((c, i) => readSet.has(c.key) && (lastRead = i));
  const next = chapters[lastRead + 1];
  if (next) return { chapter: next, label: label(lastRead >= 0 ? 'Continue' : 'Start reading', next) };
  return { chapter: chapters[0], label: label('Read again', chapters[0]) };
}

const ChapterRow = memo(function ChapterRow({ chapter, read, current, onPress, onToggleRead, onLongPress }: {
  chapter: Chapter;
  read: boolean;
  current: boolean;
  onPress: (c: Chapter) => void;
  onToggleRead: (c: Chapter) => void;
  onLongPress: (c: Chapter) => void;
}) {
  const external = !isReadable(chapter);
  const sub = [chapter.chapter && chapter.title ? chapter.title : null, chapter.group, shortDate(chapter.readableAt)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={() => onPress(chapter)}
      onLongPress={() => onLongPress(chapter)}
      style={({ pressed }) => [styles.chapterRow, pressed && { backgroundColor: colors.surface }]}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {current && !read && <View style={styles.currentDot} />}
          <Text style={[styles.chapterTitle, read && styles.chapterRead]} numberOfLines={1}>
            {chapterLabel(chapter)}
          </Text>
          {external && (
            <View style={styles.externalPill}>
              <Ionicons name="open-outline" size={10} color={colors.textMuted} />
              <Text style={styles.externalText}>Official site</Text>
            </View>
          )}
        </View>
        {sub ? <Text style={[styles.chapterSub, read && { color: colors.textDim }]} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <Pressable onPress={() => onToggleRead(chapter)} hitSlop={12} style={styles.readToggle}>
        <Ionicons
          name={read ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={read ? colors.success : colors.textDim}
        />
      </Pressable>
    </Pressable>
  );
});

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
      <Text style={styles.description} numberOfLines={open ? undefined : 4}>{text}</Text>
      <Text style={styles.more}>{open ? 'Show less' : 'Show more'}</Text>
    </Pressable>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function Meta({ icon, text, color = colors.textMuted }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  backdropFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 90, backgroundColor: colors.bg, opacity: 0.85 },
  top: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.lg },
  cover: {
    width: 120,
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', lineHeight: 27 },
  authors: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  metaRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  favBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 4,
  },
  statusText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  progressCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  percent: { color: colors.text, fontSize: 28, fontWeight: '900' },
  progressLabel: { color: colors.textMuted, fontSize: 14 },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,194,102,0.1)',
  },
  noticeText: { color: colors.text, fontSize: 13, flex: 1, lineHeight: 18 },
  description: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  more: { color: colors.accent, fontWeight: '700', marginTop: 4, fontSize: 13 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  tag: { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  tagText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  chapterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  chapterCount: { color: colors.text, fontSize: 18, fontWeight: '800', flex: 1 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sortText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chapterTitle: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  chapterRead: { color: colors.textDim },
  chapterSub: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  currentDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  externalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  externalText: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  readToggle: { paddingLeft: spacing.md },
  emptyChapters: { color: colors.textMuted, textAlign: 'center', padding: spacing.xl },
});
