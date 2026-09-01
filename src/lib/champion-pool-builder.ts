import type { ChampionInfo } from "../ddragon";
import { championsForRole, type PersonalityRole } from "./personality-test";
import { damageTypeOf, type DamageType } from "./champion-damage-type";
import { rolesOf, type ChampionRole } from "./champion-roles";

// Ported from the web app's src/lib/champion-pool-builder.ts — same pool
// shape (3 core, 2 flex, 1 pocket) and same real-data-only analysis/
// recommendation logic (Data Dragon tags/difficulty, no invented winrates
// or meta tiers — that data only exists behind riftcompass.com's own DB,
// which this standalone app deliberately doesn't reach into by scraping).
export const MAX_POOL_SIZE = 6;
const CORE_SLOTS = 3;

export type PoolSlotKind = "core" | "flex" | "pocket";

export function slotKind(index: number): PoolSlotKind {
  if (index < CORE_SLOTS) return "core";
  if (index < MAX_POOL_SIZE - 1) return "flex";
  return "pocket";
}

export interface PoolAnalysis {
  uniqueTags: string[];
  dominantTag: string | null;
  averageDifficulty: number | null;
}

export function analyzePool(pool: ChampionInfo[]): PoolAnalysis {
  if (pool.length === 0) {
    return { uniqueTags: [], dominantTag: null, averageDifficulty: null };
  }
  const tagCounts = new Map<string, number>();
  for (const champion of pool) {
    for (const tag of champion.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const uniqueTags = [...tagCounts.keys()].sort();
  const sharedByAll = pool.length >= 2 ? [...tagCounts.entries()].find(([, count]) => count === pool.length) : undefined;
  const averageDifficulty = pool.reduce((sum, c) => sum + c.difficulty, 0) / pool.length;
  return {
    uniqueTags,
    dominantTag: sharedByAll ? sharedByAll[0] : null,
    averageDifficulty,
  };
}

const ALL_CHAMPION_CLASSES = ["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"];

export interface PoolRecommendation {
  champion: ChampionInfo;
  missingTag: string;
}

// The pool's own real, played-more damage type — only "dominant" on an
// actual majority, not a coin-flip tie. Same as the web app's
// src/lib/champion-pool-builder.ts.
function dominantDamageType(pool: ChampionInfo[]): DamageType | null {
  const counts: Partial<Record<DamageType, number>> = {};
  for (const c of pool) {
    const dt = damageTypeOf(c.internalId);
    if (!dt) continue;
    counts[dt] = (counts[dt] ?? 0) + 1;
  }
  const entries = Object.entries(counts) as [DamageType, number][];
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return null;
  return entries[0][0];
}

// When the pool leans one damage type, recommend complementary options:
// candidates sharing the pool's dominant damage type (champion-damage-
// type.ts) sort after every complementary/mixed/unclassified candidate
// for the same missing class. Damage type is a secondary sort key under
// the missing-class requirement, never a replacement for it.
export function recommendChampions(
  pool: ChampionInfo[],
  champions: ChampionInfo[],
  role: PersonalityRole,
  limit = 3,
): PoolRecommendation[] {
  if (pool.length === 0) return [];
  // Candidates come straight from champion-roles.ts's real per-champion
  // lane data (via championsForRole()) instead of a Data Dragon tag
  // heuristic — a champion's real role list only ever contains lanes
  // they're actually played in. Same as the web version.
  const candidates = championsForRole(champions, role);
  const poolIds = new Set(pool.map((c) => c.internalId));
  const coveredTags = new Set(pool.flatMap((c) => c.tags));
  const missingTags = ALL_CHAMPION_CLASSES.filter((tag) => !coveredTags.has(tag));
  const dominant = dominantDamageType(pool);

  const recommendations: PoolRecommendation[] = [];
  const usedIds = new Set<string>();
  for (const tag of missingTags) {
    if (recommendations.length >= limit) break;
    const [pick] = candidates
      .filter((c) => !poolIds.has(c.internalId) && !usedIds.has(c.internalId) && c.tags.includes(tag))
      .sort((a, b) => {
        if (dominant) {
          const aSameType = damageTypeOf(a.internalId) === dominant ? 1 : 0;
          const bSameType = damageTypeOf(b.internalId) === dominant ? 1 : 0;
          if (aSameType !== bSameType) return aSameType - bSameType;
        }
        return a.difficulty - b.difficulty || a.name.localeCompare(b.name);
      });
    if (pick) {
      recommendations.push({ champion: pick, missingTag: tag });
      usedIds.add(pick.internalId);
    }
  }
  return recommendations;
}

export interface FlexRecommendation {
  champion: ChampionInfo;
  /** The other real lanes this champion also plays, besides the pool's. */
  extraRoles: ChampionRole[];
}

export interface PocketRecommendation {
  champion: ChampionInfo;
}

export interface SlotRecommendations {
  core: PoolRecommendation[];
  flex: FlexRecommendation[];
  pocket: PocketRecommendation[];
}

// One recommendation group per slot kind, so the tool actually helps
// fill each of them: core keeps the missing-class logic above; flex
// suggests champions whose real lane list covers the selected role AND
// at least one more (that multi-lane reach is what makes a pick
// "flexible"); pocket suggests the highest-difficulty options in the
// role — the mastery-rewarding surprise pick you keep ready. Groups
// never repeat a champion, and everything stays within the selected
// role's curated champion list.
export function recommendForSlots(
  pool: ChampionInfo[],
  champions: ChampionInfo[],
  role: PersonalityRole,
): SlotRecommendations {
  // With an empty pool there are no "missing classes" yet, so core
  // starts as the role's most approachable picks and switches to the
  // missing-class logic from the first choice on. Every group recomputes
  // from the live pool, so picking a recommendation immediately refills
  // and re-adapts all of them.
  const core =
    pool.length === 0
      ? championsForRole(champions, role)
          .slice()
          .sort((a, b) => a.difficulty - b.difficulty || a.name.localeCompare(b.name))
          .slice(0, 3)
          .map((champion) => ({ champion, missingTag: champion.tags[0] }))
      : recommendChampions(pool, champions, role, 3);
  const used = new Set([...pool.map((c) => c.internalId), ...core.map((r) => r.champion.internalId)]);
  const dominant = dominantDamageType(pool);
  const candidates = championsForRole(champions, role).filter((c) => !used.has(c.internalId));

  const complementFirst = (a: ChampionInfo, b: ChampionInfo): number => {
    if (!dominant) return 0;
    const aSame = damageTypeOf(a.internalId) === dominant ? 1 : 0;
    const bSame = damageTypeOf(b.internalId) === dominant ? 1 : 0;
    return aSame - bSame;
  };

  const flex = candidates
    .map((champion) => ({
      champion,
      extraRoles: (rolesOf(champion.internalId) ?? []).filter((r) => r !== role),
    }))
    .filter((entry) => entry.extraRoles.length > 0)
    .sort(
      (a, b) =>
        b.extraRoles.length - a.extraRoles.length ||
        complementFirst(a.champion, b.champion) ||
        a.champion.difficulty - b.champion.difficulty ||
        a.champion.name.localeCompare(b.champion.name),
    )
    .slice(0, 2);
  for (const entry of flex) used.add(entry.champion.internalId);

  const pocket = candidates
    .filter((c) => !used.has(c.internalId))
    .sort(
      (a, b) =>
        b.difficulty - a.difficulty ||
        complementFirst(a, b) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 2)
    .map((champion) => ({ champion }));

  return { core, flex, pocket };
}

export const POOL_ROLES: PersonalityRole[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

export type PoolsByRole = Record<PersonalityRole, string[]>;

export function emptyPools(): PoolsByRole {
  return { TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [] };
}
