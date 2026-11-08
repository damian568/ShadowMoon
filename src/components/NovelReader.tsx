/**
 * The reader for light novels: a chapter is plain text (no pictures), shown as a scrolling page with a size you choose.
 * It does the same bookkeeping as the picture reader: remembers where you are, marks the chapter read at its end and
 * goes to the previous / next chapter. (`app/reader/[chapterId].tsx` picks this one for novel sources.)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chapterLabel, getChaptersCached, getChapterText, getMangaCached, isReadable, type Chapter } from '../providers';
import { useAsync } from '../hooks/useAsync';
import { NOVEL_FONT_SIZES, toLite, useLibrary } from '../store/library';
import { useScheme } from '../store/appearance';
import { useAuth } from '../store/auth';
import { colors, radius, spacing, themedStyles } from '../theme';
import { Button, ErrorView, Loading } from './ui';

/** Within this many pixels of the bottom counts as "reached the end". */
const END_SLACK = 120;

export function NovelReader({ chapterId, mangaId }: { chapterId: string; mangaId: string }) {
  const lib = useLibrary();
  const { language, novelFontSize } = lib.state.settings;
  const scheme = useScheme();
  const signedIn = useAuth().status === 'signedIn'; // Dark/Light is an account setting
  // The page uses the app's colours (Settings → Appearance); the sun/moon button here switches them too.
  const pal = {
    bg: colors.bg,
    text: colors.text,
    muted: colors.textMuted,
    bar: colors.overlay,
    control: colors.control,
    card: colors.surface,
    border: colors.border,
    statusBar: scheme === 'dark' ? ('light' as const) : ('dark' as const),
  };
  const insets = useSafeAreaInsets();

  const q = useAsync(async () => {
    const [manga, paragraphs] = await Promise.all([getMangaCached(mangaId), getChapterText(mangaId, chapterId)]);
    const chapters = await getChaptersCached(manga, language);
    return { manga, chapters, paragraphs };
  }, [chapterId, mangaId, language]);

  const manga = q.data?.manga;
  const chapters = q.data?.chapters;
  const index = chapters?.findIndex((c) => c.id === chapterId) ?? -1;
  const chapter: Chapter | undefined = index >= 0 ? chapters![index] : undefined;
  const prev = index > 0 ? chapters![index - 1] : undefined;
  const next = chapters && index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : undefined;

  const [uiVisible, setUiVisible] = useState(true);
  const [percent, setPercent] = useState(0);
  const toggleUi = useCallback(() => setUiVisible((v) => !v), []);

  // Record "currently reading" as soon as we know which chapter this is.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (manga && chapter && opened.current !== chapter.id) {
      opened.current = chapter.id;
      lib.openChapter(toLite(manga), chapter);
    }
  }, [manga, chapter, lib]);

  // Mark as read once the end of the text has been reached.
  const markedRead = useRef<string | null>(null);
  const onReachedEnd = useCallback(() => {
    if (!manga || !chapter || markedRead.current === chapter.id) return;
    markedRead.current = chapter.id;
    lib.setRead(toLite(manga), [chapter.key], true);
  }, [manga, chapter, lib]);

  const layoutHeight = useRef(0);
  const contentHeight = useRef(0);
  const offsetY = useRef(0);
  const measure = useCallback(() => {
    const total = contentHeight.current - layoutHeight.current;
    setPercent(total > 0 ? Math.max(0, Math.min(100, Math.round((offsetY.current / total) * 100))) : 100);
    if (contentHeight.current > 0 && offsetY.current + layoutHeight.current >= contentHeight.current - END_SLACK) onReachedEnd();
  }, [onReachedEnd]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetY.current = e.nativeEvent.contentOffset.y;
    layoutHeight.current = e.nativeEvent.layoutMeasurement.height;
    contentHeight.current = e.nativeEvent.contentSize.height;
    measure();
  };

  // The length of the text is known once it has been laid out (a short chapter fits on one screen).
  const onContentSizeChange = (_w: number, h: number) => {
    contentHeight.current = h;
    measure();
  };
  const onLayout = (e: LayoutChangeEvent) => {
    layoutHeight.current = e.nativeEvent.layout.height;
    measure();
  };

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

  const toggleTheme = () => lib.updateSettings({ appearance: scheme === 'dark' ? 'light' : 'dark' });
  const setSize = (delta: number) =>
    lib.updateSettings({ novelFontSize: Math.max(NOVEL_FONT_SIZES.min, Math.min(NOVEL_FONT_SIZES.max, novelFontSize + delta)) });

  if (q.loading && !q.data) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <Loading label="Loading chapter…" />
        <CloseButton top={insets.top} />
      </View>
    );
  }
  if (q.error && !q.data) {
    return (
      <View style={styles.root}>
        <ErrorView message={q.error} onRetry={q.reload} />
        <CloseButton top={insets.top} />
      </View>
    );
  }
  if (!manga || !q.data) return null;

  const paragraphs = q.data.paragraphs;
  const nextReadable = next && isReadable(next);

  return (
    <View style={[styles.root, { backgroundColor: pal.bg }]}>
      <StatusBar hidden={!uiVisible} style={pal.statusBar} />
      <ScrollView
        onScroll={onScroll}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 72, paddingBottom: insets.bottom + 120, paddingHorizontal: spacing.lg }}
      >
        <Pressable onPress={toggleUi}>
          {chapter && <Text style={[styles.heading, { fontSize: novelFontSize + 4, color: pal.text }]}>{chapterLabel(chapter, true)}</Text>}
          {paragraphs.map((p, i) => (
            <Text key={i} style={[styles.paragraph, { fontSize: novelFontSize, lineHeight: Math.round(novelFontSize * 1.65), color: pal.text }]}>
              {p}
            </Text>
          ))}
        </Pressable>

        <View style={[styles.endCard, { backgroundColor: pal.card, borderColor: pal.border }]}>
          <Ionicons name="moon" size={28} color={colors.accentStrong} />
          <Text style={[styles.endTitle, { color: pal.text }]}>{chapter ? `End of ${chapterLabel(chapter)}` : 'End of chapter'}</Text>
          <Text style={[styles.endSub, { color: pal.muted }]} numberOfLines={2}>{manga.title}</Text>
          {next ? (
            <Button
              label={`Next: ${chapterLabel(next)}${nextReadable ? '' : ' (official site)'}`}
              icon={nextReadable ? 'play-skip-forward' : 'open-outline'}
              onPress={() => goTo(next)}
              style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
            />
          ) : (
            <Text style={[styles.endSub, { marginTop: spacing.md, color: pal.muted }]}>You&apos;re all caught up! 🎉</Text>
          )}
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, { backgroundColor: pal.control, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.backText, { color: pal.text }]}>Back to chapters</Text>
          </Pressable>
        </View>
      </ScrollView>

      {uiVisible && (
        <>
          <View style={[styles.topBar, { paddingTop: insets.top + 6, backgroundColor: pal.bar }]}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.iconBtn, { backgroundColor: pal.control }]}>
              <Ionicons name="chevron-back" size={24} color={pal.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.topTitle, { color: pal.text }]} numberOfLines={1}>{manga.title}</Text>
              <Text style={[styles.topSub, { color: pal.muted }]} numberOfLines={1}>{chapter ? chapterLabel(chapter, true) : 'Chapter'}</Text>
            </View>
            {signedIn && (
              <Pressable onPress={toggleTheme} hitSlop={8} style={[styles.iconBtn, { backgroundColor: pal.control }]}>
                <Ionicons name={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'} size={20} color={pal.text} />
              </Pressable>
            )}
            <Pressable
              onPress={() => setSize(-2)}
              disabled={novelFontSize <= NOVEL_FONT_SIZES.min}
              hitSlop={8}
              style={[styles.iconBtn, { backgroundColor: pal.control }, novelFontSize <= NOVEL_FONT_SIZES.min && { opacity: 0.35 }]}
            >
              <Text style={[styles.sizeLabelSmall, { color: pal.text }]}>A</Text>
            </Pressable>
            <Pressable
              onPress={() => setSize(2)}
              disabled={novelFontSize >= NOVEL_FONT_SIZES.max}
              hitSlop={8}
              style={[styles.iconBtn, { backgroundColor: pal.control }, novelFontSize >= NOVEL_FONT_SIZES.max && { opacity: 0.35 }]}
            >
              <Text style={[styles.sizeLabelBig, { color: pal.text }]}>A</Text>
            </Pressable>
          </View>

          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8, backgroundColor: pal.bar }]}>
            <Pressable onPress={() => goTo(prev)} disabled={!prev} style={[styles.navBtn, { backgroundColor: pal.control }, !prev && { opacity: 0.35 }]}>
              <Ionicons name="play-skip-back" size={18} color={pal.text} />
              <Text style={[styles.navText, { color: pal.text }]}>Prev</Text>
            </Pressable>
            <Text style={[styles.percentText, { color: pal.muted }]}>{percent}%</Text>
            <Pressable onPress={() => goTo(next)} disabled={!next} style={[styles.navBtn, { backgroundColor: pal.control }, !next && { opacity: 0.35 }]}>
              <Text style={[styles.navText, { color: pal.text }]}>Next</Text>
              <Ionicons name="play-skip-forward" size={18} color={pal.text} />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function CloseButton({ top }: { top: number }) {
  useScheme();
  return (
    <Pressable onPress={() => router.back()} style={[styles.iconBtn, { position: 'absolute', top: top + 6, left: spacing.md }]}>
      <Ionicons name="close" size={24} color={colors.text} />
    </Pressable>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  heading: { color: colors.text, fontWeight: '800', marginBottom: spacing.lg },
  paragraph: { color: colors.text, marginBottom: spacing.md },
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
  sizeLabelSmall: { color: colors.text, fontSize: 14, fontWeight: '700' },
  sizeLabelBig: { color: colors.text, fontSize: 22, fontWeight: '700' },
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
  percentText: { color: colors.textMuted, fontWeight: '700', fontVariant: ['tabular-nums'] },
  endCard: {
    alignItems: 'center',
    marginTop: spacing.xl,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  backText: { fontSize: 15, fontWeight: '700' },
  endTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.sm },
  endSub: { color: colors.textMuted, fontSize: 14, marginTop: 4, textAlign: 'center' },
}));
