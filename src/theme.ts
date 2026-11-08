/**
 * App colours, in two schemes (dark and light).
 *
 * `colors` is a live palette: `applyScheme()` rewrites its values in place, and screens read it while rendering.
 * Styles that use it are made with `themedStyles` (a `StyleSheet.create` that is rebuilt after a switch). The
 * `AppearanceProvider` (src/store/appearance.tsx) applies the chosen scheme and re-renders the app when it changes;
 * components call `useScheme()` so they re-render too.
 */
export type Scheme = 'dark' | 'light';

const dark = {
  bg: '#0A0A14',
  surface: '#151527',
  surfaceAlt: '#1E1E36',
  border: '#2A2A48',
  text: '#EEEBFF',
  textMuted: '#9A96BD',
  textDim: '#6B6890',
  accent: '#9D8CFF',
  accentStrong: '#7B68EE',
  accentSoft: 'rgba(157, 140, 255, 0.16)',
  moon: '#E9E4FF',
  favorite: '#FF6B9A',
  success: '#4ADE9B',
  warning: '#FFC266',
  danger: '#FF5C7A',
  overlay: 'rgba(5, 5, 12, 0.88)',
  /** A quiet button/control background on top of the page. */
  control: 'rgba(255,255,255,0.08)',
  /** Tint laid over a blurred cover so text on top stays readable. */
  scrim: 'rgba(10,10,20,0.55)',
};

export type Palette = { [K in keyof typeof dark]: string };

const light: Palette = {
  bg: '#F6F4FB',
  surface: '#FFFFFF',
  surfaceAlt: '#ECE9F7',
  border: '#DDD8EE',
  text: '#1B1830',
  textMuted: '#5F5B7E',
  textDim: '#8A86A6',
  accent: '#6A57E0',
  accentStrong: '#5B47D6',
  accentSoft: 'rgba(91, 71, 214, 0.12)',
  moon: '#3B2FA0',
  favorite: '#E0457B',
  success: '#12A05F',
  warning: '#C98200',
  danger: '#D63B5A',
  overlay: 'rgba(246, 244, 251, 0.94)',
  control: 'rgba(0,0,0,0.07)',
  scrim: 'rgba(246,244,251,0.62)',
};

export const palettes: Record<Scheme, Palette> = { dark, light };

/** The dark palette, fixed: for screens that are always dark (the picture reader). */
export const darkColors: Palette = dark;

/** The live palette: always the colours of the scheme in use. */
export const colors: Palette = { ...dark };

export const statusLabels = {
  reading: 'Reading',
  completed: 'Done',
  later: 'For later',
} as const;

/** Live like `colors` (they follow the scheme's accent, green and amber). */
export const statusColors = {
  reading: colors.accent,
  completed: colors.success,
  later: colors.warning,
};

/** Badge colours: pastel, with dark text, so the same in both schemes. */
export const typeColors: Record<string, string> = {
  manga: '#7FB2FF',
  manhwa: '#B48CFF',
  manhua: '#FF9F7F',
  novel: '#6FD6B0',
  other: '#9A96BD',
};

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

let scheme: Scheme = 'dark';
let version = 0;

export const currentScheme = () => scheme;

/** Switch the live palette to a scheme. Does nothing when it is already in use. */
export function applyScheme(next: Scheme) {
  if (next === scheme) return;
  scheme = next;
  version++;
  Object.assign(colors, palettes[next]);
  statusColors.reading = colors.accent;
  statusColors.completed = colors.success;
  statusColors.later = colors.warning;
}

/**
 * A `StyleSheet.create` whose values come from `colors`. The styles are built on first use and rebuilt after the
 * scheme changed, so write `const styles = themedStyles(() => StyleSheet.create({ ... }))`.
 */
export function themedStyles<T extends object>(make: () => T): T {
  let cache: T | undefined;
  let builtFor = -1;
  return new Proxy({} as T, {
    get(_, key) {
      if (!cache || builtFor !== version) {
        cache = make();
        builtFor = version;
      }
      return (cache as Record<string | symbol, unknown>)[key];
    },
  });
}
