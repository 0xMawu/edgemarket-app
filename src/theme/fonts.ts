/**
 * fonts.ts
 *
 * Uses the platform's native system font for a clean, professional look:
 *   - iOS / macOS  → San Francisco (SF Pro)
 *   - Android      → Roboto
 *   - Web          → system-ui
 *
 * In React Native, setting fontFamily to undefined falls back to the OS
 * default, which is the correct way to use system fonts. Weight variants
 * are expressed via fontWeight in each component's StyleSheet.
 *
 * Usage:
 *   fontFamily: fonts.regular   → system default, weight 400
 *   fontFamily: fonts.medium    → system default, weight 500
 *   fontFamily: fonts.semiBold  → system default, weight 600
 *   fontFamily: fonts.bold      → system default, weight 700
 */

export const fonts = {
  regular:  undefined,
  medium:   undefined,
  semiBold: undefined,
  bold:     undefined,
} as const;

export type Fonts = typeof fonts;
