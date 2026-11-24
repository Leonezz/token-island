/**
 * GENERATED FILE — do not edit by hand.
 *
 * Silkscreen (OFL) glyphs on their native 8px grid, baseline-aligned.
 * `top` = first ink row relative to baseline (negative = above baseline).
 * Regenerate: python3 assets/fonts/extract_pixel_font.py
 */

export interface PixelGlyph {
  /** Advance width in design pixels. */
  readonly advance: number;
  /** First ink row relative to the baseline (negative = above). */
  readonly top: number;
  /** Ink rows, made of '#' and '.'. */
  readonly rows: readonly string[];
}

/** Height of capital letters above the baseline, in design pixels. */
export const PIXEL_FONT_CAP_HEIGHT = 5;

/** Recommended single-line box height (cap height + baseline row). */
export const PIXEL_FONT_TEXT_HEIGHT = 6;

/** Tallest ascent in the font (some punctuation is above cap height). */
export const PIXEL_FONT_ASCENT = 8;

/** Deepest descent in the font (always 0 for Silkscreen). */
export const PIXEL_FONT_DESCENT = 1;

/** Design pixels per named size step (keeps typography on the pixel grid). */
export const PIXEL_TYPE_SCALE = { micro: 1, tiny: 2, small: 2, body: 3, large: 4, hero: 6 } as const;

export const PIXEL_GLYPHS: Readonly<Record<string, PixelGlyph>> = {
  " ": { advance: 4, top: 0, rows: [] },
  "!": { advance: 3, top: -5, rows: ["#", "#", "#", ".", "#"] },
  "\"": { advance: 5, top: -5, rows: ["#.#", "#.#"] },
  "#": { advance: 7, top: -5, rows: [".#.#.", "#####", ".#.#.", "#####", ".#.#."] },
  "$": { advance: 6, top: -6, rows: ["..#.", ".###", "#...", ".##.", "...#", "###.", ".#.."] },
  "%": { advance: 7, top: -5, rows: ["##.#.", "##.#.", "..#..", ".#.##", ".#.##"] },
  "&": { advance: 6, top: -6, rows: ["..#.", ".###", "#...", ".##.", "#...", ".###", "..#."] },
  "'": { advance: 3, top: -5, rows: ["#", "#"] },
  "(": { advance: 4, top: -5, rows: [".#", "#.", "#.", "#.", ".#"] },
  ")": { advance: 4, top: -5, rows: ["#.", ".#", ".#", ".#", "#."] },
  "*": { advance: 7, top: -5, rows: ["..#..", "#.#.#", ".###.", "#.#.#", "..#.."] },
  "+": { advance: 7, top: -5, rows: ["..#..", "..#..", "#####", "..#..", "..#.."] },
  ",": { advance: 4, top: -2, rows: [".#", "#."] },
  "-": { advance: 5, top: -3, rows: ["###"] },
  ".": { advance: 3, top: -2, rows: ["#"] },
  "/": { advance: 5, top: -5, rows: ["..#", "..#", ".#.", "#..", "#.."] },
  "0": { advance: 6, top: -5, rows: [".##.", "#..#", "#..#", "#..#", ".##."] },
  "1": { advance: 5, top: -5, rows: ["##.", ".#.", ".#.", ".#.", "###"] },
  "2": { advance: 6, top: -5, rows: ["###.", "...#", ".##.", "#...", "####"] },
  "3": { advance: 6, top: -5, rows: ["###.", "...#", ".##.", "...#", "###."] },
  "4": { advance: 6, top: -5, rows: ["#.#.", "#.#.", "####", "..#.", "..#."] },
  "5": { advance: 6, top: -5, rows: ["####", "#...", "###.", "...#", "###."] },
  "6": { advance: 6, top: -5, rows: [".##.", "#...", "###.", "#..#", ".##."] },
  "7": { advance: 6, top: -5, rows: ["####", "...#", "..#.", ".#..", ".#.."] },
  "8": { advance: 6, top: -5, rows: [".##.", "#..#", ".##.", "#..#", ".##."] },
  "9": { advance: 6, top: -5, rows: [".##.", "#..#", ".###", "...#", ".##."] },
  ":": { advance: 3, top: -4, rows: ["#", ".", "#"] },
  ";": { advance: 4, top: -4, rows: [".#", "..", ".#", "#."] },
  "<": { advance: 5, top: -5, rows: ["..#", ".#.", "#..", ".#.", "..#"] },
  "=": { advance: 5, top: -4, rows: ["###", "...", "###"] },
  ">": { advance: 5, top: -5, rows: ["#..", ".#.", "..#", ".#.", "#.."] },
  "?": { advance: 6, top: -5, rows: ["###.", "...#", ".##.", "....", ".#.."] },
  "@": { advance: 7, top: -5, rows: [".###.", "#.#.#", "#.##.", "#....", ".###."] },
  "A": { advance: 6, top: -5, rows: [".##.", "#..#", "####", "#..#", "#..#"] },
  "B": { advance: 6, top: -5, rows: ["###.", "#..#", "####", "#..#", "###."] },
  "C": { advance: 6, top: -5, rows: [".##.", "#..#", "#...", "#..#", ".##."] },
  "D": { advance: 6, top: -5, rows: ["###.", "#..#", "#..#", "#..#", "###."] },
  "E": { advance: 5, top: -5, rows: ["###", "#..", "###", "#..", "###"] },
  "F": { advance: 5, top: -5, rows: ["###", "#..", "###", "#..", "#.."] },
  "G": { advance: 6, top: -5, rows: [".###", "#...", "#.##", "#..#", ".##."] },
  "H": { advance: 6, top: -5, rows: ["#..#", "#..#", "####", "#..#", "#..#"] },
  "I": { advance: 3, top: -5, rows: ["#", "#", "#", "#", "#"] },
  "J": { advance: 6, top: -5, rows: ["...#", "...#", "...#", "#..#", ".##."] },
  "K": { advance: 6, top: -5, rows: ["#..#", "#.#.", "##..", "#.#.", "#..#"] },
  "L": { advance: 5, top: -5, rows: ["#..", "#..", "#..", "#..", "###"] },
  "M": { advance: 7, top: -5, rows: ["#...#", "##.##", "#.#.#", "#...#", "#...#"] },
  "N": { advance: 7, top: -5, rows: ["#...#", "##..#", "#.#.#", "#..##", "#...#"] },
  "O": { advance: 6, top: -5, rows: [".##.", "#..#", "#..#", "#..#", ".##."] },
  "P": { advance: 6, top: -5, rows: ["###.", "#..#", "###.", "#...", "#..."] },
  "Q": { advance: 6, top: -5, rows: [".##.", "#..#", "#..#", "#..#", ".##.", "...#"] },
  "R": { advance: 6, top: -5, rows: ["###.", "#..#", "###.", "#.#.", "#..#"] },
  "S": { advance: 6, top: -5, rows: [".###", "#...", ".##.", "...#", "###."] },
  "T": { advance: 5, top: -5, rows: ["###", ".#.", ".#.", ".#.", ".#."] },
  "U": { advance: 6, top: -5, rows: ["#..#", "#..#", "#..#", "#..#", ".##."] },
  "V": { advance: 7, top: -5, rows: ["#...#", "#...#", ".#.#.", ".#.#.", "..#.."] },
  "W": { advance: 7, top: -5, rows: ["#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."] },
  "X": { advance: 7, top: -5, rows: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"] },
  "Y": { advance: 7, top: -5, rows: ["#...#", ".#.#.", "..#..", "..#..", "..#.."] },
  "Z": { advance: 5, top: -5, rows: ["###", "..#", ".#.", "#..", "###"] },
  "[": { advance: 4, top: -5, rows: ["##", "#.", "#.", "#.", "##"] },
  "\\": { advance: 5, top: -5, rows: ["#..", "#..", ".#.", "..#", "..#"] },
  "]": { advance: 4, top: -5, rows: ["##", ".#", ".#", ".#", "##"] },
  "^": { advance: 5, top: -6, rows: [".#.", "#.#"] },
  "_": { advance: 6, top: 0, rows: ["####"] },
  "`": { advance: 4, top: -8, rows: ["#.", ".#"] },
  "a": { advance: 6, top: -5, rows: [".##.", "#..#", "####", "#..#", "#..#"] },
  "b": { advance: 6, top: -5, rows: ["###.", "#..#", "####", "#..#", "###."] },
  "c": { advance: 6, top: -5, rows: [".##.", "#..#", "#...", "#..#", ".##."] },
  "d": { advance: 6, top: -5, rows: ["###.", "#..#", "#..#", "#..#", "###."] },
  "e": { advance: 5, top: -5, rows: ["###", "#..", "###", "#..", "###"] },
  "f": { advance: 5, top: -5, rows: ["###", "#..", "###", "#..", "#.."] },
  "g": { advance: 6, top: -5, rows: [".###", "#...", "#.##", "#..#", ".##."] },
  "h": { advance: 6, top: -5, rows: ["#..#", "#..#", "####", "#..#", "#..#"] },
  "i": { advance: 3, top: -5, rows: ["#", "#", "#", "#", "#"] },
  "j": { advance: 6, top: -5, rows: ["...#", "...#", "...#", "#..#", ".##."] },
  "k": { advance: 6, top: -5, rows: ["#..#", "#.#.", "##..", "#.#.", "#..#"] },
  "l": { advance: 5, top: -5, rows: ["#..", "#..", "#..", "#..", "###"] },
  "m": { advance: 7, top: -5, rows: ["#...#", "##.##", "#.#.#", "#...#", "#...#"] },
  "n": { advance: 7, top: -5, rows: ["#...#", "##..#", "#.#.#", "#..##", "#...#"] },
  "o": { advance: 6, top: -5, rows: [".##.", "#..#", "#..#", "#..#", ".##."] },
  "p": { advance: 6, top: -5, rows: ["###.", "#..#", "###.", "#...", "#..."] },
  "q": { advance: 6, top: -5, rows: [".##.", "#..#", "#..#", "#..#", ".##.", "...#"] },
  "r": { advance: 6, top: -5, rows: ["###.", "#..#", "###.", "#.#.", "#..#"] },
  "s": { advance: 6, top: -5, rows: [".###", "#...", ".##.", "...#", "###."] },
  "t": { advance: 5, top: -5, rows: ["###", ".#.", ".#.", ".#.", ".#."] },
  "u": { advance: 6, top: -5, rows: ["#..#", "#..#", "#..#", "#..#", ".##."] },
  "v": { advance: 7, top: -5, rows: ["#...#", "#...#", ".#.#.", ".#.#.", "..#.."] },
  "w": { advance: 7, top: -5, rows: ["#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."] },
  "x": { advance: 7, top: -5, rows: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"] },
  "y": { advance: 7, top: -5, rows: ["#...#", ".#.#.", "..#..", "..#..", "..#.."] },
  "z": { advance: 5, top: -5, rows: ["###", "..#", ".#.", "#..", "###"] },
  "{": { advance: 5, top: -5, rows: [".##", ".#.", "#..", ".#.", ".##"] },
  "|": { advance: 3, top: -6, rows: ["#", "#", "#", "#", "#", "#", "#"] },
  "}": { advance: 5, top: -5, rows: ["##.", ".#.", "..#", ".#.", "##."] },
  "~": { advance: 6, top: -5, rows: [".#.#", "#.#."] },
};
