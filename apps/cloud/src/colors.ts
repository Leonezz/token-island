/**
 * Shared colour tokens for generated SVGs and the HTML pages.
 *
 * The dark palette is the "GitHub dark" language from the contract; the light
 * palette is tuned so accent fills still hit >= 4.5:1 contrast with the text
 * colour picked by `contrastText()` in `svg/util.ts`.
 */

/** Model colour ramp (dark theme).  Index order matches the models chart. */
export const MODEL_COLORS = [
  '#5EEAD4',
  '#A78BFA',
  '#60A5FA',
  '#FBBF24',
  '#34D399',
  '#F472B6',
  '#22D3EE',
  '#FB923C',
] as const;

/** Model colour ramp (light theme, darker variants for white backgrounds). */
export const MODEL_COLORS_LIGHT = [
  '#0D9488',
  '#7C3AED',
  '#2563EB',
  '#B45309',
  '#059669',
  '#DB2777',
  '#0E7490',
  '#C2410C',
] as const;

export function modelColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length] ?? MODEL_COLORS[0];
}
