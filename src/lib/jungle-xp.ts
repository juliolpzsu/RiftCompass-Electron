// Ported from the web app's src/lib/jungle-xp.ts, with a `name` field
// added per camp since the original relies on next-intl translation keys
// this app doesn't have. Jungle camp XP by jungler level — Riot/Data
// Dragon don't publish this table anywhere; sourced from maurogarih.com's
// LoL Toolkit (see the web app's copy of this file for the full sourcing
// note). Camps only carry a value at the levels where re-clearing them is
// a realistic pathing scenario — gaps are `null`, not a missing value.
export const JUNGLE_XP_LEVELS = [1, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type JungleXpLevel = (typeof JUNGLE_XP_LEVELS)[number];

export type JungleCampId =
  | "redBrambleback"
  | "blueSentinel"
  | "gromp"
  | "krugs"
  | "murkWolves"
  | "raptors"
  | "riftScuttler";

export interface JungleCamp {
  id: JungleCampId;
  name: string;
  // "OP" badge on the source: better XP for the difficulty of the camp.
  optimalPath: boolean;
  xpByLevel: Record<JungleXpLevel, number | null>;
  // Real in-game HUD icon for that monster, from Community Dragon's raw
  // game asset export — the same "*_square.png" HUD portraits the client
  // itself uses.
  iconUrl: string;
}

const CDRAGON_CHARACTERS = "https://raw.communitydragon.org/latest/game/assets/characters";

export const JUNGLE_CAMPS: JungleCamp[] = [
  {
    id: "redBrambleback",
    name: "Red Brambleback",
    optimalPath: false,
    xpByLevel: { 1: 175, 3: null, 4: null, 5: null, 6: 213, 7: 218, 8: 223, 9: 223, 10: 223 },
    iconUrl: `${CDRAGON_CHARACTERS}/sru_red/hud/brambleback_square.png`,
  },
  {
    id: "blueSentinel",
    name: "Blue Sentinel",
    optimalPath: false,
    xpByLevel: { 1: 175, 3: null, 4: null, 5: null, 6: 213, 7: 218, 8: 223, 9: 223, 10: 223 },
    iconUrl: `${CDRAGON_CHARACTERS}/sru_blue/hud/bluesentinel_square.png`,
  },
  {
    id: "gromp",
    name: "Gromp",
    optimalPath: true,
    xpByLevel: { 1: 200, 3: null, 4: 236, 5: 242, 6: 248, 7: 254, 8: 260, 9: 260, 10: 260 },
    iconUrl: `${CDRAGON_CHARACTERS}/sru_gromp/hud/gromp_square.png`,
  },
  {
    id: "krugs",
    name: "Krugs",
    optimalPath: true,
    xpByLevel: { 1: 201, 3: null, 4: 237, 5: 243, 6: 249, 7: 255, 8: 262, 9: 262, 10: 262 },
    iconUrl: `${CDRAGON_CHARACTERS}/sru_krug/hud/ancientkrug_square.png`,
  },
  {
    id: "murkWolves",
    name: "Murk Wolves",
    optimalPath: false,
    xpByLevel: { 1: 160, 3: null, 4: 184, 5: 188, 6: 192, 7: 196, 8: 200, 9: 200, 10: 200 },
    iconUrl: `${CDRAGON_CHARACTERS}/sru_murkwolf/hud/greatermurkwolf_square.png`,
  },
  {
    id: "raptors",
    name: "Raptors",
    optimalPath: false,
    xpByLevel: { 1: 150, 3: null, 4: 171, 5: 175, 6: 178, 7: 182, 8: 185, 9: 185, 10: 185 },
    iconUrl: `${CDRAGON_CHARACTERS}/sru_razorbeak/hud/razorbeak_square.png`,
  },
  {
    id: "riftScuttler",
    name: "Rift Scuttler",
    // Doesn't grant XP at level 1 — noted explicitly by the source.
    optimalPath: true,
    xpByLevel: { 1: null, 3: 105, 4: 105, 5: 215, 6: 220, 7: 225, 8: 230, 9: 230, 10: 230 },
    iconUrl: `${CDRAGON_CHARACTERS}/sru_crab/hud/crab_square_0.png`,
  },
];

export const JUNGLE_CLEAR_ORDER = [
  { clear: 1, levels: [1] as JungleXpLevel[] },
  { clear: 2, levels: [4, 5] as JungleXpLevel[] },
  { clear: 3, levels: [6, 7] as JungleXpLevel[] },
  { clear: 4, levels: [8, 9] as JungleXpLevel[] },
];

// Smite's monster damage per evolution (League Wiki, "Smite"): the pet
// earns treats by eating large monsters, and the spell upgrades at 15
// and 35 of them. Primal Smite also splashes onto nearby monsters.
// The same stage icons the game itself swaps in as the pet evolves.
export const SMITE_STAGES = [
  { id: "base", treats: 0, damage: 600, hitsNearby: false, iconUrl: "https://raw.communitydragon.org/latest/game/data/spells/icons2d/summoner_smite.png" },
  { id: "unleashed", treats: 15, damage: 1000, hitsNearby: false, iconUrl: "https://raw.communitydragon.org/latest/game/data/spells/icons2d/avatarsmite_firstupgrade.png" },
  { id: "primal", treats: 35, damage: 1400, hitsNearby: true, iconUrl: "https://raw.communitydragon.org/latest/game/data/spells/icons2d/1101_smite.png" },
] as const;

// The stage a jungler's Smite is at after eating this many treats (one
// per large monster, which in route terms is one per cleared camp).
export type SmiteStage = (typeof SMITE_STAGES)[number];

export function smiteStageForTreats(treats: number): SmiteStage {
  let stage: SmiteStage = SMITE_STAGES[0];
  for (const s of SMITE_STAGES) if (treats >= s.treats) stage = s;
  return stage;
}

// Champion XP curve on Summoner's Rift (League Wiki, "Experience
// (champion)"): 280 XP from level 1 to 2, each next level costing 100
// more. The camp table above stops at jungler level 10, so the
// simulation caps there too.
export const MAX_SIM_LEVEL = 10;

function xpToNextLevel(level: number): number {
  return 280 + (level - 1) * 100;
}

// XP a camp grants to a jungler of the given level: the table only
// carries values at the levels where re-clearing is realistic, so in
// between we use the nearest defined value at or below (a level-2
// jungler's Gromp is the level-1 entry). null = the camp grants nothing
// yet (Scuttler before level 3).
export function campXpAtLevel(camp: JungleCamp, level: number): number | null {
  const capped = Math.min(level, MAX_SIM_LEVEL);
  for (let lvl = capped; lvl >= 1; lvl--) {
    if (JUNGLE_XP_LEVELS.includes(lvl as JungleXpLevel)) {
      const value = camp.xpByLevel[lvl as JungleXpLevel];
      if (value !== null) return value;
      // A defined-null entry (Scuttler at 1) means "no XP yet", not
      // "fall further back".
      if (lvl === 1) return null;
    }
  }
  return null;
}

// The camp levels a camp actually has values for — what the per-camp
// "camp level" selector offers.
export function definedCampLevels(camp: JungleCamp): JungleXpLevel[] {
  return JUNGLE_XP_LEVELS.filter((lvl) => camp.xpByLevel[lvl] !== null);
}

export interface RouteEntry {
  campId: JungleCampId;
  // Fixed camp level chosen by the user (the camp grew with its own
  // respawns, not with the jungler — e.g. the enemy took the scaled
  // Scuttler and yours is still the low one). undefined = follow the
  // jungler's current level.
  campLevel?: JungleXpLevel;
}

export interface RouteStep {
  campId: JungleCampId;
  xpGained: number;
  levelAfter: number;
}

export interface RouteResult {
  steps: RouteStep[];
  totalXp: number;
  level: number;
  /** XP accumulated into the current level. */
  intoLevel: number;
  /** XP still missing for the next level; null at the simulation cap. */
  toNext: number | null;
}

// Replays a clear order camp by camp: each camp's XP is applied at the
// level the jungler actually has at that point of the route, and levels
// are recomputed as the XP accumulates. One special rule from the game
// itself (League Wiki, "Jungling"): the first camp of the game always
// levels the jungler to 2 regardless of its XP value — that top-up is
// what makes a real 6-camp full clear land exactly on level 4.
export function simulateRoute(entries: RouteEntry[]): RouteResult {
  const byId = new Map(JUNGLE_CAMPS.map((c) => [c.id, c]));
  let totalXp = 0;
  let level = 1;
  let intoLevel = 0;
  const steps: RouteStep[] = [];

  for (const { campId, campLevel } of entries) {
    const camp = byId.get(campId);
    if (!camp) continue;
    const xp = (campLevel !== undefined ? camp.xpByLevel[campLevel] : campXpAtLevel(camp, level)) ?? 0;
    totalXp += xp;
    intoLevel += xp;
    while (level < MAX_SIM_LEVEL && intoLevel >= xpToNextLevel(level)) {
      intoLevel -= xpToNextLevel(level);
      level += 1;
    }
    if (steps.length === 0 && level === 1) {
      level = 2;
      intoLevel = 0;
    }
    steps.push({ campId, xpGained: xp, levelAfter: level });
  }

  const toNext = level >= MAX_SIM_LEVEL ? null : xpToNextLevel(level) - intoLevel;
  return { steps, totalXp, level, intoLevel, toNext };
}
