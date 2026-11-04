/** Form validation and friendly error messages for the sign-in screens. Pure functions, easy to test. */

export interface FieldErrors {
  email?: string;
  password?: string;
  confirm?: string;
}

/** Firebase's own minimum for email/password accounts. */
export const MIN_PASSWORD_LENGTH = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  const v = email.trim();
  if (!v) return 'Enter your email address.';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address.';
  return undefined;
}

export function validateLogin(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

export function validateRegister(email: string, password: string, confirm: string): FieldErrors {
  const errors: FieldErrors = {};
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  if (!password) errors.password = 'Choose a password.';
  else if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password && confirm !== password) errors.confirm = 'The passwords do not match.';
  return errors;
}

// ---------------------------------------------------------------------------
// Profile: nickname, email and password changes
// ---------------------------------------------------------------------------

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 24;

/** Trim a nickname and collapse runs of spaces. */
export const normalizeNickname = (name: string): string => name.trim().replace(/\s+/g, ' ');

export function validateNickname(name: string): string | undefined {
  const v = normalizeNickname(name);
  const length = [...v].length; // count characters, not UTF-16 units
  if (length < NICKNAME_MIN) return `Use at least ${NICKNAME_MIN} characters.`;
  if (length > NICKNAME_MAX) return `Use at most ${NICKNAME_MAX} characters.`;
  if (/[\u0000-\u001F\u007F]/.test(v)) return 'Remove the special characters.';
  return undefined;
}

/** What to call the user: their nickname, else the part of their email before the @, else a neutral word. */
export function nicknameFor(user: { displayName?: string | null; email?: string | null } | null | undefined): string {
  const name = normalizeNickname(user?.displayName ?? '');
  if (name) return name;
  const local = (user?.email ?? '').split('@')[0].trim();
  return local || 'Reader';
}

export interface EmailChangeErrors {
  email?: string;
  password?: string;
}

export function validateEmailChange(newEmail: string, currentEmail: string | null, password: string): EmailChangeErrors {
  const errors: EmailChangeErrors = {};
  const emailError = validateEmail(newEmail);
  if (emailError) errors.email = emailError;
  else if (currentEmail && newEmail.trim().toLowerCase() === currentEmail.toLowerCase()) {
    errors.email = 'That is already your email address.';
  }
  if (!password) errors.password = 'Enter your current password to confirm.';
  return errors;
}

export interface PasswordChangeErrors {
  current?: string;
  password?: string;
  confirm?: string;
}

export function validatePasswordChange(current: string, next: string, confirm: string): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {};
  if (!current) errors.current = 'Enter your current password.';
  if (!next) errors.password = 'Choose a new password.';
  else if (next.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (next === current) errors.password = 'Choose a password different from the current one.';
  if (next && confirm !== next) errors.confirm = 'The passwords do not match.';
  return errors;
}

/** True when Firebase rejected a password because it was wrong (the codes it uses for that vary by version). */
export function isWrongCredential(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  return code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials';
}

/** Turns a Firebase Auth error (or anything thrown) into a message a person can act on. */
export function friendlyAuthError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Wrong email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return `Choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`;
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/operation-not-allowed':
      return 'Email and password sign-in is not turned on for this project yet.';
    case 'auth/requires-recent-login':
      return 'For security, sign in again and retry.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
