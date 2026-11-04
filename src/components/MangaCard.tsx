import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MangaType } from '../providers/types';
import { progressOf, useEntry } from '../store/library';
import { colors, radius, statusColors, typeColors } from '../theme';
import { ProgressBar } from './ui';

export interface CardManga {
  id: string;
  title: string;
  coverUrl: string;
  type: MangaType;
}

function MangaCardBase({ manga, width, subtitle, source }: { manga: CardManga; width: number; subtitle?: string; source?: string }) {
  const entry = useEntry(manga.id);
  const { percent, read, total } = progressOf(entry);
  const height = width * 1.5;
  // `source` (which site the title comes from) is shown in front of the progress, e.g. "MangaRead · 42% · 63/150".
  const sub =
    subtitle ?? ([source, read > 0 && total > 0 ? `${percent}% · ${read}/${total}` : null].filter(Boolean).join(' · ') || undefined);

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/manga/[id]', params: { id: manga.id } })}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={[styles.cover, { width, height }]}>
        <Image
          source={manga.coverUrl || undefined}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          recyclingKey={manga.id}
          cachePolicy="memory-disk"
        />
        <View style={[styles.typeBadge, { backgroundColor: typeColors[manga.type] }]}>
          <Text style={styles.typeText}>{manga.type === 'other' ? 'COMIC' : manga.type.toUpperCase()}</Text>
        </View>
        {entry?.favorite && (
          <View style={styles.heart}>
            <Ionicons name="heart" size={14} color={colors.favorite} />
          </View>
        )}
        {!!entry?.newChapters && (
          <View style={styles.newBadge}>
            <Text style={styles.newText}>+{entry.newChapters}</Text>
          </View>
        )}
        {read > 0 && total > 0 && (
          <View style={styles.progressWrap}>
            <ProgressBar percent={percent} height={4} color={entry?.status ? statusColors[entry.status] : colors.accent} />
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {manga.title}
      </Text>
      {sub ? (
        <Text style={styles.subtitle} numberOfLines={1}>{sub}</Text>
      ) : null}
    </Pressable>
  );
}

export const MangaCard = memo(MangaCardBase);

const styles = StyleSheet.create({
  cover: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  typeBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeText: { color: '#0A0A14', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  heart: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(10,10,20,0.75)',
    borderRadius: 12,
    padding: 4,
  },
  newBadge: {
    position: 'absolute',
    bottom: 10,
    right: 6,
    backgroundColor: colors.danger,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  newText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  progressWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,20,0.6)' },
  title: { color: '#EEEBFF', fontSize: 13, fontWeight: '600', marginTop: 6, lineHeight: 17 },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
