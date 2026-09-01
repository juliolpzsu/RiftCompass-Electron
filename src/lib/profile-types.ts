// Mirrors the web app's PlayerProfile / RecentMatchSummary shape
// (src/lib/riot/profile.ts) — the JSON shape returned by riftcompass.com's
// own GET /api/v1/profile/[platform]/[riotId]. Kept as a plain type-only
// duplicate (same reasoning as champion-damage-type.ts/rank-lp.ts: the
// renderer can't import across the repo boundary).
export interface MatchParticipantSummary {
  puuid: string;
  gameName: string;
  tagLine: string;
  championName: string;
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  visionScore: number;
  teamPosition: string;
  champLevel: number;
  goldEarned: number;
  damageDealt: number;
  killParticipation: number;
  summonerSpells: [number, number];
  items: [number, number, number, number, number, number, number];
}

export interface TeamSummary {
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number;
  dragonKills: number;
  baronKills: number;
  towerKills: number;
  inhibitorKills: number;
  riftHeraldKills: number;
}

export interface RecentMatchSummary {
  matchId: string;
  queueId: number;
  queueName: string;
  win: boolean;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  visionScore: number;
  teamPosition: string;
  durationSeconds: number;
  playedAt: number;
  damageDealt: number;
  teamKills: number;
  laningAdvantage: boolean;
  participants: MatchParticipantSummary[];
  teams: TeamSummary[];
}

export interface RiotLeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  veteran: boolean;
  inactive: boolean;
  freshBlood: boolean;
  hotStreak: boolean;
}

export interface PlayerProfile {
  gameName: string;
  tagLine: string;
  puuid: string;
  profileIconId: number;
  summonerLevel: number;
  soloQueue: RiotLeagueEntry | null;
  flexQueue: RiotLeagueEntry | null;
  recentMatches: RecentMatchSummary[];
  // ISO timestamp, already part of the route's response — just wasn't read
  // on this side until the refresh button needed a real "updated N minutes
  // ago" label to match the web's own RefreshProfileButton.
  fetchedAt: string;
}

export interface ProfileApiResponse {
  profile: PlayerProfile;
  ddragonVersion: string;
  rankTier: string | null;
  lpHistory: { tier: string; rank: string; leaguePoints: number; wins: number; losses: number; capturedAt: string }[];
  // The player's own highest-mastery champion (Data Dragon string id),
  // resolved server-side by the same lib the web profile header and /duo
  // use. Optional so older cached responses stay valid.
  topMasteryChampionId?: string | null;
}

export interface ProfileApiError {
  error: string;
  status?: number;
}
