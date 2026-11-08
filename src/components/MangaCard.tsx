import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { splitId } from '../providers';
import type { MangaType } from '../providers/types';
import { showTitleActions } from '../utils/titleActions';
import { progressOf, useEntry } from '../store/library';
import { useScheme } from '../store/appearance';
import { colors, radius, statusColors, typeColors, themedStyles } from '../theme';
import { ProgressBar } from './ui';

export interface CardManga {
  id: string;
  title: string;
  coverUrl: string;
  type: MangaType;
}

function MangaCardBase({ manga, width, subtitle }: { manga: CardManga; width: number; subtitle?: string }) {
  useScheme();
  const entry = useEntry(manga.id);
  const { percent, read, total } = progressOf(entry);
  const height = width * 1.5;
  // Which site the title comes from, taken from its id; always shown under the title.
  const source = splitId(manga.id).provider.name;
  const sub = subtitle ?? (read > 0 && total > 0 ? `${percent}% · ${read}/${total}` : undefined);

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/manga/[id]', params: { id: manga.id } })}
      onLongPress={() => showTitleActions(manga.title)}
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
      <Text style={styles.source} numberOfLines={1}>{source}</Text>
      {sub ? (
        <Text style={styles.subtitle} numberOfLines={1}>{sub}</Text>
      ) : null}
    </Pressable>
  );
}

export const MangaCard = memo(MangaCardBase);

const styles = themedStyles(() => StyleSheet.create({
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
  source: { color: colors.accent, fontSize: 11, fontWeight: '700', marginTop: 2 },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
}));
