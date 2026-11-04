export const colors = {
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
};

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const statusLabels = {
  reading: 'Reading',
  completed: 'Done',
  later: 'For later',
} as const;

export const statusColors = {
  reading: colors.accent,
  completed: colors.success,
  later: colors.warning,
} as const;

export const typeColors: Record<string, string> = {
  manga: '#7FB2FF',
  manhwa: '#B48CFF',
  manhua: '#FF9F7F',
  other: '#9A96BD',
};
