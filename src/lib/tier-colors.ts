// Ported from the web app's src/lib/tier-colors.ts — same 5 tiers, same
// soft-good/soft-bad ramp (src/app/globals.css in the main repo), applied
// here as real hex + alpha instead of Tailwind utility classes.
export const TIERS = ["S", "A", "B", "C", "D"] as const;
export type Tier = (typeof TIERS)[number];

const SOFT_GOOD = "#7839ac";
const SOFT_BAD = "#832139";
const SOFT_NEUTRAL = "#67626a";

export const TIER_COLORS: Record<Tier, string> = {
  S: `${SOFT_BAD}b3`,
  A: `${SOFT_BAD}66`,
  B: `${SOFT_NEUTRAL}66`,
  C: `${SOFT_GOOD}66`,
  D: `${SOFT_GOOD}b3`,
};
