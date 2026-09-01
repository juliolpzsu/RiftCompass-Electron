import type { ChampionInfo } from "./ddragon";
import { rolesOf, type ChampionRole } from "./lib/champion-roles";

// Candidate champions per position come from champion-roles.ts's real,
// curated per-champion lane data — same source the Tier List, Draft
// Simulator and Personality Test filter with — not from Data Dragon class
// tags (a class isn't a lane). The LCU champ-select session reports
// `assignedPosition` in lowercase ("top"/"jungle"/"middle"/"bottom"/
// "utility"), which maps 1:1 onto the uppercase ChampionRole values.
const POSITION_TO_ROLE: Record<string, ChampionRole> = {
  top: "TOP",
  jungle: "JUNGLE",
  middle: "MIDDLE",
  bottom: "BOTTOM",
  utility: "UTILITY",
};

const ALL_CHAMPION_CLASSES = ["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"];

// Same shape /api/v1/champion-winrates returns (ChampionWinrate in the
// web's champion-stats.ts) — championName is Data Dragon's internal id
// (matches ChampionInfo.internalId), not the numeric id.
export interface ChampionWinrateEntry {
  championName: string;
  role: string;
  games: number;
  winRate: number;
}

export interface DraftSuggestion {
  champion: ChampionInfo;
  // Real crawler data (2026-08-29) — present whenever this pick's role+
  // champion combo has cleared the crawler's own sample floor
  // (MIN_GAMES_FOR_WINRATE in the web's champion-stats.ts). Checked live
  // against iTero's own champ-select coach: unlike its plain icon-only
  // suggestion list, this is real winrate the player can actually judge
  // instead of trusting blind.
  winRate?: number;
  games?: number;
  // Set only for the fallback picks below — a real winrate-ranked
  // suggestion never carries this, so the UI can label the two groups
  // honestly instead of implying every suggestion has the same basis.
  missingTag?: string;
}

// Winrate-first: real aggregate win rate for this champion+role (the same
// data source Meta Tier List uses), highest first. Falls back to the
// team-comp-gap heuristic (lowest-difficulty pick for a class your team
// doesn't have yet, mirroring the web's champion-pool-builder.ts) only to
// fill remaining slots when the crawler doesn't have enough winrate
// entries yet for this role — still no invented winrates, just an
// honestly different signal for an honestly different reason (small
// sample), same convention as champion-build's matchup-specific fallback.
export function suggestPicks(
  champions: ChampionInfo[],
  teamPickedChampionIds: number[],
  position: string,
  winrates: ChampionWinrateEntry[] = [],
  limit = 3,
): DraftSuggestion[] {
  const role = POSITION_TO_ROLE[position];
  if (!role) return [];

  const candidates = champions.filter((c) => rolesOf(c.internalId)?.includes(role));
  const pickedIds = new Set(teamPickedChampionIds);
  const available = candidates.filter((c) => !pickedIds.has(c.id));

  const winrateByInternalId = new Map(
    winrates.filter((w) => w.role === role).map((w) => [w.championName, w]),
  );

  const suggestions: DraftSuggestion[] = [];
  const usedIds = new Set<number>();

  const byWinrate = available
    .map((c) => ({ champion: c, entry: winrateByInternalId.get(c.internalId) }))
    .filter((c): c is { champion: ChampionInfo; entry: ChampionWinrateEntry } => c.entry !== undefined)
    .sort((a, b) => b.entry.winRate - a.entry.winRate);
  for (const { champion, entry } of byWinrate) {
    if (suggestions.length >= limit) break;
    suggestions.push({ champion, winRate: entry.winRate, games: entry.games });
    usedIds.add(champion.id);
  }

  if (suggestions.length < limit) {
    const pickedById = new Map(champions.map((c) => [c.id, c]));
    const coveredTags = new Set(
      teamPickedChampionIds.flatMap((id) => pickedById.get(id)?.tags ?? []),
    );
    const missingTags = ALL_CHAMPION_CLASSES.filter((tag) => !coveredTags.has(tag));
    for (const tag of missingTags) {
      if (suggestions.length >= limit) break;
      const [pick] = available
        .filter((c) => !usedIds.has(c.id) && c.tags.includes(tag))
        .sort((a, b) => a.difficulty - b.difficulty || a.name.localeCompare(b.name));
      if (pick) {
        suggestions.push({ champion: pick, missingTag: tag });
        usedIds.add(pick.id);
      }
    }
  }

  return suggestions;
}
