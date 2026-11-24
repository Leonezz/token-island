/**
 * Categorical model colours for charts and tables.
 *
 * Uses the one 8-bit palette from `@token-island/core`: teal / purple / blue /
 * amber / green / red rotation for the dark theme, with darker stops for the
 * light theme so swatches stay readable on `#f4f2ff`.
 */

import { PIXEL } from '@token-island/core';

export const MODEL_COLORS = [
  PIXEL.teal,
  PIXEL.purple,
  PIXEL.blue,
  PIXEL.amber,
  PIXEL.green,
  PIXEL.red,
  PIXEL.mint,
  PIXEL.inkDim,
] as const;

export const MODEL_COLORS_LIGHT = [
  '#0b7a61',
  '#6c40c8',
  '#2f64d6',
  '#8a5f00',
  '#17864a',
  '#c23b3b',
  '#0b7a61',
  '#6f6a86',
] as const;

export function modelColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length] ?? MODEL_COLORS[0];
}

export function modelColorsFor(theme: 'dark' | 'light' | 'auto'): readonly string[] {
  return theme === 'light' ? MODEL_COLORS_LIGHT : MODEL_COLORS;
}
