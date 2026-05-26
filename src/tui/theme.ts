// Theme — colors that read well on dark AND light terminals.
//
// Rules of thumb (see AGENTS.md "Light/dark terminal compatibility"):
// - Use cyan for accent (legible on both backgrounds).
// - Use green for success, red+bold for error.
// - Never set backgroundColor (clashes with user's terminal theme).
// - Use Ink's `dimColor` prop for muted text — safe on both.
// - For warnings, prefer bold uncolored text or magenta. Avoid bare yellow.

export const colors = {
  accent: "cyan",
  success: "green",
  error: "red",
  warning: "magenta",
} as const;

export type ThemeColor = (typeof colors)[keyof typeof colors];
