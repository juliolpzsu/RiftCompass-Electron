import type { ChampionInfo } from "../ddragon";
import { rolesOf, type ChampionRole } from "./champion-roles";

// Ported verbatim from the web app's src/lib/personality-test.ts — each axis
// maps directly to one of Data Dragon's own real 0-10 champion ratings
// (attack/defense/magic/difficulty), so matching is a straight distance
// calculation against real data, never a fabricated "meta" score.
export type PersonalityAxis = "aggression" | "resilience" | "spellPower" | "complexity";

export interface PersonalityQuestion {
  id: string;
  axis: PersonalityAxis;
  direction: "pos" | "neg";
}

export const PERSONALITY_QUESTIONS: PersonalityQuestion[] = [
  { id: "everyFight", axis: "aggression", direction: "pos" },
  { id: "diveForKill", axis: "aggression", direction: "pos" },
  { id: "preferPoke", axis: "aggression", direction: "neg" },
  { id: "soakDamage", axis: "resilience", direction: "pos" },
  { id: "firstIn", axis: "resilience", direction: "pos" },
  { id: "avoidFrontline", axis: "resilience", direction: "neg" },
  { id: "chainAbilities", axis: "spellPower", direction: "pos" },
  { id: "skillshotFeel", axis: "spellPower", direction: "pos" },
  { id: "preferItemScaling", axis: "spellPower", direction: "neg" },
  { id: "highCeiling", axis: "complexity", direction: "pos" },
  { id: "oneDeepChampion", axis: "complexity", direction: "pos" },
  { id: "instantlyUnderstand", axis: "complexity", direction: "neg" },
];

// Question/axis/likert display text lives in the i18n catalog now
// (PersonalityTest.questions/axis/likert in i18n/messages/*.ts), not here —
// this module stays pure logic, no hardcoded English.

/** -2 (strongly disagree) .. 2 (strongly agree); null = neutral/skipped, excluded from scoring. */
export type Answer = -2 | -1 | 0 | 1 | 2 | null;

export type AxisScores = Record<PersonalityAxis, number>;

const AXES: PersonalityAxis[] = ["aggression", "resilience", "spellPower", "complexity"];

export function computeAxisScores(answers: Record<string, Answer>): AxisScores {
  const sums: Record<PersonalityAxis, { total: number; count: number }> = {
    aggression: { total: 0, count: 0 },
    resilience: { total: 0, count: 0 },
    spellPower: { total: 0, count: 0 },
    complexity: { total: 0, count: 0 },
  };

  for (const question of PERSONALITY_QUESTIONS) {
    const answer = answers[question.id];
    if (answer === null || answer === undefined || answer === 0) continue;
    const signed = question.direction === "pos" ? answer : -answer;
    sums[question.axis].total += signed;
    sums[question.axis].count += 1;
  }

  const scores = {} as AxisScores;
  for (const axis of AXES) {
    const { total, count } = sums[axis];
    const average = count === 0 ? 0 : total / count; // -2..2
    scores[axis] = ((average + 2) / 4) * 10; // 0..10, matches champion.info scale
  }
  return scores;
}

// Re-exported under this tool's own established name — same real values
// as ChampionRole, kept so call sites didn't need renaming when this
// switched from a tag-derived guess to the real database.
export type PersonalityRole = ChampionRole;

// Display label for a role comes from the i18n catalog
// (Profile.positions.<role.toLowerCase()>), not a hardcoded map here.

// Used to derive "which champions fit this role" from Data Dragon class
// tags (a Marksman is built for bot lane, etc.) — replaced with
// champion-roles.ts's real, curated per-champion lane data, same as the
// web version. A class isn't a lane: the tag approach recommended real
// wrong picks for the selected position (Rell for Top through her Tank
// tag, and so on).
export function championsForRole(champions: ChampionInfo[], role: PersonalityRole): ChampionInfo[] {
  const inRole = champions.filter((c) => rolesOf(c.internalId)?.includes(role));
  // An unclassified champion (a very recent release) or a genuinely empty
  // role should fall back to the full pool rather than zero matches.
  return inRole.length > 0 ? inRole : champions;
}

export interface ChampionMatch {
  champion: ChampionInfo;
  /** 0-100, 100 = perfect match against the player's axis scores. */
  matchPercent: number;
}

const MAX_DISTANCE = Math.sqrt(4 * 10 ** 2); // worst case: every axis off by 10

export function matchChampions(scores: AxisScores, champions: ChampionInfo[]): ChampionMatch[] {
  return champions
    .map((champion) => {
      const d =
        (champion.attack - scores.aggression) ** 2 +
        (champion.defense - scores.resilience) ** 2 +
        (champion.magic - scores.spellPower) ** 2 +
        (champion.difficulty - scores.complexity) ** 2;
      const distance = Math.sqrt(d);
      const matchPercent = Math.round(Math.max(0, 1 - distance / MAX_DISTANCE) * 100);
      return { champion, matchPercent };
    })
    .sort((a, b) => b.matchPercent - a.matchPercent);
}
