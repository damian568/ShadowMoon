import { DEFAULT_SETTINGS, schemeFor } from '../store/reducer';
import { applyScheme, colors, currentScheme, palettes, statusColors, themedStyles } from '../theme';

afterEach(() => applyScheme('dark'));

/** WCAG relative luminance and contrast ratio of two #rrggbb colours. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('Dark and Light', () => {
  it('starts dark', () => {
    expect(DEFAULT_SETTINGS.appearance).toBe('dark');
    expect(currentScheme()).toBe('dark');
    expect(colors.bg).toBe(palettes.dark.bg);
  });

  it('is dark without an account, and for manga and manhwa; signed-in light novel readers follow their setting', () => {
    expect(schemeFor({ contentKind: 'novel', appearance: 'light' }, false)).toBe('dark'); // no account
    expect(schemeFor({ contentKind: 'manga', appearance: 'light' }, true)).toBe('dark'); // manga
    expect(schemeFor({ contentKind: 'manga', appearance: 'dark' }, true)).toBe('dark');
    expect(schemeFor({ contentKind: 'novel', appearance: 'light' }, true)).toBe('light');
    expect(schemeFor({ contentKind: 'novel', appearance: 'dark' }, true)).toBe('dark');
  });

  it('both schemes define every colour', () => {
    expect(Object.keys(palettes.light).sort()).toEqual(Object.keys(palettes.dark).sort());
  });

  it('applyScheme rewrites the live colours (and the status colours that follow them)', () => {
    applyScheme('light');
    expect(currentScheme()).toBe('light');
    expect(colors.bg).toBe(palettes.light.bg);
    expect(colors.text).toBe(palettes.light.text);
    expect(statusColors.reading).toBe(palettes.light.accent);
    expect(statusColors.later).toBe(palettes.light.warning);
    applyScheme('dark');
    expect(colors.bg).toBe(palettes.dark.bg);
    expect(statusColors.completed).toBe(palettes.dark.success);
  });

  it('themed styles are rebuilt after a switch, and only then', () => {
    const make = jest.fn(() => ({ box: { backgroundColor: colors.bg }, label: { color: colors.text } }));
    const styles = themedStyles(make);
    expect(styles.box.backgroundColor).toBe(palettes.dark.bg);
    expect(styles.label.color).toBe(palettes.dark.text);
    expect(make).toHaveBeenCalledTimes(1); // built once, reused
    applyScheme('light');
    expect(styles.box.backgroundColor).toBe(palettes.light.bg);
    expect(make).toHaveBeenCalledTimes(2);
    applyScheme('light'); // already light: nothing changes
    expect(styles.label.color).toBe(palettes.light.text);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('keeps text readable in both schemes', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const p = palettes[scheme];
      expect(contrast(p.text, p.bg)).toBeGreaterThan(7);
      expect(contrast(p.text, p.surface)).toBeGreaterThan(7);
      expect(contrast(p.textMuted, p.bg)).toBeGreaterThan(4.5);
      expect(contrast(p.accent, p.bg)).toBeGreaterThan(4.5); // links and active icons
      // White (bold) text on primary buttons. The dark palette's button colour is the app's original design.
      expect(contrast('#ffffff', p.accentStrong)).toBeGreaterThan(scheme === 'light' ? 4.5 : 4);
    }
  });
});
