/** Design tokens for the WebGL scene. Mirrors tokens.css. No business logic here. No gold. */
export const palette = {
  obsidian: '#070809',
  charcoal: '#0D0F11',
  graphite: '#131518',
  gunmetal: '#2C3036',
  steel: '#6E757D',
  steelBright: '#A4AAB0',
  /** Cool pale steel — cross-links and secondary emphasis. */
  emphasis: '#C4C8CC',
  /** Muted ivory — the selected idea. */
  emphasisBright: '#ECE9E3',
  ivory: '#DCD8D0',
  oxblood: '#8E3A35',
  verdigris: '#74867B',
} as const;

/** Curated, desaturated colours a user may assign to an idea (legible against obsidian; no gold). */
export const nodeSwatches = ['#A4AAB0', '#8C9A8F', '#9C7F7C', '#8E8A9E', '#B3AFA8', '#7D8E95', '#6F7F70'] as const;
