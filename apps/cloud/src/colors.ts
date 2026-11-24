/**
 * Categorical model colours for charts and tables (Precision Telemetry v4).
 *
 * Uses high-contrast emerald, sky, amber, rose, mint, cyan, lime and slate stops
 * (strictly avoiding low-contrast purple on dark backgrounds).
 */

import { TELEMETRY_SERIES, TELEMETRY_SERIES_LIGHT } from '@token-island/core';

export const MODEL_COLORS = TELEMETRY_SERIES;

export const MODEL_COLORS_LIGHT = TELEMETRY_SERIES_LIGHT;

export function modelColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length] ?? MODEL_COLORS[0]!;
}

export function modelColorsFor(theme: 'dark' | 'light' | 'auto'): readonly string[] {
  return theme === 'light' ? MODEL_COLORS_LIGHT : MODEL_COLORS;
}
