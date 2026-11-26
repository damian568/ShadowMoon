import { clampPercent, describeUpdate, updateErrorMessage, type UpdateSnapshot } from '../utils/appUpdate';

const idle: UpdateSnapshot = {
  enabled: true,
  checking: false,
  downloading: false,
  available: false,
  pending: false,
  restarting: false,
  checked: false,
};
const state = (over: Partial<UpdateSnapshot>): UpdateSnapshot => ({ ...idle, ...over });

describe('clampPercent', () => {
  it('turns 0-1 into a whole percentage', () => {
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(0.456)).toBe(46);
    expect(clampPercent(1)).toBe(100);
  });

  it('keeps out-of-range values inside 0-100', () => {
    expect(clampPercent(-0.5)).toBe(0);
    expect(clampPercent(3)).toBe(100);
  });

  it('is null when the size is not known (so the bar says "Starting…")', () => {
    expect(clampPercent(undefined)).toBeNull();
    expect(clampPercent(null)).toBeNull();
    expect(clampPercent(NaN)).toBeNull();
  });
});

describe('describeUpdate', () => {
  it('explains that updates are not available where the app cannot update itself', () => {
    const v = describeUpdate(state({ enabled: false, downloading: true, progress: 0.5 }));
    expect(v).toMatchObject({ phase: 'disabled', showBar: false, percent: null });
    expect(v.detail).toMatch(/Expo Go/);
  });

  it('shows the download progress as a percentage with a bar', () => {
    expect(describeUpdate(state({ downloading: true, progress: 0.42 }))).toMatchObject({
      phase: 'downloading',
      percent: 42,
      showBar: true,
      title: 'Downloading update',
    });
  });

  it('shows a starting state while the download size is not known yet', () => {
    const v = describeUpdate(state({ downloading: true }));
    expect(v).toMatchObject({ phase: 'downloading', percent: null, showBar: true });
    expect(v.detail).toMatch(/Starting/);
  });

  it('is ready to restart once the update is downloaded, at 100%', () => {
    expect(describeUpdate(state({ pending: true }))).toMatchObject({ phase: 'ready', percent: 100, showBar: true });
  });

  it('shows the update as still downloading even if it is also marked ready (restart not yet pressed)', () => {
    expect(describeUpdate(state({ downloading: true, progress: 0.9, pending: true })).phase).toBe('downloading');
  });

  it('shows restarting at 100%, ahead of everything else', () => {
    expect(describeUpdate(state({ restarting: true, pending: true, downloading: true }))).toMatchObject({ phase: 'restarting', percent: 100 });
  });

  it('reports an error with its message and no bar', () => {
    expect(describeUpdate(state({ error: 'Could not reach the update server.' }))).toMatchObject({
      phase: 'error',
      showBar: false,
      detail: 'Could not reach the update server.',
    });
  });

  it('checking, found and up to date', () => {
    expect(describeUpdate(state({ checking: true })).phase).toBe('checking');
    expect(describeUpdate(state({ available: true }))).toMatchObject({ phase: 'available', percent: 0, showBar: true });
    expect(describeUpdate(state({ checked: true })).phase).toBe('upToDate');
    expect(describeUpdate(idle).phase).toBe('idle');
  });
});

describe('updateErrorMessage', () => {
  it('is null when there is no error', () => {
    expect(updateErrorMessage(null)).toBeNull();
    expect(updateErrorMessage(undefined)).toBeNull();
  });

  it('gives a connection hint for network problems and a general message otherwise', () => {
    expect(updateErrorMessage(new Error('Network request failed'))).toMatch(/internet connection/);
    expect(updateErrorMessage(new Error('Failed to download update'))).toMatch(/internet connection/);
    expect(updateErrorMessage(new Error('boom'))).toMatch(/Something went wrong/);
  });
});
