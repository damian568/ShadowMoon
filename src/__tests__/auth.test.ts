import {
  MIN_PASSWORD_LENGTH,
  friendlyAuthError,
  validateEmail,
  validateLogin,
  validateRegister,
} from '../utils/auth';

describe('validateEmail', () => {
  it.each(['a@b.co', 'name.surname+tag@example.com', '  padded@example.org  '])('accepts %p', (email) => {
    expect(validateEmail(email)).toBeUndefined();
  });

  it('asks for an email when empty or blank', () => {
    expect(validateEmail('')).toBe('Enter your email address.');
    expect(validateEmail('   ')).toBe('Enter your email address.');
  });

  it.each(['plainaddress', 'missing@tld', '@no-local.com', 'two@@example.com', 'spa ce@example.com'])(
    'rejects %p',
    (email) => {
      expect(validateEmail(email)).toBe('Enter a valid email address.');
    },
  );
});

describe('validateLogin', () => {
  it('passes with an email and any password', () => {
    expect(validateLogin('me@example.com', 'x')).toEqual({});
  });

  it('reports every problem at once', () => {
    expect(validateLogin('', '')).toEqual({ email: 'Enter your email address.', password: 'Enter your password.' });
  });

  it('does not enforce the minimum length on sign in (old passwords must still work)', () => {
    expect(validateLogin('me@example.com', '1').password).toBeUndefined();
  });
});

describe('validateRegister', () => {
  const ok = 'a-good-password';

  it('passes with a valid email and matching strong-enough passwords', () => {
    expect(validateRegister('me@example.com', ok, ok)).toEqual({});
  });

  it('requires a password and checks its length', () => {
    expect(validateRegister('me@example.com', '', '').password).toBe('Choose a password.');
    const tooShort = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateRegister('me@example.com', tooShort, tooShort).password).toBe(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    const justEnough = 'x'.repeat(MIN_PASSWORD_LENGTH);
    expect(validateRegister('me@example.com', justEnough, justEnough)).toEqual({});
  });

  it('requires the confirmation to match', () => {
    expect(validateRegister('me@example.com', ok, 'different')).toEqual({ confirm: 'The passwords do not match.' });
    expect(validateRegister('me@example.com', ok, '')).toEqual({ confirm: 'The passwords do not match.' });
  });

  it('does not nag about the confirmation while no password is typed yet', () => {
    expect(validateRegister('me@example.com', '', 'anything').confirm).toBeUndefined();
  });

  it('validates the email too', () => {
    expect(validateRegister('nope', ok, ok)).toEqual({ email: 'Enter a valid email address.' });
  });
});

describe('friendlyAuthError', () => {
  const fire = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

  it.each([
    ['auth/wrong-password', 'Wrong email or password.'],
    ['auth/user-not-found', 'Wrong email or password.'],
    ['auth/invalid-credential', 'Wrong email or password.'],
    ['auth/invalid-login-credentials', 'Wrong email or password.'],
    ['auth/invalid-email', 'That email address is not valid.'],
    ['auth/email-already-in-use', 'An account with this email already exists. Try signing in instead.'],
    ['auth/too-many-requests', 'Too many attempts. Wait a few minutes and try again.'],
    ['auth/network-request-failed', 'No connection. Check your internet and try again.'],
    ['auth/user-disabled', 'This account has been disabled.'],
  ])('maps %s', (code, message) => {
    expect(friendlyAuthError(fire(code))).toBe(message);
  });

  it('mentions the minimum length for a weak password', () => {
    expect(friendlyAuthError(fire('auth/weak-password'))).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('tells you when email/password sign-in is not enabled in the Firebase project', () => {
    expect(friendlyAuthError(fire('auth/operation-not-allowed'))).toMatch(/not turned on/);
  });

  it('does not reveal whether an email has an account (same message for unknown user and wrong password)', () => {
    expect(friendlyAuthError(fire('auth/user-not-found'))).toBe(friendlyAuthError(fire('auth/wrong-password')));
  });

  it('never shows raw Firebase text for unknown errors', () => {
    const message = friendlyAuthError(fire('auth/some-new-code'));
    expect(message).toBe('Something went wrong. Please try again.');
    expect(message).not.toMatch(/firebase|auth\//i);
  });

  it('copes with things that are not errors', () => {
    expect(friendlyAuthError(undefined)).toBe('Something went wrong. Please try again.');
    expect(friendlyAuthError(null)).toBe('Something went wrong. Please try again.');
    expect(friendlyAuthError('boom')).toBe('Something went wrong. Please try again.');
    expect(friendlyAuthError(new Error('plain'))).toBe('Something went wrong. Please try again.');
  });
});
