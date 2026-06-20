// Central place for all colors used across the app.
// Keep this simple - just plain JS values, no theming library.

export const colors = {
  // Background gradient: deep navy blue merging into rich purple
  gradientStart: "#0a0f2e",  // deep navy
  gradientMid:   "#0d1b4b",  // dark royal blue
  gradientEnd:   "#1a0a3e",  // deep purple-navy

  // Surfaces
  card: "rgba(255,255,255,0.07)",
  cardBorder: "rgba(255,255,255,0.09)",
  tabBar: "#080d24",

  // Text
  white: "#ffffff",
  textMuted: "rgba(255,255,255,0.6)",
  textFaint: "rgba(255,255,255,0.5)",
  textFainter: "rgba(255,255,255,0.35)",

  // Accents
  purple: "#7c3aed",        // vibrant purple (Polymarket accent)
  purpleStrong: "#6d28d9",  // deeper purple
  purpleLight: "#a78bfa",   // soft purple
  green: "#4ade80",         // green-400
  red: "#f87171",           // red-400
  yellow: "#facc15",        // yellow-400/500
  orange: "#fb923c",        // orange-400/500
  blue: "#3b82f6",          // blue-500 (Polymarket brand blue)
  blueLight: "#60a5fa",     // blue-400
  gray: "#9ca3af",          // gray-400
};

export type Colors = typeof colors;
