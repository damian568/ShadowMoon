import { Redirect, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Field } from '../components/AuthForm';
import { MangaCard } from '../components/MangaCard';
import { Button, Loading } from '../components/ui';
import { useAuth } from '../store/auth';
import { useLibraryList, useStableCallback, type LibraryEntry } from '../store/library';
import { useSignOut } from '../sync/useSignOut';
import { useScheme } from '../store/appearance';
import { colors, radius, spacing, statusColors, themedStyles } from '../theme';
import {
  nicknameFor,
  validateEmailChange,
  validateNickname,
  validatePasswordChange,
  type EmailChangeErrors,
  type PasswordChangeErrors,
} from '../utils/auth';

/** Runs one form's save action and keeps its "saving / error / done" message. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (action: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const message = await action();
      if (message) setInfo(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setError(null);
    setInfo(null);
  };
  return { busy, error, info, run, reset };
}

export default function ProfileScreen() {
  useScheme();
  const auth = useAuth();
  const signOut = useSignOut();

  // Pick up a confirmed email change whenever the screen is shown. The callback must keep one identity,
  // otherwise refreshing the user would re-trigger this effect in a loop.
  const refresh = useStableCallback(() => auth.refreshUser());
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  if (auth.status === 'loading') return <Loading label="Loading your profile…" />;
  if (auth.status !== 'signedIn' || !auth.user) return <Redirect href="/(tabs)/settings" />;

  const name = nicknameFor(auth.user);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 56 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{[...name][0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.email}>{auth.user.email}</Text>
        </View>

        <LibraryOverview />

        <NicknameSection key={auth.user.displayName ?? ''} initial={auth.user.displayName ?? ''} placeholder={name} />
        <EmailSection currentEmail={auth.user.email} />
        <PasswordSection />

        <Button label="Sign out" variant="secondary" icon="log-out-outline" onPress={signOut} style={{ marginTop: spacing.lg }} />
        <Text style={styles.footnote}>
          Signing out removes your library and settings from this phone. They stay saved in your account.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Library overview
// ---------------------------------------------------------------------------

const CARD_WIDTH = 104;

function LibraryOverview() {
  useScheme();
  const all = useLibraryList('all');
  const reading = useLibraryList('reading');
  const done = useLibraryList('completed');
  const later = useLibraryList('later');
  const favourites = useLibraryList('favorite');

  const chaptersRead = all.reduce((total, e) => total + e.readChapters.length, 0);
  const rows: { key: string; title: string; color: string; items: LibraryEntry[] }[] = [
    { key: 'reading', title: 'Reading', color: statusColors.reading, items: reading },
    { key: 'completed', title: 'Done', color: statusColors.completed, items: done },
    { key: 'later', title: 'For later', color: statusColors.later, items: later },
    { key: 'favorite', title: 'Favourites', color: colors.favorite, items: favourites },
  ].filter((r) => r.items.length > 0);

  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={styles.sectionTitle}>Your library</Text>
      <View style={styles.stats}>
        <Stat value={all.length} label="Titles" />
        <Stat value={done.length} label="Done" />
        <Stat value={chaptersRead} label="Chapters read" />
      </View>

      {rows.length === 0 ? (
        <Text style={styles.hint}>
          Titles you favourite or start reading will show up here, grouped by Reading, Done and For later.
        </Text>
      ) : (
        rows.map((row) => (
          <View key={row.key} style={{ marginTop: spacing.lg }}>
            <View style={styles.rowHeader}>
              <View style={[styles.dot, { backgroundColor: row.color }]} />
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowCount}>{row.items.length}</Text>
            </View>
            <FlatList
              horizontal
              data={row.items}
              keyExtractor={(e) => e.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.md }}
              renderItem={({ item }) => <MangaCard manga={item} width={CARD_WIDTH} />}
            />
          </View>
        ))
      )}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  useScheme();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Nickname, email, password
// ---------------------------------------------------------------------------

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  useScheme();
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {children}
      </View>
    </View>
  );
}

function Result({ error, info }: { error: string | null; info: string | null }) {
  useScheme();
  if (error) return <Text style={styles.error}>{error}</Text>;
  if (info) return <Text style={styles.success}>{info}</Text>;
  return null;
}

function NicknameSection({ initial, placeholder }: { initial: string; placeholder: string }) {
  useScheme();
  const auth = useAuth();
  const action = useAction();
  const [nickname, setNickname] = useState(initial);
  const [error, setError] = useState<string | undefined>();

  const save = () => {
    const problem = validateNickname(nickname);
    setError(problem);
    if (problem) return;
    action.run(async () => {
      await auth.updateNickname(nickname);
      return 'Nickname saved.';
    });
  };

  return (
    <Section title="Nickname">
      <Field
        label="Nickname"
        error={error}
        inputProps={{
          value: nickname,
          onChangeText: (v) => {
            setNickname(v);
            action.reset();
          },
          placeholder,
          maxLength: 40,
          autoCorrect: false,
          returnKeyType: 'done',
          editable: !action.busy,
          onSubmitEditing: save,
        }}
      />
      <Result error={action.error} info={action.info} />
      <Button label="Save nickname" onPress={save} loading={action.busy} style={{ marginTop: spacing.lg }} />
    </Section>
  );
}

function EmailSection({ currentEmail }: { currentEmail: string | null }) {
  useScheme();
  const auth = useAuth();
  const action = useAction();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<EmailChangeErrors>({});

  const submit = () => {
    const found = validateEmailChange(newEmail, currentEmail, password);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    action.run(async () => {
      await auth.changeEmail(newEmail, password);
      const sentTo = newEmail.trim();
      setNewEmail('');
      setPassword('');
      return `We sent a confirmation link to ${sentTo}. Open it to finish: your sign-in email changes after you confirm.`;
    });
  };

  return (
    <Section title="Email" hint={`Current email: ${currentEmail ?? 'none'}`}>
      <Field
        label="New email"
        error={errors.email}
        inputProps={{
          value: newEmail,
          onChangeText: (v) => {
            setNewEmail(v);
            action.reset();
          },
          placeholder: 'new@example.com',
          autoCapitalize: 'none',
          autoCorrect: false,
          keyboardType: 'email-address',
          textContentType: 'emailAddress',
          editable: !action.busy,
        }}
      />
      <Field
        label="Current password"
        error={errors.password}
        inputProps={{
          value: password,
          onChangeText: setPassword,
          placeholder: 'To confirm it is you',
          secureTextEntry: true,
          autoCapitalize: 'none',
          autoCorrect: false,
          textContentType: 'password',
          editable: !action.busy,
          onSubmitEditing: submit,
        }}
      />
      <Result error={action.error} info={action.info} />
      <Button label="Send confirmation link" onPress={submit} loading={action.busy} style={{ marginTop: spacing.lg }} />
    </Section>
  );
}

function PasswordSection() {
  useScheme();
  const auth = useAuth();
  const action = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<PasswordChangeErrors>({});

  const submit = () => {
    const found = validatePasswordChange(current, next, confirm);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    action.run(async () => {
      await auth.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      return 'Your password was changed.';
    });
  };

  const common = { secureTextEntry: true, autoCapitalize: 'none' as const, autoCorrect: false, editable: !action.busy };

  return (
    <Section title="Password">
      <Field
        label="Current password"
        error={errors.current}
        inputProps={{ ...common, value: current, onChangeText: setCurrent, textContentType: 'password' }}
      />
      <Field
        label="New password"
        error={errors.password}
        inputProps={{ ...common, value: next, onChangeText: setNext, placeholder: 'At least 6 characters', textContentType: 'newPassword' }}
      />
      <Field
        label="Confirm new password"
        error={errors.confirm}
        inputProps={{ ...common, value: confirm, onChangeText: setConfirm, textContentType: 'newPassword', onSubmitEditing: submit }}
      />
      <Result error={action.error} info={action.info} />
      <Button label="Change password" onPress={submit} loading={action.busy} style={{ marginTop: spacing.lg }} />
    </Section>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  header: { alignItems: 'center', marginTop: spacing.md },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.accentStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 36, fontWeight: '800' },
  name: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: spacing.md },
  email: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowCount: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18, marginTop: spacing.md },
  success: { color: colors.success, fontSize: 13, lineHeight: 18, marginTop: spacing.md },
  footnote: { color: colors.textDim, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: spacing.md },
}));
