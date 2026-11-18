/** Design tokens for the WebGL scene. Mirrors tokens.css. No business logic here. */
export const palette = {
  obsidian: '#080B0F',
  graphite: '#141A22',
  gunmetal: '#283441',
  steel: '#61798C',
  steelBright: '#8FA9BE',
  gold: '#B39A70',
  goldBright: '#D2B98C',
  ivory: '#E8E4DC',
  oxblood: '#9A3B34',
  verdigris: '#6F9583',
} as const;

/** Curated colours a user may assign to an idea (all legible against obsidian). */
export const nodeSwatches = ['#8FA9BE', '#B39A70', '#A9B7A0', '#B48A86', '#9A8FB8', '#C9C1AE', '#7FA3A6'] as const;
