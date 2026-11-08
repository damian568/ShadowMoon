import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../store/auth';
import { useScheme } from '../store/appearance';
import { colors, radius, spacing, themedStyles } from '../theme';
import { validateEmail, validateLogin, validateRegister, type FieldErrors } from '../utils/auth';
import { Button } from './ui';

type InputHandle = React.ComponentRef<typeof TextInput>;

const NOT_CONFIGURED_NOTICE =
  'Accounts are not connected yet, so you cannot sign in for now. Your library keeps working on this phone.';

/** Leave the sign-in screen: go back if we were opened from another screen, otherwise to the home tab. */
function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  useScheme();
  const auth = useAuth();
  const isRegister = mode === 'register';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordRef = useRef<InputHandle>(null);
  const confirmRef = useRef<InputHandle>(null);

  const submit = async () => {
    if (busy) return;
    const found = isRegister ? validateRegister(email, password, confirm) : validateLogin(email, password);
    setErrors(found);
    setFormError(null);
    setInfo(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      if (isRegister) await auth.register(email, password);
      else await auth.signIn(email, password);
      close();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    setFormError(null);
    setInfo(null);
    const emailError = validateEmail(email);
    if (emailError) {
      setErrors({ email: emailError });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await auth.resetPassword(email);
      setInfo(`We sent a password reset link to ${email.trim()}. Check your inbox (and spam folder).`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => router.replace(isRegister ? '/auth/login' : '/auth/register');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.logo}>
          <Ionicons name="moon" size={34} color={colors.accent} />
        </View>
        <Text style={styles.title}>{isRegister ? 'Create your account' : 'Welcome back'}</Text>
        <Text style={styles.subtitle}>
          {isRegister
            ? 'Keep your favourites and reading progress safe, and get them on any phone you sign in on.'
            : 'Sign in to get your favourites and reading progress on this phone.'}
        </Text>

        {!auth.configured && (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color={colors.moon} />
            <Text style={styles.noticeText}>{NOT_CONFIGURED_NOTICE}</Text>
          </View>
        )}

        <Field
          label="Email"
          error={errors.email}
          inputProps={{
            value: email,
            onChangeText: setEmail,
            placeholder: 'you@example.com',
            autoCapitalize: 'none',
            autoCorrect: false,
            keyboardType: 'email-address',
            textContentType: 'emailAddress',
            autoComplete: 'email',
            returnKeyType: 'next',
            editable: !busy,
            onSubmitEditing: () => passwordRef.current?.focus(),
          }}
        />

        <Field
          label="Password"
          error={errors.password}
          inputRef={passwordRef}
          inputProps={{
            value: password,
            onChangeText: setPassword,
            placeholder: isRegister ? 'At least 6 characters' : 'Your password',
            secureTextEntry: !showPassword,
            autoCapitalize: 'none',
            autoCorrect: false,
            textContentType: isRegister ? 'newPassword' : 'password',
            autoComplete: isRegister ? 'new-password' : 'current-password',
            returnKeyType: isRegister ? 'next' : 'go',
            editable: !busy,
            onSubmitEditing: () => (isRegister ? confirmRef.current?.focus() : submit()),
          }}
          right={
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
            </Pressable>
          }
        />

        {isRegister && (
          <Field
            label="Confirm password"
            error={errors.confirm}
            inputRef={confirmRef}
            inputProps={{
              value: confirm,
              onChangeText: setConfirm,
              placeholder: 'Repeat your password',
              secureTextEntry: !showPassword,
              autoCapitalize: 'none',
              autoCorrect: false,
              textContentType: 'newPassword',
              returnKeyType: 'go',
              editable: !busy,
              onSubmitEditing: submit,
            }}
          />
        )}

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}

        <Button
          label={isRegister ? 'Create account' : 'Sign in'}
          onPress={submit}
          loading={busy}
          disabled={!auth.configured}
          style={{ marginTop: spacing.lg }}
        />

        {!isRegister && (
          <Pressable onPress={forgotPassword} disabled={busy || !auth.configured} hitSlop={8} style={styles.linkWrap}>
            <Text style={styles.link}>Forgot your password?</Text>
          </Pressable>
        )}

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>{isRegister ? 'Already have an account?' : 'New to ShadowMoon?'}</Text>
          <Pressable onPress={switchMode} hitSlop={8}>
            <Text style={styles.link}>{isRegister ? 'Sign in' : 'Create an account'}</Text>
          </Pressable>
        </View>

        <Pressable onPress={close} hitSlop={8} style={styles.linkWrap}>
          <Text style={styles.skip}>Not now, continue without an account</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Field({ label, error, inputProps, inputRef, right }: {
  label: string;
  error?: string;
  inputProps: React.ComponentProps<typeof TextInput>;
  inputRef?: React.Ref<InputHandle>;
  right?: React.ReactNode;
}) {
  useScheme();
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, !!error && { borderColor: colors.danger }]}>
        <TextInput ref={inputRef} placeholderTextColor={colors.textDim} style={styles.input} {...inputProps} />
        {right}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  content: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: 48 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: spacing.lg },
  subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: spacing.sm },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  noticeText: { flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: spacing.xs },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 50,
    gap: spacing.sm,
  },
  input: { flex: 1, color: colors.text, fontSize: 16, height: '100%' },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
  formError: { color: colors.danger, fontSize: 13, lineHeight: 18, marginTop: spacing.lg, textAlign: 'center' },
  info: { color: colors.success, fontSize: 13, lineHeight: 18, marginTop: spacing.lg, textAlign: 'center' },
  linkWrap: { alignSelf: 'center', marginTop: spacing.lg },
  link: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl },
  switchText: { color: colors.textMuted, fontSize: 14 },
  skip: { color: colors.textMuted, fontSize: 13 },
}));
