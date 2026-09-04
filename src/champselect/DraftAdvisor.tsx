// Draft Advisor: the "like iTero" pick recommendation Julio asked for,
// shown in the main app window during ChampSelect, not in the in-game
// overlay (OverlayView.tsx keeps its own simpler, non-matchup-aware
// suggestPicks panel untouched — see draft-help.ts). Ranks real candidates
// for the player's assigned role by a blend of the real 1v1 lane matchup
// winrate (once the enemy laner is known) and the player's own real
// winrate with that champion — see suggestMatchupPicks in draft-help.ts
// for the combination formula and its honesty guarantees.
import { useEffect, useMemo, useState } from "react";
import { fetchChampionMap, type ChampionMaps } from "../ddragon";
import { suggestMatchupPicks, type ChampionWinrateEntry, type LaneMatchupEntry, type MatchupSuggestion } from "../draft-help";
import { computeChampionOverview, type ChampionOverviewStats } from "../lib/profile-analysis";
import { fetchProfile } from "../profile/ProfileShared";
import { API_BASE_URL } from "../shared/api";
import { COLORS, TYPE, cardStyle as makeCardStyle } from "../theme";
import { useI18n } from "../i18n";
import type { LcuIdentity } from "../riftcompass";

interface ChampSelectPlayer {
  cellId: number;
  championId: number;
  assignedPosition: string;
  puuid?: string;
}

interface ChampSelectSession {
  localPlayerCellId: number;
  myTeam?: ChampSelectPlayer[];
  theirTeam?: ChampSelectPlayer[];
}

const EMPTY_MAPS: ChampionMaps = { byId: {}, byInternalId: {}, byNormalizedName: {} };
const cardStyle = makeCardStyle();

function tierColor(tier: MatchupSuggestion["tier"]): string {
  if (tier === "good") return COLORS.goodMild;
  if (tier === "risky") return COLORS.badMild;
  return COLORS.muted;
}

export function DraftAdvisor({ identity }: { identity: LcuIdentity | null }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<string>("None");
  const [myTeam, setMyTeam] = useState<ChampSelectPlayer[]>([]);
  const [theirTeam, setTheirTeam] = useState<ChampSelectPlayer[]>([]);
  const [localCellId, setLocalCellId] = useState<number | null>(null);
  const [champions, setChampions] = useState<ChampionMaps>(EMPTY_MAPS);
  // null = not fetched for this champ select yet; [] = fetched, nothing
  // usable (empty or failed). The distinction matters: an effect keyed on
  // "list is empty" refetched in a tight loop whenever the API answered
  // with an empty list or an error, because each `set([])` is a new array.
  const [roleWinrates, setRoleWinrates] = useState<ChampionWinrateEntry[] | null>(null);
  const [matchups, setMatchups] = useState<LaneMatchupEntry[]>([]);
  const [personalOverview, setPersonalOverview] = useState<ChampionOverviewStats[]>([]);

  useEffect(() => {
    window.riftcompass.onPhase((p) => setPhase(p));
    window.riftcompass.onChampSelectSession((session) => {
      // Same "ignore the teardown event" guard as OverlayView.tsx — the LCU
      // sends one final session with no real myTeam right as champ select
      // ends, which would otherwise wipe the roster this component is
      // still reading from for a moment after the phase flips away.
      const s = session as ChampSelectSession | null;
      if (!s?.myTeam?.length) return;
      setMyTeam(s.myTeam);
      setTheirTeam(s.theirTeam ?? []);
      setLocalCellId(s.localPlayerCellId ?? null);
    });
  }, []);

  // Same lazy champion-map fetch OverlayView.tsx uses — no point spending
  // the ~500KB champion.json fetch outside champ select.
  useEffect(() => {
    if (phase !== "ChampSelect" || Object.keys(champions.byId).length > 0) return;
    fetchChampionMap()
      .then(setChampions)
      .catch(() => {
        // Offline or Data Dragon hiccup — the advisor just stays empty.
      });
  }, [phase, champions]);

  // One fetch per champ select: reset on leaving it, fetch once on entering.
  useEffect(() => {
    if (phase !== "ChampSelect") {
      setRoleWinrates(null);
      return;
    }
    if (roleWinrates !== null) return;
    fetch(`${API_BASE_URL}/api/v1/champion-winrates`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setRoleWinrates(data.winrates ?? []))
      .catch(() => setRoleWinrates([]));
  }, [phase, roleWinrates]);

  const localPlayer = myTeam.find((p) => p.cellId === localCellId);
  const enemyLaner = theirTeam.find((p) => p.assignedPosition === localPlayer?.assignedPosition);
  const enemyChampionName = enemyLaner?.championId ? champions.byId[enemyLaner.championId]?.internalId : undefined;
  const enemyChampion = enemyLaner?.championId ? champions.byId[enemyLaner.championId] : undefined;

  // Real matchup winrate, only once the enemy laner is actually known
  // (progressively resolves during the draft, same as the recommended
  // build's matchup awareness in OverlayView.tsx) — before that,
  // suggestMatchupPicks below falls back to the role-wide winrate for
  // every candidate on its own.
  useEffect(() => {
    if (phase !== "ChampSelect" || !localPlayer?.assignedPosition || !enemyChampionName) {
      setMatchups([]);
      return;
    }
    const params = new URLSearchParams({ role: localPlayer.assignedPosition.toUpperCase(), enemy: enemyChampionName });
    fetch(`${API_BASE_URL}/api/v1/champion-matchup?${params}`)
      .then((r) => r.json())
      .then((data) => setMatchups(data.matchups ?? []))
      .catch(() => setMatchups([]));
  }, [phase, localPlayer?.assignedPosition, enemyChampionName]);

  // The player's own real winrate per champion, from their own recent
  // match history — Infinity instead of the profile summary's default
  // top-6 cap, since a candidate outside the player's top 6 by games is
  // exactly the kind of pick this should still recognize.
  useEffect(() => {
    if (phase !== "ChampSelect" || !identity) return;
    let cancelled = false;
    fetchProfile(identity.platform, identity.gameName, identity.tagLine).then((data) => {
      if (cancelled || "error" in data) return;
      setPersonalOverview(computeChampionOverview(data.profile.recentMatches, Infinity));
    });
    return () => {
      cancelled = true;
    };
  }, [phase, identity]);

  const suggestions = useMemo(() => {
    if (!localPlayer?.assignedPosition || Object.keys(champions.byId).length === 0) return [];
    // Both teams, not just mine — a champion already locked by anyone
    // (either side) can't be picked again this game.
    const pickedIds = [...myTeam, ...theirTeam].filter((p) => p.championId).map((p) => p.championId);
    return suggestMatchupPicks(Object.values(champions.byId), pickedIds, localPlayer.assignedPosition, matchups, roleWinrates ?? [], personalOverview);
  }, [champions, myTeam, theirTeam, localPlayer?.assignedPosition, matchups, roleWinrates, personalOverview]);

  if (phase !== "ChampSelect") {
    return <p style={{ color: COLORS.muted, fontSize: TYPE.body, margin: 0 }}>{t("DraftAdvisor.notInChampSelect")}</p>;
  }

  if (!localPlayer?.assignedPosition) {
    return (
      <div style={cardStyle}>
        <p style={{ color: COLORS.muted, fontSize: TYPE.body, margin: 0 }}>{t("DraftAdvisor.waitingForRole")}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={cardStyle}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>
          {t("DraftAdvisor.roleLabel", { role: t(`Profile.positions.${localPlayer.assignedPosition.toLowerCase()}`) })}
        </span>
        <p style={{ margin: "6px 0 0", fontSize: TYPE.body, color: COLORS.text }}>
          {enemyChampion ? t("DraftAdvisor.enemyKnown", { champion: enemyChampion.name }) : t("DraftAdvisor.enemyUnknown")}
        </p>
      </div>

      {suggestions.length === 0 ? (
        <div style={cardStyle}>
          <p style={{ color: COLORS.muted, fontSize: TYPE.body, margin: 0 }}>{t("DraftAdvisor.empty")}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {suggestions.map((s) => (
            <div
              key={s.champion.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderRadius: 10,
                padding: "10px 12px",
                background: `${COLORS.card}99`,
                borderLeft: `3px solid ${tierColor(s.tier)}`,
              }}
            >
              <img src={s.champion.iconUrl} alt="" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: TYPE.body, fontWeight: 700, color: COLORS.text }}>{s.champion.name}</span>
                <span style={{ fontSize: 11, color: COLORS.muted }}>
                  {s.matchupWinRate !== undefined && s.matchupGames !== undefined
                    ? t(s.matchupSpecific ? "DraftAdvisor.matchupLabel" : "DraftAdvisor.roleWideLabel", {
                        percent: Math.round(s.matchupWinRate * 100),
                        games: s.matchupGames,
                      })
                    : t("DraftAdvisor.matchupNone")}
                </span>
                <span style={{ fontSize: 11, color: COLORS.muted }}>
                  {s.personalWinRate !== undefined && s.personalGames !== undefined
                    ? t("DraftAdvisor.personalLabel", { percent: Math.round(s.personalWinRate * 100), games: s.personalGames })
                    : t("DraftAdvisor.personalNone")}
                </span>
              </div>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "4px 10px",
                  borderRadius: 999,
                  color: tierColor(s.tier),
                  background: `${tierColor(s.tier)}26`,
                }}
              >
                {t(`DraftAdvisor.tier.${s.tier}`)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
