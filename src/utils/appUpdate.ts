/**
 * What the "App update" screens show. This is plain logic (no expo-updates import), so it can be tested:
 * the screens turn the update library's state into an `UpdateSnapshot` and show whatever `describeUpdate` says.
 */
export interface UpdateSnapshot {
  /** False in Expo Go, while developing and on the web: the app cannot update itself there. */
  enabled: boolean;
  checking: boolean;
  downloading: boolean;
  /** 0 to 1 while downloading, when the server tells the size. */
  progress?: number;
  /** An update has been found but its download has not started yet. */
  available: boolean;
  /** Downloaded; the app has to restart to use it. */
  pending: boolean;
  restarting: boolean;
  /** A check has finished since the app started. */
  checked: boolean;
  error?: string | null;
}

export type UpdatePhase = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'restarting' | 'error' | 'upToDate';

export interface UpdateView {
  phase: UpdatePhase;
  /** 0-100 for the progress bar, or null while the size is not known yet. */
  percent: number | null;
  /** Whether a progress bar is part of this state. */
  showBar: boolean;
  title: string;
  detail: string;
}

export const clampPercent = (progress: number | undefined | null): number | null =>
  typeof progress === 'number' && Number.isFinite(progress) ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : null;

export function describeUpdate(s: UpdateSnapshot): UpdateView {
  if (!s.enabled) {
    return {
      phase: 'disabled',
      percent: null,
      showBar: false,
      title: 'Updates are not available here',
      detail: 'ShadowMoon updates itself when it is installed on the phone. This is not available in Expo Go or while developing.',
    };
  }
  if (s.restarting) {
    return { phase: 'restarting', percent: 100, showBar: true, title: 'Restarting…', detail: 'Opening the new version.' };
  }
  if (s.downloading) {
    const percent = clampPercent(s.progress);
    return {
      phase: 'downloading',
      percent,
      showBar: true,
      title: 'Downloading update',
      detail: percent == null ? 'Starting the download…' : 'Keep the app open until it finishes.',
    };
  }
  if (s.pending) {
    return { phase: 'ready', percent: 100, showBar: true, title: 'Update ready', detail: 'Restart to use the new version.' };
  }
  if (s.error) {
    return { phase: 'error', percent: null, showBar: false, title: 'The update did not finish', detail: s.error };
  }
  if (s.checking) {
    return { phase: 'checking', percent: null, showBar: false, title: 'Checking for updates…', detail: 'Asking the update server.' };
  }
  if (s.available) {
    return { phase: 'available', percent: 0, showBar: true, title: 'Update found', detail: 'Starting the download…' };
  }
  if (s.checked) {
    return { phase: 'upToDate', percent: null, showBar: false, title: 'You are up to date', detail: 'This is the newest version.' };
  }
  return { phase: 'idle', percent: null, showBar: false, title: 'App updates', detail: 'Check whether a newer version is available.' };
}

/** A short, friendly message for an error from the update library. */
export function updateErrorMessage(error: { message?: string } | null | undefined): string | null {
  if (!error) return null;
  const m = (error.message ?? '').toLowerCase();
  if (/network|internet|offline|connect|timed? ?out|unable to resolve|failed to download/.test(m)) {
    return 'Could not reach the update server. Check your internet connection and try again.';
  }
  return 'Something went wrong while updating. Try again in a moment.';
}
