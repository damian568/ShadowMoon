import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';

export function ProgressBar({ percent, height = 4, color = colors.accent, style }: {
  percent: number;
  height?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ height, borderRadius: height, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }, style]}>
      <View style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: '100%', backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

/**
 * A source's (provider's) icon: the website's own favicon, or a letter badge when it has none
 * or the image fails to load.
 */
export function SourceIcon({ name, iconUrl, size = 18 }: { name: string; iconUrl?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const radiusPx = Math.round(size * 0.25);
  if (iconUrl && !failed) {
    return (
      <Image
        source={iconUrl}
        style={{ width: size, height: size, borderRadius: radiusPx }}
        contentFit="cover"
        cachePolicy="memory-disk"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radiusPx,
        backgroundColor: colors.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.text, fontSize: size * 0.58, fontWeight: '800' }}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export function Chip({ label, active, onPress, icon, leading, color = colors.accent, count }: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Custom element shown before the label (e.g. a SourceIcon). Used instead of `icon`. */
  leading?: React.ReactNode;
  color?: string;
  count?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: color, borderColor: color },
        pressed && { opacity: 0.75 },
      ]}
    >
      {leading ? <View style={{ marginRight: 6 }}>{leading}</View> : null}
      {!leading && icon && <Ionicons name={icon} size={14} color={active ? colors.bg : colors.textMuted} style={{ marginRight: 5 }} />}
      <Text style={[styles.chipText, active && { color: colors.bg }]}>{label}</Text>
      {count !== undefined && (
        <Text style={[styles.chipCount, active && { color: colors.bg }]}>{count}</Text>
      )}
    </Pressable>
  );
}

export function Button({ label, onPress, icon, variant = 'primary', style, disabled, loading }: {
  label: string;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  loading?: boolean;
}) {
  const bg = variant === 'primary' ? colors.accentStrong : variant === 'secondary' ? colors.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? '#fff' : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} />}
          <Text style={[styles.buttonText, { color: fg }]} numberOfLines={1}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function EmptyState({ icon, title, message, action }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={34} color={colors.accent} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {action}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.accent} size="large" />
      {label ? <Text style={[styles.emptyMessage, { marginTop: spacing.md }]}>{label}</Text> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Something went wrong"
      message={message}
      action={onRetry ? <Button label="Try again" icon="refresh" onPress={onRetry} style={{ marginTop: spacing.lg }} /> : null}
    />
  );
}

export function SectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Badge({ label, color = colors.accent, textColor = colors.bg }: { label: string; color?: string; textColor?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={[styles.badgeText, { color: textColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  chipCount: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginLeft: 6 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    height: 48,
    borderRadius: radius.md,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, minHeight: 320 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyMessage: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  sectionSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
});
