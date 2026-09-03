import { toDDragonId, type ChampionInfo } from "./ddragon";
import { rolesOf, type ChampionRole } from "./lib/champion-roles";
import type { ChampionOverviewStats } from "./lib/profile-analysis";

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
// web's champion-stats.ts) — championName is a raw match/crawler name, not
// always identical to Data Dragon's internal id (see toDDragonId in
// ddragon.ts), so never compare it to ChampionInfo.internalId directly.
export interface ChampionWinrateEntry {
  championName: string;
  role: string;
  games: number;
  winRate: number;
}

export interface DraftSuggestion {
  champion: ChampionInfo;
  // Real crawler data — present whenever this pick's role+champion combo
  // has cleared the crawler's own sample floor (MIN_GAMES_FOR_WINRATE in
  // the web's champion-stats.ts), so the player can judge the number
  // instead of trusting an icon-only suggestion blind.
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
    winrates.filter((w) => w.role === role).map((w) => [toDDragonId(w.championName), w]),
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

// --- Draft Advisor (main-app screen, not the in-game overlay) ---------

// Same shape /api/v1/champion-matchup returns for one champion: its real
// 1v1 lane matchup record against a specific, already-known enemy laner.
export interface LaneMatchupEntry {
  championName: string;
  games: number;
  wins: number;
  winRate: number;
}

export interface MatchupSuggestion {
  champion: ChampionInfo;
  // Real matchup-specific record when the crawler has one; otherwise the
  // same champion+role bucket champion-winrates already uses (see
  // matchupSpecific below) — never absent unless there's truly no sample
  // at all for this champion in this role.
  matchupWinRate?: number;
  matchupGames?: number;
  matchupSpecific: boolean;
  personalWinRate?: number;
  personalGames?: number;
  // Ranking key only (see combine formula below) — never shown to the
  // user as if it were an observed win rate, just used to sort and to
  // pick a 3-tier label.
  combinedScore: number;
  tier: "good" | "solid" | "risky";
}

// Same "trust threshold" idea as the web's MIN_GAMES_FOR_WINRATE: a virtual
// prior of 20 games at 50/50 pulls a thin sample back toward neutral
// instead of letting a 2-game 100% record dominate the ranking. Reused as
// the smoothing constant for both signals for consistency across the
// project, not because personal and matchup samples are the same size —
// they rarely are, which is exactly why raw pooling (summing games) would
// let whichever signal has more games silently drown out the other; each
// is smoothed toward neutral independently first, then combined.
const COMBINE_PRIOR_GAMES = 20;

function smoothedRate(wins: number, games: number): number {
  return (wins + COMBINE_PRIOR_GAMES / 2) / (games + COMBINE_PRIOR_GAMES);
}

// Log-odds pooling: treat the matchup record and the player's personal
// record as two independent pieces of evidence about the same question
// ("is this a good pick right now?") and multiply their odds together
// (sum their logits) rather than average their raw rates — the standard
// way to combine two separately-estimated probabilities. With zero games
// on one side, smoothedRate() returns exactly 0.5 and logit(0.5) = 0, so
// that side drops out of the sum instead of pulling the result toward 50%.
function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// Ranks every real candidate for `position` by a blend of two honest
// signals: the champion's real winrate against the already-known enemy
// laner (falling back to its overall winrate for the role when the
// specific matchup has no sample yet, same fallback shape as the web's
// getRecommendedBuild), and the player's own real winrate with that
// champion from their recent match history. A candidate with no sample on
// either signal is dropped rather than ranked at an uninformative neutral
// 50% alongside real data.
export function suggestMatchupPicks(
  champions: ChampionInfo[],
  teamPickedChampionIds: number[],
  position: string,
  matchups: LaneMatchupEntry[],
  roleWinrates: ChampionWinrateEntry[],
  personalOverview: ChampionOverviewStats[],
  limit = 8,
): MatchupSuggestion[] {
  const role = POSITION_TO_ROLE[position];
  if (!role) return [];

  const candidates = champions.filter((c) => rolesOf(c.internalId)?.includes(role));
  const pickedIds = new Set(teamPickedChampionIds);
  const available = candidates.filter((c) => !pickedIds.has(c.id));

  const matchupByInternalId = new Map(matchups.map((m) => [toDDragonId(m.championName), m]));
  const roleWinrateByInternalId = new Map(
    roleWinrates.filter((w) => w.role === role).map((w) => [toDDragonId(w.championName), w]),
  );
  const personalByInternalId = new Map(personalOverview.map((p) => [toDDragonId(p.championName), p]));

  const scored = available
    .map((champion) => {
      const matchup = matchupByInternalId.get(champion.internalId);
      const roleWide = roleWinrateByInternalId.get(champion.internalId);
      const personal = personalByInternalId.get(champion.internalId);

      const matchupSpecific = (matchup?.games ?? 0) > 0;
      const matchupGames = matchupSpecific ? matchup!.games : roleWide?.games;
      const matchupWins = matchupSpecific ? matchup!.wins : roleWide ? Math.round(roleWide.winRate * roleWide.games) : undefined;
      const matchupWinRate = matchupSpecific ? matchup!.winRate : roleWide?.winRate;

      const matchupRate = smoothedRate(matchupWins ?? 0, matchupGames ?? 0);
      const personalRate = smoothedRate(personal?.wins ?? 0, personal?.games ?? 0);
      const combinedScore = sigmoid(logit(matchupRate) + logit(personalRate));

      return {
        champion,
        matchupWinRate,
        matchupGames,
        matchupSpecific,
        personalWinRate: personal ? personal.wins / personal.games : undefined,
        personalGames: personal?.games,
        combinedScore,
        hasSignal: (matchupGames ?? 0) > 0 || (personal?.games ?? 0) > 0,
      };
    })
    .filter((s) => s.hasSignal);

  return scored
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
    .map(({ hasSignal: _hasSignal, ...s }) => ({
      ...s,
      tier: s.combinedScore > 0.55 ? "good" : s.combinedScore < 0.45 ? "risky" : "solid",
    }));
}
