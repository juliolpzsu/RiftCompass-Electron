// Ported from the web app's src/lib/riot/{rank-band,roadmap,skill-radar,
// role-breakdown,head-to-head}.ts — same real benchmarks and formulas
// (CS/min targets, KDA/vision/kill-participation/damage targets, the
// laning-advantage midpoint), not re-derived. All pure functions of the
// same RecentMatchSummary[] the profile endpoint already returns, so the
// desktop app computes roadmap/skill-radar/role-breakdown/head-to-head
// client-side from one fetch instead of needing a matching endpoint per
// widget. Kept in one file (the web app splits these into 5) since this
// app doesn't need the same file-per-concern granularity.
import type { MatchParticipantSummary, RecentMatchSummary } from "./profile-types";

// --- rank-band.ts ---
export type RankBand = "default" | "learning" | "climbing" | "high";

export function tierToBand(tier: string | null | undefined): RankBand {
  if (!tier) return "default";
  if (["IRON", "BRONZE", "SILVER"].includes(tier)) return "learning";
  if (["GOLD", "PLATINUM", "EMERALD"].includes(tier)) return "climbing";
  return "high";
}

export const CS_PER_MIN_TARGETS: Record<RankBand, number> = {
  default: 7,
  learning: 5,
  climbing: 6.5,
  high: 8.5,
};
export const SUPPORT_CS_PER_MIN_TARGET = 1.5;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function isSupportRole(matches: RecentMatchSummary[]): boolean {
  return matches.filter((m) => m.teamPosition === "UTILITY").length > matches.length / 2;
}

function isJungleRole(matches: RecentMatchSummary[]): boolean {
  return matches.filter((m) => m.teamPosition === "JUNGLE").length > matches.length / 2;
}

// --- roadmap.ts ---
export type RoadmapMetric = "csPerMin" | "visionPerMin" | "kda" | "laningAdvantage";
export type RoadmapStatus = "above" | "below";

export interface RoadmapNode {
  metric: RoadmapMetric;
  value: number;
  target: number;
  status: RoadmapStatus;
  band: RankBand;
  role?: "jungle" | "laner";
}

const VISION_TARGET = 1;
const SUPPORT_VISION_TARGET = 1.8;
const KDA_TARGET = 3;
const LANING_ADVANTAGE_TARGET = 50;

function gapRatio(node: RoadmapNode): number {
  if (node.status === "above" || node.target === 0) return -1;
  return (node.target - node.value) / node.target;
}

export function computeRoadmap(matches: RecentMatchSummary[], tier?: string | null): RoadmapNode[] {
  if (matches.length === 0) return [];

  const band = tierToBand(tier);
  const support = isSupportRole(matches);
  const jungle = isJungleRole(matches);

  const csPerMin = average(matches.map((m) => m.cs / Math.max(1, m.durationSeconds / 60)));
  const visionPerMin = average(matches.map((m) => m.visionScore / Math.max(1, m.durationSeconds / 60)));
  const kda = average(matches.map((m) => (m.kills + m.assists) / Math.max(1, m.deaths)));
  const laningAdvantagePct = (matches.filter((m) => m.laningAdvantage).length / matches.length) * 100;

  const csTarget = support ? SUPPORT_CS_PER_MIN_TARGET : CS_PER_MIN_TARGETS[band];
  const visionTarget = support ? SUPPORT_VISION_TARGET : VISION_TARGET;

  const nodes: RoadmapNode[] = [
    { metric: "csPerMin", value: Math.round(csPerMin * 10) / 10, target: csTarget, status: csPerMin >= csTarget ? "above" : "below", band },
    { metric: "visionPerMin", value: Math.round(visionPerMin * 10) / 10, target: visionTarget, status: visionPerMin >= visionTarget ? "above" : "below", band },
    { metric: "kda", value: Math.round(kda * 10) / 10, target: KDA_TARGET, status: kda >= KDA_TARGET ? "above" : "below", band },
    {
      metric: "laningAdvantage",
      value: Math.round(laningAdvantagePct),
      target: LANING_ADVANTAGE_TARGET,
      status: laningAdvantagePct >= LANING_ADVANTAGE_TARGET ? "above" : "below",
      band,
      role: jungle ? "jungle" : "laner",
    },
  ];

  return nodes.sort((a, b) => gapRatio(b) - gapRatio(a));
}

// --- skill-radar.ts ---
export type SkillAxis = "farm" | "vision" | "kda" | "killParticipation" | "damage";

export interface SkillRadarPoint {
  axis: SkillAxis;
  value: number;
}

function scaleToTarget(value: number, target: number): number {
  return Math.min(150, Math.round((value / target) * 100));
}

export function computeSkillRadar(matches: RecentMatchSummary[], tier?: string | null): SkillRadarPoint[] {
  if (matches.length === 0) return [];

  const support = isSupportRole(matches);
  const band = tierToBand(tier);
  const minutes = matches.map((m) => Math.max(1, m.durationSeconds / 60));

  const csPerMin = average(matches.map((m, i) => m.cs / minutes[i]));
  const visionPerMin = average(matches.map((m, i) => m.visionScore / minutes[i]));
  const kda = average(matches.map((m) => (m.kills + m.assists) / Math.max(1, m.deaths)));
  const killParticipation = average(matches.map((m) => ((m.kills + m.assists) / Math.max(1, m.teamKills)) * 100));
  const damagePerMin = average(matches.map((m, i) => m.damageDealt / minutes[i]));

  const farmTarget = support ? SUPPORT_CS_PER_MIN_TARGET : CS_PER_MIN_TARGETS[band];

  return [
    { axis: "farm", value: scaleToTarget(csPerMin, farmTarget) },
    { axis: "vision", value: scaleToTarget(visionPerMin, support ? 1.8 : 1) },
    { axis: "kda", value: scaleToTarget(kda, 3) },
    { axis: "killParticipation", value: scaleToTarget(killParticipation, 60) },
    { axis: "damage", value: scaleToTarget(damagePerMin, support ? 200 : 500) },
  ];
}

// --- skill-radar.ts's summarizeMatchPerformance, generalized ---
// The web's version only scores the tracked player (its input is a Pick
// off their own RecentMatchSummary); here the same real, benchmark-based
// scoring applies to every participant so the expanded scoreboard can
// show who actually played well on both teams. Same formula, same honest
// per-real-stat benchmarks (see rank-band.ts's own comment on why only
// CS/min is rank-tiered) — just fed any participant's real numbers.
export type PerformanceSentiment = "good" | "neutral" | "bad";

export interface MatchPerformanceNote {
  axis: SkillAxis | "wellRounded";
  sentiment: PerformanceSentiment;
  /** 0-10, one decimal. */
  score: number;
  scoreSentiment: PerformanceSentiment;
}

const STRENGTH_THRESHOLD = 110;
const FOCUS_THRESHOLD = 70;

interface ParticipantStatsInput {
  cs: number;
  visionScore: number;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  teamPosition: string;
}

export function summarizeParticipantPerformance(
  stats: ParticipantStatsInput,
  durationSeconds: number,
  teamKills: number,
  tier?: string | null,
): MatchPerformanceNote {
  const support = stats.teamPosition === "UTILITY";
  const band = tierToBand(tier);
  const minutes = Math.max(1, durationSeconds / 60);
  const farmTarget = support ? SUPPORT_CS_PER_MIN_TARGET : CS_PER_MIN_TARGETS[band];

  const points: SkillRadarPoint[] = [
    { axis: "farm", value: scaleToTarget(stats.cs / minutes, farmTarget) },
    { axis: "vision", value: scaleToTarget(stats.visionScore / minutes, support ? 1.8 : 1) },
    { axis: "kda", value: scaleToTarget((stats.kills + stats.assists) / Math.max(1, stats.deaths), 3) },
    { axis: "killParticipation", value: scaleToTarget(((stats.kills + stats.assists) / Math.max(1, teamKills)) * 100, 60) },
    { axis: "damage", value: scaleToTarget(stats.damageDealt / minutes, support ? 200 : 500) },
  ];

  const standout = points.reduce((most, p) => (Math.abs(p.value - 100) > Math.abs(most.value - 100) ? p : most));
  const overall = points.reduce((sum, p) => sum + p.value, 0) / points.length;
  const score = Math.round((overall / 15) * 10) / 10;
  const scoreSentiment: PerformanceSentiment = overall >= STRENGTH_THRESHOLD ? "good" : overall < FOCUS_THRESHOLD ? "bad" : "neutral";

  if (standout.value >= STRENGTH_THRESHOLD) return { axis: standout.axis, sentiment: "good", score, scoreSentiment };
  if (standout.value < FOCUS_THRESHOLD) return { axis: standout.axis, sentiment: "bad", score, scoreSentiment };
  return { axis: "wellRounded", sentiment: "neutral", score, scoreSentiment };
}

export function summarizeMatchPerformance(match: RecentMatchSummary, tier?: string | null): MatchPerformanceNote {
  return summarizeParticipantPerformance(match, match.durationSeconds, match.teamKills, tier);
}

// --- skill-radar.ts's computePerformanceBadges ---
export type PerformanceBadgeKey = "farm" | "vision" | "kda" | "killParticipation" | "damage" | "wellRounded" | "focus";
export type PerformanceBadgeSentiment = PerformanceSentiment;

export interface PerformanceBadge {
  key: PerformanceBadgeKey;
  /** Which skill axis this badge is about, if any (used for the icon/label). */
  axis?: SkillAxis;
  sentiment: PerformanceBadgeSentiment;
}

export function computePerformanceBadges(points: SkillRadarPoint[]): PerformanceBadge[] {
  if (points.length === 0) return [];

  const badges: PerformanceBadge[] = [];
  for (const p of points) {
    if (p.value >= STRENGTH_THRESHOLD) badges.push({ key: p.axis, axis: p.axis, sentiment: "good" });
    else if (p.value < FOCUS_THRESHOLD) badges.push({ key: "focus", axis: p.axis, sentiment: "bad" });
  }

  if (badges.length === 0) badges.push({ key: "wellRounded", sentiment: "neutral" });

  return badges;
}

export function summarizeParticipant(
  participant: MatchParticipantSummary,
  durationSeconds: number,
  teams: { teamId: number; kills: number }[],
  tier?: string | null,
): MatchPerformanceNote {
  const teamKills = teams.find((t) => t.teamId === participant.teamId)?.kills ?? 1;
  return summarizeParticipantPerformance(participant, durationSeconds, teamKills, tier);
}

// --- role-breakdown.ts ---
export const KNOWN_POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export const RANKED_SOLO_QUEUE_ID = 420;
export const RANKED_FLEX_QUEUE_ID = 440;

export interface RoleStats {
  position: (typeof KNOWN_POSITIONS)[number];
  games: number;
  wins: number;
}

export function computeRoleBreakdown(
  matches: Pick<RecentMatchSummary, "queueId" | "teamPosition" | "win">[],
  queueId: number,
): RoleStats[] {
  const byPosition = new Map<string, RoleStats>(
    KNOWN_POSITIONS.map((position) => [position, { position, games: 0, wins: 0 }]),
  );
  for (const match of matches) {
    if (match.queueId !== queueId) continue;
    const entry = byPosition.get(match.teamPosition);
    if (!entry) continue;
    entry.games += 1;
    if (match.win) entry.wins += 1;
  }
  return [...byPosition.values()].sort((a, b) => b.games - a.games);
}

// --- head-to-head.ts ---
export type HeadToHeadStatKey = "winRate" | "kda" | "csPerMin" | "killsPerGame" | "deathsPerGame" | "assistsPerGame" | "visionPerMin";

export interface HeadToHeadStat {
  key: HeadToHeadStatKey;
  valueA: number;
  valueB: number;
  higherIsBetter: boolean;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function playerStats(matches: RecentMatchSummary[]) {
  const minutes = matches.map((m) => Math.max(1, m.durationSeconds / 60));
  return {
    csPerMin: round(average(matches.map((m, i) => m.cs / minutes[i]))),
    kda: round(average(matches.map((m) => (m.kills + m.assists) / Math.max(1, m.deaths)))),
    killsPerGame: round(average(matches.map((m) => m.kills))),
    deathsPerGame: round(average(matches.map((m) => m.deaths))),
    assistsPerGame: round(average(matches.map((m) => m.assists))),
    visionPerMin: round(average(matches.map((m, i) => m.visionScore / minutes[i]))),
    winRate: round((matches.filter((m) => m.win).length / Math.max(1, matches.length)) * 100),
  };
}

export function computeHeadToHead(matchesA: RecentMatchSummary[], matchesB: RecentMatchSummary[]): HeadToHeadStat[] {
  const a = playerStats(matchesA);
  const b = playerStats(matchesB);
  return [
    { key: "winRate", valueA: a.winRate, valueB: b.winRate, higherIsBetter: true },
    { key: "kda", valueA: a.kda, valueB: b.kda, higherIsBetter: true },
    { key: "csPerMin", valueA: a.csPerMin, valueB: b.csPerMin, higherIsBetter: true },
    { key: "killsPerGame", valueA: a.killsPerGame, valueB: b.killsPerGame, higherIsBetter: true },
    { key: "deathsPerGame", valueA: a.deathsPerGame, valueB: b.deathsPerGame, higherIsBetter: false },
    { key: "assistsPerGame", valueA: a.assistsPerGame, valueB: b.assistsPerGame, higherIsBetter: true },
    { key: "visionPerMin", valueA: a.visionPerMin, valueB: b.visionPerMin, higherIsBetter: true },
  ];
}

// --- position-icon.ts / rank-emblem.ts (URL builders only) ---
const POSITION_ICON_FILES: Record<string, string> = {
  TOP: "position-top",
  JUNGLE: "position-jungle",
  MIDDLE: "position-middle",
  BOTTOM: "position-bottom",
  UTILITY: "position-utility",
};

export function positionIconUrl(teamPosition: string): string | null {
  const file = POSITION_ICON_FILES[teamPosition];
  if (!file) return null;
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/${file}.svg`;
}

const VALID_TIERS = new Set(["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]);

export function rankEmblemUrl(tier: string): string | null {
  const normalized = tier.toUpperCase();
  if (!VALID_TIERS.has(normalized)) return null;
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-mini-crests/${normalized.toLowerCase()}.png`;
}

// --- champion-pool.ts ---
// Honest "what you already play and how it's going" pool per role — built
// entirely from the player's own match history. Deliberately NOT a
// recommendation engine (see the web's own champion-pool.ts comment: that
// would need matchup/synergy winrate data Riot's API doesn't expose) —
// only ever real, already-played champions.
export interface ChampionPoolEntry {
  championName: string;
  games: number;
  wins: number;
}

export interface RolePool {
  position: (typeof KNOWN_POSITIONS)[number];
  champions: ChampionPoolEntry[];
  /** Ported from the web's champion-pool.ts — every game in this role, not
   * just the top MAX_PER_ROLE champions, so the UI can say "62% of your
   * Jungle games are on Kayn" instead of just re-listing champions. */
  totalGames: number;
}

const MAX_PER_ROLE = 3;

export function computeChampionPool(matches: RecentMatchSummary[]): RolePool[] {
  const pools: RolePool[] = [];
  for (const position of KNOWN_POSITIONS) {
    const inRole = matches.filter((m) => m.teamPosition === position);
    if (inRole.length === 0) continue;

    const byChampion = new Map<string, { games: number; wins: number }>();
    for (const match of inRole) {
      const entry = byChampion.get(match.championName) ?? { games: 0, wins: 0 };
      entry.games += 1;
      if (match.win) entry.wins += 1;
      byChampion.set(match.championName, entry);
    }

    const champions: ChampionPoolEntry[] = [...byChampion.entries()]
      .sort((a, b) => b[1].games - a[1].games)
      .slice(0, MAX_PER_ROLE)
      .map(([championName, stats]) => ({ championName, games: stats.games, wins: stats.wins }));

    pools.push({ position, champions, totalGames: inRole.length });
  }

  return pools.sort((a, b) => {
    const gamesA = a.champions.reduce((sum, c) => sum + c.games, 0);
    const gamesB = b.champions.reduce((sum, c) => sum + c.games, 0);
    return gamesB - gamesA;
  });
}

// --- champion-overview.ts ---
export interface ChampionOverviewStats {
  championName: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  minutes: number;
}

const MAX_OVERVIEW_ROWS = 6;

export function computeChampionOverview(matches: RecentMatchSummary[]): ChampionOverviewStats[] {
  const byChampion = new Map<string, ChampionOverviewStats>();
  for (const match of matches) {
    const entry = byChampion.get(match.championName) ?? {
      championName: match.championName,
      games: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      cs: 0,
      minutes: 0,
    };
    entry.games += 1;
    if (match.win) entry.wins += 1;
    entry.kills += match.kills;
    entry.deaths += match.deaths;
    entry.assists += match.assists;
    entry.cs += match.cs;
    entry.minutes += match.durationSeconds / 60;
    byChampion.set(match.championName, entry);
  }
  return [...byChampion.values()].sort((a, b) => b.games - a.games).slice(0, MAX_OVERVIEW_ROWS);
}

// --- activity-calendar.ts ---
// Current-calendar-month view only, built from the same recentMatches the
// profile payload already carries — the web's month-navigation (browsing
// to past months) needs a fresh Riot Match-V5 range query the desktop app
// doesn't make; out of scope here (see PROGRESS.md).
export interface DayActivity {
  /** YYYY-MM-DD, local time */
  date: string;
  games: number;
  wins: number;
  losses: number;
}

function dateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Whole month, 1st through the last day — including days still to come, so
// the calendar doesn't read as broken on the 1st of a new month (just one
// cell in an otherwise-empty grid). The card renders those future days
// more translucent to tell them apart from real, already-played days,
// same distinction ActivityCalendarCard draws from each entry's own date
// against today's.
export function buildActivityGrid(matches: Pick<RecentMatchSummary, "playedAt" | "win">[]): DayActivity[] {
  const byDay = new Map<string, DayActivity>();
  for (const match of matches) {
    const key = dateKey(match.playedAt);
    const entry = byDay.get(key) ?? { date: key, games: 0, wins: 0, losses: 0 };
    entry.games += 1;
    if (match.win) entry.wins += 1;
    else entry.losses += 1;
    byDay.set(key, entry);
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);

  const grid: DayActivity[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d.getTime());
    grid.push(byDay.get(key) ?? { date: key, games: 0, wins: 0, losses: 0 });
  }
  return grid;
}

// Ported from the web app's src/lib/utils.ts::formatRelativeTime — same
// logic, same real locale passed in (from useI18n() here, not next-intl),
// since this is a plain client render with no server/client split to
// worry about, but the wrong-language-when-runtime-locale-differs concern
// that made an explicit locale mandatory on the web still applies.
export function formatRelativeTime(fromMs: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffMs = fromMs - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMs / 3_600_000);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");
  const diffDays = Math.round(diffMs / 86_400_000);
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, "day");
  const diffMonths = Math.round(diffMs / (86_400_000 * 30));
  return rtf.format(diffMonths, "month");
}
