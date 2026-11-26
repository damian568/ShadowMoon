import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';

import { useScheme } from '../store/appearance';
import { colors, themedStyles } from '../theme';
import { updateErrorMessage, type UpdateSnapshot, type UpdateView } from '../utils/appUpdate';
import { ProgressBar } from './ui';

/** The title, progress bar, percentage and explanation of an update, shared by the launch screen and the App updates screen. */
export function UpdateProgress({ view }: { view: UpdateView }) {
  useScheme();
  const accent = view.phase === 'error' ? colors.danger : view.phase === 'ready' || view.phase === 'upToDate' ? colors.success : colors.accent;
  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, view.phase === 'error' && { color: colors.danger }]}>{view.title}</Text>
      {view.showBar && (
        <>
          <ProgressBar percent={view.percent ?? 0} height={10} color={accent} />
          <Text style={styles.percent}>{view.percent == null ? 'Starting…' : `${view.percent}%`}</Text>
        </>
      )}
      <Text style={styles.detail}>{view.detail}</Text>
    </View>
  );
}

/** What the update library reports right now, in the shape `describeUpdate` understands. */
export function snapshotFrom(u: ReturnType<typeof Updates.useUpdates>): UpdateSnapshot {
  return {
    enabled: Updates.isEnabled,
    checking: u.isChecking,
    downloading: u.isDownloading,
    progress: u.downloadProgress,
    available: u.isUpdateAvailable,
    pending: u.isUpdatePending,
    restarting: u.isRestarting,
    checked: !!u.lastCheckForUpdateTimeSinceRestart,
    error: updateErrorMessage(u.downloadError ?? u.checkError),
  };
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 10 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  percent: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  detail: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
}));
