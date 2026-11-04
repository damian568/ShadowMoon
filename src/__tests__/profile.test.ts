import { DEFAULT_SETTINGS, reducer, type Action, type MangaLite, type State } from '../store/reducer';
import { signOutSafely, type SignOutSteps } from '../sync/signout';
import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  isWrongCredential,
  nicknameFor,
  normalizeNickname,
  validateEmailChange,
  validateNickname,
  validatePasswordChange,
} from '../utils/auth';

describe('nickname', () => {
  it('normalises spaces', () => {
    expect(normalizeNickname('  Moon   Reader  ')).toBe('Moon Reader');
  });

  it('accepts names of a sensible length, including accents and other alphabets', () => {
    for (const ok of ['Al', 'Damyan', 'Moon Reader', 'Даниел', 'Zoë', 'x'.repeat(NICKNAME_MAX)]) {
      expect(validateNickname(ok)).toBeUndefined();
    }
  });

  it('rejects too short and too long names', () => {
    expect(validateNickname('')).toBe(`Use at least ${NICKNAME_MIN} characters.`);
    expect(validateNickname('   a   ')).toBe(`Use at least ${NICKNAME_MIN} characters.`);
    expect(validateNickname('x'.repeat(NICKNAME_MAX + 1))).toBe(`Use at most ${NICKNAME_MAX} characters.`);
  });

  it('counts characters, not code units (an emoji is one character)', () => {
    expect(validateNickname('🌙'.repeat(NICKNAME_MAX))).toBeUndefined();
    expect(validateNickname('🌙'.repeat(NICKNAME_MAX + 1))).toBeDefined();
  });

  it('rejects control characters', () => {
    expect(validateNickname('bad\u0000name')).toBe('Remove the special characters.');
  });

  it('nicknameFor prefers the nickname, then the email name, then a neutral word', () => {
    expect(nicknameFor({ displayName: '  Moon  Reader ', email: 'a@b.co' })).toBe('Moon Reader');
    expect(nicknameFor({ displayName: null, email: 'damyan@example.com' })).toBe('damyan');
    expect(nicknameFor({ displayName: '', email: '@example.com' })).toBe('Reader');
    expect(nicknameFor(null)).toBe('Reader');
    expect(nicknameFor(undefined)).toBe('Reader');
  });
});

describe('validateEmailChange', () => {
  it('passes with a new valid email and a password', () => {
    expect(validateEmailChange('new@example.com', 'old@example.com', 'secret')).toEqual({});
  });

  it('needs a valid new email and the current password', () => {
    expect(validateEmailChange('', 'old@example.com', '')).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your current password to confirm.',
    });
    expect(validateEmailChange('nope', 'old@example.com', 'x').email).toBe('Enter a valid email address.');
  });

  it('rejects the email you already have, ignoring case and spaces', () => {
    expect(validateEmailChange('  OLD@example.com ', 'old@example.com', 'x').email).toBe('That is already your email address.');
  });
});

describe('validatePasswordChange', () => {
  it('passes with a different, long enough, confirmed password', () => {
    expect(validatePasswordChange('old-password', 'new-password', 'new-password')).toEqual({});
  });

  it('asks for every missing piece', () => {
    expect(validatePasswordChange('', '', '')).toEqual({
      current: 'Enter your current password.',
      password: 'Choose a new password.',
    });
  });

  it('checks the length, that it differs from the current one, and the confirmation', () => {
    expect(validatePasswordChange('old-password', '12345', '12345').password).toBe('Use at least 6 characters.');
    expect(validatePasswordChange('same-password', 'same-password', 'same-password').password).toBe(
      'Choose a password different from the current one.',
    );
    expect(validatePasswordChange('old-password', 'new-password', 'other').confirm).toBe('The passwords do not match.');
  });
});

describe('isWrongCredential', () => {
  it.each(['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'])('%s means a wrong password', (code) => {
    expect(isWrongCredential({ code })).toBe(true);
  });

  it('is false for other errors and for things that are not errors', () => {
    expect(isWrongCredential({ code: 'auth/network-request-failed' })).toBe(false);
    expect(isWrongCredential(new Error('x'))).toBe(false);
    expect(isWrongCredential(null)).toBe(false);
  });
});

describe('resetAll (signing out)', () => {
  const manga: MangaLite = { id: 'm1', title: 'Manga One', coverUrl: '', type: 'manhwa' };
  const run = (state: State, ...actions: Action[]) => actions.reduce(reducer, state);
  const used = (): State =>
    run(
      { hydrated: true, entries: {}, settings: DEFAULT_SETTINGS, lastUpdateCheck: null, syncedUid: null },
      { type: 'toggleFavorite', manga },
      { type: 'setRead', manga, keys: ['1', '2'], read: true },
      { type: 'settings', patch: { dataSaver: true, readerMode: 'paged', language: 'es' } },
      { type: 'adoptAccount', uid: 'alice' },
      { type: 'applyUpdates', results: [], at: 123 },
    );

  it('empties the library and puts every setting back to its default', () => {
    const before = used();
    expect(Object.keys(before.entries)).toEqual(['m1']);
    expect(before.settings.dataSaver).toBe(true);
    expect(before.syncedUid).toBe('alice');

    const after = reducer(before, { type: 'resetAll' });
    expect(after.entries).toEqual({});
    expect(after.settings).toEqual(DEFAULT_SETTINGS);
    expect(after.lastUpdateCheck).toBeNull();
    expect(after.syncedUid).toBeNull();
    expect(after.hydrated).toBe(true);
  });

  it('lets the next person start fresh: a different account does not inherit anything', () => {
    const afterSignOut = reducer(used(), { type: 'resetAll' });
    const bob = reducer(afterSignOut, { type: 'adoptAccount', uid: 'bob' });
    expect(bob.entries).toEqual({});
    expect(bob.syncedUid).toBe('bob');
  });
});

describe('signOutSafely', () => {
  const steps = (over: Partial<SignOutSteps> = {}) => {
    const calls: string[] = [];
    const s: SignOutSteps = {
      flush: jest.fn(async () => {
        calls.push('flush');
        return true;
      }),
      confirmLoss: jest.fn(async () => {
        calls.push('confirmLoss');
        return true;
      }),
      signOut: jest.fn(async () => {
        calls.push('signOut');
      }),
      reset: jest.fn(async () => {
        calls.push('reset');
      }),
      ...over,
    };
    return { s, calls };
  };

  it('saves first, signs out, and only then clears the phone', async () => {
    const { s, calls } = steps();
    await expect(signOutSafely(s)).resolves.toBe('signed-out');
    expect(calls).toEqual(['flush', 'signOut', 'reset']);
  });

  it('does not ask anything when everything was saved', async () => {
    const { s } = steps();
    await signOutSafely(s);
    expect(s.confirmLoss).not.toHaveBeenCalled();
  });

  it('asks before throwing away changes that could not be saved, and stops if the user says no', async () => {
    const { s, calls } = steps({
      flush: jest.fn(async () => false),
      confirmLoss: jest.fn(async () => false),
    });
    await expect(signOutSafely(s)).resolves.toBe('cancelled');
    expect(s.confirmLoss).toHaveBeenCalledTimes(1);
    expect(s.signOut).not.toHaveBeenCalled();
    expect(s.reset).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('signs out and clears the phone when the user accepts losing unsaved changes', async () => {
    const { s } = steps({ flush: jest.fn(async () => false), confirmLoss: jest.fn(async () => true) });
    await expect(signOutSafely(s)).resolves.toBe('signed-out');
    expect(s.signOut).toHaveBeenCalled();
    expect(s.reset).toHaveBeenCalled();
  });

  it('treats a failed save like "not saved" (asks), instead of crashing or silently continuing', async () => {
    const { s } = steps({
      flush: jest.fn(async () => {
        throw new Error('offline');
      }),
      confirmLoss: jest.fn(async () => false),
    });
    await expect(signOutSafely(s)).resolves.toBe('cancelled');
    expect(s.confirmLoss).toHaveBeenCalled();
    expect(s.reset).not.toHaveBeenCalled();
  });

  it('never clears the phone when signing out itself fails', async () => {
    const { s } = steps({
      signOut: jest.fn(async () => {
        throw new Error('Could not sign out');
      }),
    });
    await expect(signOutSafely(s)).rejects.toThrow('Could not sign out');
    expect(s.reset).not.toHaveBeenCalled();
  });
});
