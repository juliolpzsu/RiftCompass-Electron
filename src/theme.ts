// Shared design tokens, kept in sync by hand with riftcompass.com's own
// dark theme (src/app/globals.css in the main repo) — same palette, this
// app's own components, not a copy of the site's rendered output.
export const COLORS = {
  background: "#0c0a0d",
  card: "#17121a",
  cardBorder: "rgba(255,255,255,0.08)",
  rose: "#e63977",
  roseMild: "#b093c8",
  text: "#f7f3f5",
  muted: "#9a94a0",
  gold: "#c8aa6e",
  goodMild: "#b093c8",
  badMild: "#bd6b80",
} as const;

export const FONT_HEADING = "'Russo One', 'Manrope', sans-serif";
export const FONT_BODY = "'Manrope', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
