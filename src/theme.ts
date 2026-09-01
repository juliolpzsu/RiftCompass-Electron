import type { CSSProperties } from "react";

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

// Shared inline-style builders. Previously copy-pasted (byte-for-byte in
// some places, drifted in others) across MainView.tsx, profile/*.tsx,
// and the tools/ screens.
export const inputStyle: CSSProperties = {
  background: COLORS.background,
  color: COLORS.text,
  border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
};

export function cardStyle(options: { borderRadius?: number; padding?: number } = {}): CSSProperties {
  return {
    borderRadius: options.borderRadius ?? 12,
    border: `1px solid ${COLORS.cardBorder}`,
    background: `${COLORS.card}99`,
    padding: options.padding ?? 16,
  };
}

export function pillStyle(active: boolean, size: "default" | "compact" = "default"): CSSProperties {
  return {
    padding: size === "compact" ? "6px 12px" : "6px 14px",
    borderRadius: 999,
    border: `1px solid ${active ? COLORS.rose : COLORS.cardBorder}`,
    background: active ? `${COLORS.rose}26` : "none",
    color: active ? COLORS.rose : COLORS.text,
    fontSize: size === "compact" ? 12 : 13,
    cursor: "pointer",
  };
}
