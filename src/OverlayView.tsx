import { useEffect, useRef, useState } from "react";
import { fetchChampionMap, mergeLocalizedChampionNames, normalizeChampionName, type ChampionMaps } from "./ddragon";
import { suggestPicks, type ChampionWinrateEntry } from "./draft-help";
import { useI18n } from "./i18n";
import { API_BASE_URL } from "./shared/api";
import { CS_PER_MIN_TARGETS, positionIconUrl, rankEmblemUrl, tierToBand } from "./lib/profile-analysis";
import type { AbilityBarCalibration, LcuIdentity, OverlayModules, OverlayPanelPositions } from "./riftcompass";

const ROSE = "#e63977";
const CARD_BG = "rgba(23, 18, 26, 0.78)";
const BORDER = "1px solid rgba(255,255,255,0.08)";
const MUTED = "#9a94a0";

const cardStyle: React.CSSProperties = {
  background: CARD_BG,
  border: BORDER,
  borderRadius: 14,
  padding: "12px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)",
};

const headingStyle: React.CSSProperties = {
  color: MUTED,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  fontFamily: "'Russo One', sans-serif",
  fontWeight: 400,
};

interface ChampSelectPlayer {
  cellId: number;
  championId: number;
  assignedPosition: string;
  puuid?: string;
}

interface ChampSelectSession {
  localPlayerCellId: number;
  myTeam?: ChampSelectPlayer[];
  // Enemy picks — championId (never puuid) is visible progressively during
  // the draft even before it's locked in, same LCU shape as myTeam. Used to
  // resolve the local player's real lane opponent for a matchup-aware
  // recommended build (see fetchRecommendedBuild below).
  theirTeam?: ChampSelectPlayer[];
}

interface RecommendedSpells {
  spellLow: number;
  spellHigh: number;
  games: number;
  matchupSpecific: boolean;
}

interface RecommendedItems {
  coreItemsKey: string;
  games: number;
  matchupSpecific: boolean;
}

interface RecommendedRunes {
  primaryStyleId: number;
  subStyleId: number;
  perk0: number;
  perk1: number;
  perk2: number;
  perk3: number;
  perk4: number;
  perk5: number;
  statPerk0: number;
  statPerk1: number;
  statPerk2: number;
  games: number;
  matchupSpecific: boolean;
}

interface RecommendedBuild {
  runes: RecommendedRunes | null;
  spells: RecommendedSpells | null;
  items: RecommendedItems | null;
}

interface SkillOrderEntry {
  level: number;
  skillSlot: number;
  games: number;
}

interface SummonerInfo {
  gameName: string;
  tagLine: string;
}

interface LiveGameItem {
  itemID: number;
  count: number;
  // Riot's own real gold cost for this item — used for the "~" gold
  // estimate on players who aren't you (see goldForPlayer below).
  price: number;
}

interface LiveGamePlayer {
  championName: string;
  isDead: boolean;
  level: number;
  team: "ORDER" | "CHAOS";
  riotIdGameName?: string;
  riotIdTagLine?: string;
  summonerName?: string;
  items?: LiveGameItem[];
  scores: { kills: number; deaths: number; assists: number; creepScore: number };
  summonerSpells?: {
    summonerSpellOne: { displayName: string };
    summonerSpellTwo: { displayName: string };
  };
}

interface LiveGameEvent {
  EventName: string;
  EventTime: number;
}

interface LiveGameData {
  allPlayers: LiveGamePlayer[];
  // gameMode distinguishes Summoner's Rift ("CLASSIC") from ARAM/URF/etc —
  // a custom game on Summoner's Rift still reports "CLASSIC", so objective
  // timers work the same in a custom game as in a real queued match; other
  // modes don't have dragon/herald/baron at all, so features tied to that
  // objective must check this instead of assuming every live game is on
  // Summoner's Rift.
  gameData: { gameTime: number; gameMode: string };
  // The full official event feed (GameStart, ChampionKill, DragonKill,
  // etc. — see docs/overlay-research.md) — liveclient.rs already forwards
  // the raw /allgamedata payload untouched, so this was always present,
  // just unused until the objective timer below started reading it.
  events?: { Events: LiveGameEvent[] };
  activePlayer?: { currentGold: number };
  activePlayerName?: string;
}

// Riot's own spawn/respawn timings for the neutral objectives — balance
// values that move between seasons, so they live here as easy constants to
// revise (see docs/overlay-research.md's sourcing) rather than buried in
// the render logic below. Dragon and Baron always respawn some fixed delay
// after each kill; Herald and Void Grubs are each a single spawn for the
// whole game — Herald either gets taken or leaves for good once Baron
// takes over, Grubs simply despawn to make room for Herald in the same
// jungle pit.
//
// Verified live 2026-08-28 against the current wiki (Void Grubs added
// s2024, timings have shifted patch to patch since) — the old
// HERALD_SPAWN_SECONDS = 8*60 here was stale, from before Void Grubs
// existed: https://wiki.leagueoflegends.com/en-us/Voidgrub_camp,
// https://www.leagueoflegends.com/en-us/news/game-updates/patch-14-1-notes/
const DRAGON_FIRST_SPAWN_SECONDS = 5 * 60;
const DRAGON_RESPAWN_SECONDS = 5 * 60;
const VOID_GRUBS_SPAWN_SECONDS = 8 * 60;
// The real despawn is 14:45, or 14:55 if a champion is actively fighting
// them at that moment — there's no Events entry to detect that, so this is
// the earlier (safer to show "gone") of the two, same honesty approach as
// the estimated-gold "~" prefix elsewhere in this file.
const VOID_GRUBS_DESPAWN_SECONDS = 14 * 60 + 45;
const HERALD_SPAWN_SECONDS = 15 * 60;
const BARON_FIRST_SPAWN_SECONDS = 20 * 60;
const BARON_RESPAWN_SECONDS = 6 * 60;

// Only meaningful on Summoner's Rift — none of these objectives exist on
// ARAM/URF/other modes' maps at all.
const CLASSIC_GAME_MODE = "CLASSIC";

// Real minimap objective icons (Community Dragon's minimap icon atlas,
// same hosting pattern as rankEmblemUrl/positionIconUrl) — verified to
// exist 2026-08-30, including a real Void Grubs icon ("grub.png", added
// when Community Dragon caught up with the champion's s2024 addition) —
// no more text-label fallback needed for any of the four.
type ObjectiveKind = "dragon" | "herald" | "baron" | "voidGrubs";

const OBJECTIVE_ICON: Record<ObjectiveKind, string> = {
  dragon: "https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/dragon.png",
  herald: "https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/riftherald.png",
  baron: "https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/baron.png",
  voidGrubs: "https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/grub.png",
};

function lastEventTime(events: LiveGameEvent[], name: string): number | null {
  const times = events.filter((e) => e.EventName === name).map((e) => e.EventTime);
  return times.length > 0 ? Math.max(...times) : null;
}

interface ObjectiveTimer {
  key: ObjectiveKind;
  remainingSeconds: number;
}

// Void Grubs, Herald and Baron all live in the same jungle pit, one after
// another — so instead of three parallel entries, the pit is a single
// timer that shows whichever of the
// three is actually relevant right now: Grubs until their despawn time,
// then Herald until it's taken (or Baron's first spawn pushes it out
// either way), then Baron for the rest of the game on its own respawn
// cycle. Dragon has its own separate pit across the map and keeps its own
// entry. Real per-game timing throughout (last *Kill event + respawn
// delay, or the relevant constant if it hasn't happened yet), not a fixed
// schedule — correct across games where the first dragon/baron pops at a
// different real time.
function computePitTimer(events: LiveGameEvent[], gameTime: number): ObjectiveTimer {
  const heraldTaken = lastEventTime(events, "HeraldKill") !== null;
  const baronKill = lastEventTime(events, "BaronKill");
  const baronSpawn = baronKill !== null ? baronKill + BARON_RESPAWN_SECONDS : BARON_FIRST_SPAWN_SECONDS;

  if (heraldTaken || baronKill !== null || gameTime >= BARON_FIRST_SPAWN_SECONDS) {
    return { key: "baron", remainingSeconds: baronSpawn - gameTime };
  }
  if (gameTime >= VOID_GRUBS_DESPAWN_SECONDS) {
    return { key: "herald", remainingSeconds: HERALD_SPAWN_SECONDS - gameTime };
  }
  return { key: "voidGrubs", remainingSeconds: VOID_GRUBS_SPAWN_SECONDS - gameTime };
}

function computeObjectiveTimers(events: LiveGameEvent[], gameTime: number): ObjectiveTimer[] {
  const dragonKill = lastEventTime(events, "DragonKill");
  const dragonSpawn = dragonKill !== null ? dragonKill + DRAGON_RESPAWN_SECONDS : DRAGON_FIRST_SPAWN_SECONDS;
  return [{ key: "dragon", remainingSeconds: dragonSpawn - gameTime }, computePitTimer(events, gameTime)];
}

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const EMPTY_MAPS: ChampionMaps = { byId: {}, byInternalId: {}, byNormalizedName: {} };
const DDRAGON_VERSION_FALLBACK = "14.1.1";

function liveGamePlayerName(p: LiveGamePlayer): string {
  if (p.riotIdGameName) return p.riotIdTagLine ? `${p.riotIdGameName}#${p.riotIdTagLine}` : p.riotIdGameName;
  return p.summonerName ?? "—";
}

// Riot's activeplayername endpoint returns whichever of these two formats
// the client happens to use — compared against both so "is this you" never
// silently fails to match on a client that uses one form or the other.
function isLocalPlayer(p: LiveGamePlayer, activePlayerName: string | undefined): boolean {
  if (!activePlayerName) return false;
  return activePlayerName === liveGamePlayerName(p) || activePlayerName === p.summonerName;
}

function csPerMinute(p: LiveGamePlayer, gameTimeSeconds: number): number | null {
  if (gameTimeSeconds <= 0) return null;
  return Math.round((p.scores.creepScore / (gameTimeSeconds / 60)) * 10) / 10;
}

// Base cooldowns (Summoner's Rift, no CDR items/runes) for the manual
// enemy-spell tracker below — Live Client Data reports when a spell exists
// on a player but never when it's actually cast or its real remaining
// cooldown, so this is a player-started countdown from the moment they
// click "used", not a live-detected one. Riot doesn't expose Data
// Dragon's key/cooldown lookup by display name directly, so this maps the
// two by hand; matches the current (patch-stable) Summoner's Rift kit —
// not ARAM's Mark or Nexus-siege's To the King!, which never show up here
// since this panel only renders in CLASSIC games.
const SUMMONER_SPELL_INFO: Record<string, { ddragonKey: string; cooldownSeconds: number }> = {
  Flash: { ddragonKey: "SummonerFlash", cooldownSeconds: 300 },
  Ignite: { ddragonKey: "SummonerDot", cooldownSeconds: 180 },
  Exhaust: { ddragonKey: "SummonerExhaust", cooldownSeconds: 210 },
  Barrier: { ddragonKey: "SummonerBarrier", cooldownSeconds: 180 },
  Cleanse: { ddragonKey: "SummonerBoost", cooldownSeconds: 210 },
  Heal: { ddragonKey: "SummonerHeal", cooldownSeconds: 240 },
  Ghost: { ddragonKey: "SummonerHaste", cooldownSeconds: 210 },
  Teleport: { ddragonKey: "SummonerTeleport", cooldownSeconds: 360 },
  Smite: { ddragonKey: "SummonerSmite", cooldownSeconds: 90 },
  Clarity: { ddragonKey: "SummonerMana", cooldownSeconds: 240 },
};

// Exact for the local player (Riot exposes their real live gold directly);
// everyone else's real current gold isn't exposed by the API at all — this
// sums the real per-item cost of what's visibly built instead, which is
// necessarily an underestimate (doesn't account for gold already spent on
// wards/potions/sold items) — shown without a "~" marker in the UI, as an
// understood approximation.
function goldForPlayer(p: LiveGamePlayer, isLocal: boolean, activeGold: number | undefined): { amount: number } | null {
  if (isLocal && activeGold !== undefined) return { amount: Math.round(activeGold) };
  const items = p.items ?? [];
  if (items.length === 0) return null;
  const amount = items.reduce((sum, item) => sum + item.price * item.count, 0);
  return { amount };
}

// Lane gold table: one row per lane — your laner, the
// gold diff, their laner — your side always on the left regardless of
// which in-game team (ORDER/CHAOS) you're actually on. Matched via champ
// select's assignedPosition (already known per cellId, both teams) +
// championId -> internalId -> Live Client Data's championName, same
// resolution already used for the recommended-build matchup lookup above.
const LANE_POSITIONS = ["top", "jungle", "middle", "bottom", "utility"] as const;

interface LaneRow {
  position: (typeof LANE_POSITIONS)[number];
  mine: LiveGamePlayer | undefined;
  theirs: LiveGamePlayer | undefined;
}

// Looks up a Live Client Data championName (English internal id for real
// players, client-display-locale name for bots — see ChampionMaps'
// byNormalizedName doc comment) the same normalized way everywhere it's
// used for an icon, not just lane matching.
function championInfoFor(champions: ChampionMaps, championName: string) {
  return champions.byNormalizedName[normalizeChampionName(championName)];
}

function resolveLanePlayer(
  team: ChampSelectPlayer[],
  position: string,
  champions: ChampionMaps,
  allPlayers: LiveGamePlayer[],
): LiveGamePlayer | undefined {
  // Case-insensitive: ranked/normal queues report assignedPosition
  // lowercase ("top"), but custom lobbies with a manual per-slot role
  // picker (the dropdown next to each player before the game starts)
  // report it uppercase ("TOP") — same field, different casing depending
  // on where it was set.
  const picked = team.find((p) => p.assignedPosition?.toLowerCase() === position);
  const info = picked?.championId ? champions.byId[picked.championId] : undefined;
  if (!info) return undefined;
  // Live Client Data reports the English internal id for real players,
  // but a bot-controlled champion's name comes back in the client's own
  // display locale (verified live 2026-08-31: "Maestro Yi" for
  // MasterYi under a Spanish-locale client) — normalized matching
  // against champions.byNormalizedName (populated with both forms by
  // mergeLocalizedChampionNames) covers both.
  return allPlayers.find((p) => championInfoFor(champions, p.championName) === info);
}

function buildLaneRows(
  myTeam: ChampSelectPlayer[],
  theirTeam: ChampSelectPlayer[],
  champions: ChampionMaps,
  allPlayers: LiveGamePlayer[],
): LaneRow[] {
  return LANE_POSITIONS.map((position) => ({
    position,
    mine: resolveLanePlayer(myTeam, position, champions, allPlayers),
    theirs: resolveLanePlayer(theirTeam, position, champions, allPlayers),
  }));
}

// Small wrapper that opts an interactive element (and only that element)
// out of the overlay window's default click-through — see preload's
// setInteractive and main/windows.ts's ignoreMouseEvents.
function Interactive({ children }: { children: React.ReactNode }) {
  return (
    <div onMouseEnter={() => window.riftcompass.setInteractive(true)} onMouseLeave={() => window.riftcompass.setInteractive(false)}>
      {children}
    </div>
  );
}

// Lets a panel be picked up and dragged with the mouse while it's visible
// (Tab held). The overlay window is click-through by default
// (set_ignore_cursor_events(true)) — Windows only forwards hover/move for
// CSS purposes through that, never an actual click, so a plain onMouseDown
// on a click-through element never fires. Same fix as the existing
// Interactive wrapper (Import build button): onMouseEnter turns off
// click-through *before* the click happens, so the following onMouseDown
// actually reaches React. Unlike Interactive, onMouseLeave must NOT
// re-enable click-through while a drag is in progress — the cursor
// immediately leaves the panel's original bounds on the very first drag
// pixel, and losing interactivity mid-drag would stop the window from
// receiving the mousemove/mouseup events the drag depends on. Position is
// normalized (0-1 of the overlay window, same convention as
// AbilityBarCalibration) so it survives a resolution change; `saved: null`
// means "hasn't been dragged yet, use the panel's own default corner
// styling".
function useDraggablePanel(saved: { x: number; y: number } | null, onDrop: (normalized: { x: number; y: number }) => void) {
  const toPixels = (n: { x: number; y: number } | null) => (n ? { x: n.x * window.innerWidth, y: n.y * window.innerHeight } : null);
  const [dragPos, setDragPos] = useState(() => toPixels(saved));
  const draggingRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const lastPosRef = useRef(dragPos);

  useEffect(() => {
    setDragPos(toPixels(saved));
  }, [saved]);

  function onMouseEnter() {
    window.riftcompass.setInteractive(true);
  }

  function onMouseLeave() {
    if (!draggingRef.current) window.riftcompass.setInteractive(false);
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    draggingRef.current = { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    window.riftcompass.setInteractive(true);

    function onMouseMove(ev: MouseEvent) {
      if (!draggingRef.current) return;
      const x = Math.min(Math.max(0, ev.clientX - draggingRef.current.offsetX), window.innerWidth - 40);
      const y = Math.min(Math.max(0, ev.clientY - draggingRef.current.offsetY), window.innerHeight - 40);
      lastPosRef.current = { x, y };
      setDragPos({ x, y });
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      draggingRef.current = null;
      window.riftcompass.setInteractive(false);
      const pos = lastPosRef.current;
      if (pos) onDrop({ x: pos.x / window.innerWidth, y: pos.y / window.innerHeight });
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return { dragPos, onMouseDown, onMouseEnter, onMouseLeave };
}

export function OverlayView() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<string>("None");
  const [myTeam, setMyTeam] = useState<ChampSelectPlayer[]>([]);
  const [theirTeam, setTheirTeam] = useState<ChampSelectPlayer[]>([]);
  const [localCellId, setLocalCellId] = useState<number | null>(null);
  const [liveGame, setLiveGame] = useState<LiveGameData | null>(null);
  const [champions, setChampions] = useState<ChampionMaps>(EMPTY_MAPS);
  const [ddragonVersion, setDdragonVersion] = useState(DDRAGON_VERSION_FALLBACK);
  // The League client's own display locale (e.g. "es_ES"), from
  // lcu:identity — see ddragon.ts's mergeLocalizedChampionNames for why
  // the lane-gold table needs this.
  const [gameClientLocale, setGameClientLocale] = useState<string | undefined>(undefined);
  const [summoners, setSummoners] = useState<Record<string, SummonerInfo>>({});
  const [importState, setImportState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [overlayModules, setOverlayModules] = useState<OverlayModules>({
    csPerMinute: true,
    goldDiff: true,
    skillOrder: true,
    autoBuild: true,
  });
  // Gold and objectives only show while Tab is held (see tab_watch.rs),
  // matching the native scoreboard's own timing instead of a permanent
  // HUD line.
  const [tabHeld, setTabHeld] = useState(false);
  const [skillOrder, setSkillOrder] = useState<SkillOrderEntry[]>([]);
  const [recommendedBuild, setRecommendedBuild] = useState<RecommendedBuild | null>(null);
  const [championWinrates, setChampionWinrates] = useState<ChampionWinrateEntry[]>([]);
  const [applyBuildState, setApplyBuildState] = useState<"idle" | "working" | "done" | "error">("idle");
  const requestedPuuids = useRef(new Set<string>());
  // The local player's real solo-queue tier, for the CS/min-vs-elo target —
  // fetched once via the LCU, not carried by Live Client Data or the
  // champ-select session.
  const [localRankTier, setLocalRankTier] = useState<string | null>(null);
  const [abilityCalibration, setAbilityCalibration] = useState<AbilityBarCalibration | null>(null);
  // Which ability the calibration flow is waiting for a click on next —
  // null when not calibrating. See handleCalibrationClick below.
  const [calibrationStep, setCalibrationStep] = useState<"q" | "w" | "e" | null>(null);
  // Where the player dragged each draggable panel to, normalized (0-1 of
  // the overlay window, same convention as AbilityBarCalibration) so it
  // stays valid across resolutions — null until the player drags it once,
  // meaning "use the default corner".
  const [panelPositions, setPanelPositions] = useState<OverlayPanelPositions>({ gold: null, objectives: null, csPerMin: null, enemySpells: null });
  // Manual enemy summoner-spell cooldowns: the player clicks a spell the
  // moment they see the enemy use it, starting a
  // countdown from its base cooldown — see SUMMONER_SPELL_INFO above for
  // why this can't be detected automatically. Keyed by "team-championName"
  // (unique per game outside blind pick / bot lobbies, the only modes
  // where a team could field the same champion twice); value is the
  // timestamp (Date.now()-based) the spell becomes available again, or
  // null/absent while it's up.
  const [enemyCooldowns, setEnemyCooldowns] = useState<Record<string, { one: number | null; two: number | null }>>({});
  // Ticks once a second, only while there's actually something to
  // recompute a countdown against — no point running a timer during champ
  // select or while Tab isn't held and the panel is invisible.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    window.riftcompass.onPhase((p) => setPhase(p));
    window.riftcompass.onChampSelectSession((session) => {
      // The LCU sends one final teardown event the moment champ select ends
      // (verified live, 2026-08-30: not JS null, but a payload with no real
      // myTeam array — e.g. a "Delete" JSON-API event with {} data) — an
      // `if (!s) return` guard alone doesn't catch that shape, and
      // overwriting with `s.myTeam ?? []` still wipes the roster right
      // before InProgress starts. Only accept updates that actually carry a
      // real team, so the draft's lane assignments survive into the lane
      // gold table below (which only ever renders during InProgress, long
      // after this event fires). A real new draft (next game) always
      // delivers a fresh session with a populated myTeam before the next
      // InProgress phase, so there's no window where this could show stale
      // data.
      const s = session as ChampSelectSession | null;
      if (!s?.myTeam?.length) return;
      setMyTeam(s.myTeam);
      setTheirTeam(s.theirTeam ?? []);
      setLocalCellId(s.localPlayerCellId ?? null);
    });
    window.riftcompass.onLiveGameData((data) => setLiveGame(data as LiveGameData | null));
    window.riftcompass.onTabHeld(setTabHeld);
    window.riftcompass.onCalibrationStart(() => setCalibrationStep("q"));
    window.riftcompass.onLcuIdentity((identity: LcuIdentity | null) => setGameClientLocale(identity?.gameClientLocale));
    window.riftcompass.getSettings().then((s) => {
      setOverlayModules(s.overlayModules);
      setAbilityCalibration(s.abilityBarCalibration ?? null);
      setPanelPositions(s.overlayPanelPositions);
    });
  }, []);

  useEffect(() => {
    setImportState("idle");
    setApplyBuildState("idle");
  }, [localCellId, myTeam.find((p) => p.cellId === localCellId)?.championId]);

  useEffect(() => {
    if (phase !== "InProgress" || !tabHeld) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase, tabHeld]);

  // A fresh game means every previous cooldown is stale — clear them
  // instead of carrying yesterday's Flash timer into today's match.
  useEffect(() => {
    if (phase !== "InProgress") setEnemyCooldowns({});
  }, [phase]);

  // Fetched once, lazily, only when it's actually needed (champ select or
  // an in-progress game) — no point spending the ~500KB champion.json
  // fetch on every launch if the user never queues up.
  useEffect(() => {
    const needsChampionData = phase === "ChampSelect" || phase === "InProgress";
    if (!needsChampionData || Object.keys(champions.byId).length > 0) return;
    fetch("https://ddragon.leagueoflegends.com/api/versions.json")
      .then((r) => r.json())
      .then((versions: string[]) => setDdragonVersion(versions[0]));
    fetchChampionMap()
      .then(setChampions)
      .catch(() => {
        // Offline or Data Dragon hiccup — champion names just stay blank,
        // not worth surfacing an error over in a corner overlay.
      });
  }, [phase, champions]);

  // Once both the champion map and the client's real locale are known,
  // merge in that locale's champion names so bot-controlled picks (whose
  // Live Client Data championName comes back localized, not as the
  // English internal id) resolve too — see resolveLanePlayer above.
  useEffect(() => {
    if (!gameClientLocale || Object.keys(champions.byId).length === 0) return;
    mergeLocalizedChampionNames(champions, ddragonVersion, gameClientLocale).then(() => {
      setChampions({ ...champions });
    });
    // Only re-run when the locale itself or the base map identity
    // changes — champions is mutated in place by design, so it can't be
    // a dependency without looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameClientLocale, champions.byId]);

  // Teammates only — the LCU never exposes puuid for the enemy team until
  // after the draft, matching Riot's own privacy behavior (not a bug here).
  useEffect(() => {
    for (const player of myTeam) {
      if (!player.puuid || requestedPuuids.current.has(player.puuid)) continue;
      requestedPuuids.current.add(player.puuid);
      window.riftcompass
        .request<{ gameName: string; tagLine: string }>("GET", `/lol-summoner/v1/summoners/puuid/${player.puuid}`)
        .then((info) => {
          setSummoners((prev) => ({ ...prev, [player.puuid!]: { gameName: info.gameName, tagLine: info.tagLine } }));
        })
        .catch(() => {
          // Not resolvable yet (e.g. still loading in) — un-mark it so the
          // next champ-select session update retries instead of giving up
          // on this player for the rest of the draft.
          requestedPuuids.current.delete(player.puuid!);
        });
    }
  }, [myTeam]);

  // Recommended build (runes/spells/items) for the local player's
  // champion+role — matchup-aware against the real lane opponent once
  // champ select has revealed one (theirTeam's championId is visible
  // progressively during the draft even before puuid is), falling back to
  // the blended bucket server-side when that specific matchup has no
  // sample yet (see getRecommendedBuild's matchupSpecific flag).
  useEffect(() => {
    if (phase !== "ChampSelect" || !overlayModules.autoBuild) {
      setRecommendedBuild(null);
      return;
    }
    const local = myTeam.find((p) => p.cellId === localCellId);
    if (!local?.championId || !local.assignedPosition || Object.keys(champions.byId).length === 0) return;
    const championName = champions.byId[local.championId]?.internalId;
    if (!championName) return;

    const enemy = theirTeam.find((p) => p.assignedPosition === local.assignedPosition);
    const enemyChampionName = enemy?.championId ? champions.byId[enemy.championId]?.internalId : undefined;
    const params = new URLSearchParams({ champion: championName, role: local.assignedPosition.toUpperCase() });
    if (enemyChampionName) params.set("enemy", enemyChampionName);

    fetch(`${API_BASE_URL}/api/v1/champion-build?${params}`)
      .then((r) => r.json())
      .then((data) => setRecommendedBuild({ runes: data.runes ?? null, spells: data.spells ?? null, items: data.items ?? null }))
      .catch(() => setRecommendedBuild(null));
  }, [phase, overlayModules.autoBuild, myTeam, theirTeam, localCellId, champions]);

  // Real winrate for the pick-suggestion row below (see suggestPicks in
  // draft-help.ts) — fetched once per champ select, not per keystroke, and
  // only while still picking (no point once a champion is locked in).
  // Same public, unauthenticated endpoint Meta Tier List uses on the web.
  // No ?rank= filter: this wants the same "one honest overall number"
  // Champion Pool Builder already settled on, not a per-rank breakdown
  // this small overlay card has no room to select.
  useEffect(() => {
    if (phase !== "ChampSelect" || championWinrates.length > 0) return;
    fetch(`${API_BASE_URL}/api/v1/champion-winrates`)
      .then((r) => r.json())
      .then((data) => setChampionWinrates(data.winrates ?? []))
      .catch(() => setChampionWinrates([]));
  }, [phase, championWinrates]);

  // Which ability to level up next — real per-level winrate for this
  // champion+role (see getRecommendedSkillOrder; not matchup-aware, skill
  // order isn't conditioned on the enemy the way builds are). Fetched once
  // per game: activePlayerName only becomes set once Live Client Data has
  // loaded and stays stable afterward, so this doesn't refetch every poll.
  useEffect(() => {
    if (phase !== "InProgress" || !overlayModules.skillOrder || !liveGame?.activePlayerName) {
      if (phase !== "InProgress") setSkillOrder([]);
      return;
    }
    const role = myTeam.find((p) => p.cellId === localCellId)?.assignedPosition;
    const player = liveGame.allPlayers.find((p) => isLocalPlayer(p, liveGame.activePlayerName));
    if (!role || !player?.championName) return;
    const params = new URLSearchParams({ champion: player.championName, role: role.toUpperCase() });
    fetch(`${API_BASE_URL}/api/v1/champion-skill-order?${params}`)
      .then((r) => r.json())
      .then((data) => setSkillOrder(data.skillOrder ?? []))
      .catch(() => setSkillOrder([]));
  }, [phase, overlayModules.skillOrder, myTeam, localCellId, liveGame?.activePlayerName]);

  // Fetched once per session (not per game) — same LCU endpoint the client
  // itself uses for the ranked tab, no reason to refetch every match.
  useEffect(() => {
    if ((phase !== "ChampSelect" && phase !== "InProgress") || localRankTier !== null) return;
    window.riftcompass
      .request<{ queueMap?: Record<string, { tier?: string }> }>("GET", "/lol-ranked-stats/v1/current-ranked-stats")
      .then((stats) => {
        const tier = stats.queueMap?.RANKED_SOLO_5x5?.tier;
        if (tier) setLocalRankTier(tier);
      })
      .catch(() => {
        // No rank yet (unranked) or LCU hiccup — CS/min-vs-elo just falls
        // back to the "default" band's target instead of showing nothing.
      });
  }, [phase, localRankTier]);

  // Ability-bar calibration: one click per ability (Q, then W, then E) on
  // whatever is currently under the cursor — see MainView.tsx's "Calibrar"
  // button (overlay_enter_calibration) for how this starts. Coordinates are
  // normalized (0-1 of the overlay window's own size, which now covers the
  // whole monitor) so they stay valid across the window's lifetime without
  // depending on screen pixels directly.
  function handleCalibrationClick(e: React.MouseEvent) {
    if (!calibrationStep) return;
    const point = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    const next: AbilityBarCalibration = {
      q: calibrationStep === "q" ? point : (abilityCalibration?.q ?? point),
      w: calibrationStep === "w" ? point : (abilityCalibration?.w ?? point),
      e: calibrationStep === "e" ? point : (abilityCalibration?.e ?? point),
    };
    setAbilityCalibration(next);
    if (calibrationStep === "q") {
      setCalibrationStep("w");
    } else if (calibrationStep === "w") {
      setCalibrationStep("e");
    } else {
      setCalibrationStep(null);
      window.riftcompass.setAbilityBarCalibration(next).catch(() => {});
      window.riftcompass.exitCalibration();
    }
  }

  const localPlayer = myTeam.find((p) => p.cellId === localCellId);
  const hasChampionData = Object.keys(champions.byId).length > 0;

  async function handleImportBuild() {
    if (!localPlayer?.championId) return;
    setImportState("working");
    try {
      const result = await window.riftcompass.importBuild(localPlayer.championId);
      setImportState(result.ok ? "done" : "error");
    } catch {
      setImportState("error");
    }
  }

  async function handleApplyRecommendedBuild() {
    if (!recommendedBuild?.runes || !recommendedBuild.spells) return;
    setApplyBuildState("working");
    try {
      const { runes, spells } = recommendedBuild;
      const result = await window.riftcompass.applyRecommendedBuild(
        [runes.perk0, runes.perk1, runes.perk2, runes.perk3, runes.perk4, runes.perk5, runes.statPerk0, runes.statPerk1, runes.statPerk2],
        runes.primaryStyleId,
        runes.subStyleId,
        spells.spellLow,
        spells.spellHigh,
      );
      setApplyBuildState(result.ok ? "done" : "error");
    } catch {
      setApplyBuildState("error");
    }
  }

  // Local player's CS/min against the real target for their own rank
  // band — same benchmark table the web profile's roadmap uses
  // (lib/profile-analysis.ts), not a new number.
  const localLiveGamePlayer = liveGame?.allPlayers.find((p) => isLocalPlayer(p, liveGame.activePlayerName));
  const localCsPerMin = localLiveGamePlayer ? csPerMinute(localLiveGamePlayer, liveGame?.gameData?.gameTime ?? 0) : null;
  const localCsTarget = CS_PER_MIN_TARGETS[tierToBand(localRankTier)];
  const localRankIcon = localRankTier ? rankEmblemUrl(localRankTier) : null;

  const laneRows = liveGame ? buildLaneRows(myTeam, theirTeam, champions, liveGame.allPlayers) : [];
  const enemyPlayers = liveGame && localLiveGamePlayer ? liveGame.allPlayers.filter((p) => p.team !== localLiveGamePlayer.team) : [];

  const goldDrag = useDraggablePanel(panelPositions.gold, (pos) => {
    setPanelPositions((prev) => ({ ...prev, gold: pos }));
    window.riftcompass.setOverlayPanelPosition("gold", pos).catch(() => {});
  });
  const objectivesDrag = useDraggablePanel(panelPositions.objectives, (pos) => {
    setPanelPositions((prev) => ({ ...prev, objectives: pos }));
    window.riftcompass.setOverlayPanelPosition("objectives", pos).catch(() => {});
  });
  const csPerMinDrag = useDraggablePanel(panelPositions.csPerMin, (pos) => {
    setPanelPositions((prev) => ({ ...prev, csPerMin: pos }));
    window.riftcompass.setOverlayPanelPosition("csPerMin", pos).catch(() => {});
  });
  const enemySpellsDrag = useDraggablePanel(panelPositions.enemySpells, (pos) => {
    setPanelPositions((prev) => ({ ...prev, enemySpells: pos }));
    window.riftcompass.setOverlayPanelPosition("enemySpells", pos).catch(() => {});
  });

  return (
    <div
      style={{ position: "relative", width: "100vw", height: "100vh", fontSize: 13 }}
      onClick={calibrationStep ? handleCalibrationClick : undefined}
    >
      {calibrationStep ? (
        <div
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            ...cardStyle,
            padding: "10px 18px",
            cursor: "crosshair",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: ROSE }}>
            {t("Overlay.calibrationClick", { ability: calibrationStep.toUpperCase() })}
          </span>
        </div>
      ) : null}

      {phase === "ChampSelect" && myTeam.length > 0 ? (
        <div style={{ position: "fixed", top: 12, right: 12, width: 420, ...cardStyle }}>
          <span style={headingStyle}>{t("Overlay.champSelect")}</span>
          {myTeam.map((p) => {
            const champ = p.championId ? champions.byId[p.championId] : undefined;
            const summoner = p.puuid ? summoners[p.puuid] : undefined;
            const position = p.assignedPosition ? t(`Profile.positions.${p.assignedPosition.toLowerCase()}`) : "—";
            const isLocal = p.cellId === localCellId;
            return (
              <div key={p.cellId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 7,
                    overflow: "hidden",
                    flexShrink: 0,
                    background: "rgba(255,255,255,0.06)",
                    border: isLocal ? `1px solid ${ROSE}` : "1px solid transparent",
                  }}
                >
                  {champ ? (
                    <img src={champ.iconUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : null}
                </div>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {summoner ? `${summoner.gameName}#${summoner.tagLine}` : isLocal ? t("Overlay.you") : "—"}
                  </span>
                  <span style={{ color: MUTED, fontSize: 11 }}>
                    {position} · {champ?.name ?? t("Overlay.lockingIn")}
                  </span>
                </div>
                {isLocal && p.championId ? (
                  <Interactive>
                    <button
                      onClick={handleImportBuild}
                      disabled={importState === "working" || importState === "done"}
                      style={{
                        flexShrink: 0,
                        border: "none",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: importState === "idle" || importState === "error" ? "pointer" : "default",
                        background: importState === "done" ? "rgba(120,220,150,0.15)" : `${ROSE}26`,
                        color: importState === "done" ? "#7edc96" : ROSE,
                      }}
                    >
                      {importState === "working"
                        ? t("Overlay.importing")
                        : importState === "done"
                          ? t("Overlay.imported")
                          : importState === "error"
                            ? t("Overlay.noRecentGame")
                            : t("Overlay.importLastBuild")}
                    </button>
                  </Interactive>
                ) : null}
              </div>
            );
          })}

          {overlayModules.autoBuild && localPlayer?.championId && recommendedBuild && (recommendedBuild.runes || recommendedBuild.spells || recommendedBuild.items) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4, borderTop: BORDER }}>
              <span style={{ ...headingStyle, fontSize: 10 }}>{t("Overlay.recommendedBuild")}</span>
              {recommendedBuild.items ? (
                <div style={{ display: "flex", gap: 4 }}>
                  {recommendedBuild.items.coreItemsKey.split(",").map((id) => (
                    <img
                      key={id}
                      src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${id}.png`}
                      alt=""
                      style={{ width: 22, height: 22, borderRadius: 4 }}
                    />
                  ))}
                </div>
              ) : null}
              <span style={{ color: MUTED, fontSize: 10 }}>
                {t(
                  recommendedBuild.runes?.matchupSpecific || recommendedBuild.spells?.matchupSpecific
                    ? "Overlay.buildMatchupSpecific"
                    : "Overlay.buildBlended",
                  { games: recommendedBuild.runes?.games ?? recommendedBuild.spells?.games ?? 0 },
                )}
              </span>
              {recommendedBuild.runes && recommendedBuild.spells ? (
                <Interactive>
                  <button
                    onClick={handleApplyRecommendedBuild}
                    disabled={applyBuildState === "working" || applyBuildState === "done"}
                    style={{
                      alignSelf: "flex-start",
                      border: "none",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: applyBuildState === "idle" || applyBuildState === "error" ? "pointer" : "default",
                      background: applyBuildState === "done" ? "rgba(120,220,150,0.15)" : `${ROSE}26`,
                      color: applyBuildState === "done" ? "#7edc96" : ROSE,
                    }}
                  >
                    {applyBuildState === "working"
                      ? t("Overlay.applyingBuild")
                      : applyBuildState === "done"
                        ? t("Overlay.buildApplied")
                        : applyBuildState === "error"
                          ? t("Overlay.applyBuildError")
                          : t("Overlay.applyRecommendedBuild")}
                  </button>
                </Interactive>
              ) : null}
            </div>
          ) : null}

          {!localPlayer?.championId && localPlayer?.assignedPosition && hasChampionData
            ? (() => {
                const suggestions = suggestPicks(
                  Object.values(champions.byId),
                  myTeam.filter((p) => p.championId).map((p) => p.championId),
                  localPlayer.assignedPosition,
                  championWinrates,
                );
                if (suggestions.length === 0) return null;
                // Your real lane opponent, if their pick has already been
                // revealed — shown as plain information (not a fabricated
                // counter-winrate; that data doesn't exist, see
                // draft-help.ts) so there's still something real to react
                // to, the way checking the enemy team panel by hand
                // already lets you do.
                const enemy = theirTeam.find((p) => p.assignedPosition === localPlayer.assignedPosition);
                const enemyChamp = enemy?.championId ? champions.byId[enemy.championId] : undefined;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4, borderTop: BORDER }}>
                    <span style={{ ...headingStyle, fontSize: 10 }}>
                      {t("Overlay.suggestedFor", { position: t(`Profile.positions.${localPlayer.assignedPosition.toLowerCase()}`) })}
                    </span>
                    {enemyChamp ? (
                      <span style={{ fontSize: 10, color: MUTED }}>
                        {t("Overlay.laneOpponent", { champion: enemyChamp.name })}
                      </span>
                    ) : null}
                    <div style={{ display: "flex", gap: 8 }}>
                      {suggestions.map((s) => (
                        <div
                          key={s.champion.id}
                          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: 56 }}
                        >
                          <div style={{ width: 32, height: 32, borderRadius: 7, overflow: "hidden" }}>
                            <img
                              src={s.champion.iconUrl}
                              alt=""
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: 10,
                              color: MUTED,
                              textAlign: "center",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              width: "100%",
                            }}
                          >
                            {s.champion.name}
                          </span>
                          {s.winRate !== undefined ? (
                            <span style={{ fontSize: 9, fontWeight: 600, color: "#7edc96" }}>
                              {t("Overlay.winRateBadge", { rate: Math.round(s.winRate * 100), games: s.games ?? 0 })}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()
            : null}
        </div>
      ) : null}

      {/* Objectives: just the icons + remaining time, no card behind them —
          a drop-shadow keeps them legible over whatever's on screen
          instead of a background box. Top-right by default, only while
          Tab is held, draggable to wherever the player wants while
          visible. Dragon and the shared void grubs/herald/baron pit (see
          computePitTimer) are the only two entries. */}
      {phase === "InProgress" && liveGame && tabHeld && liveGame.gameData?.gameMode === CLASSIC_GAME_MODE && liveGame.events?.Events ? (
        <div
          onMouseEnter={objectivesDrag.onMouseEnter}
          onMouseLeave={objectivesDrag.onMouseLeave}
          onMouseDown={objectivesDrag.onMouseDown}
          style={{
            ...(objectivesDrag.dragPos ? { position: "fixed", left: objectivesDrag.dragPos.x, top: objectivesDrag.dragPos.y } : { position: "fixed", top: 12, right: 12 }),
            display: "flex",
            gap: 14,
            cursor: "grab",
          }}
        >
          {computeObjectiveTimers(liveGame.events.Events, liveGame.gameData?.gameTime ?? 0).map((obj) => {
            const up = obj.remainingSeconds <= 0;
            return (
              <div
                key={obj.key}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 44, filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.85))" }}
                title={t(`Overlay.${obj.key}Timer`)}
              >
                <img src={OBJECTIVE_ICON[obj.key]} alt="" style={{ width: 26, height: 26, opacity: up ? 1 : 0.55 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: up ? "#7edc96" : "#fff" }}>
                  {up ? t("Overlay.objectiveUp") : formatCountdown(obj.remainingSeconds)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Own CS/min vs elo target: its own draggable panel, default just
          below the objectives panel. */}
      {phase === "InProgress" && liveGame && tabHeld && overlayModules.csPerMinute && localCsPerMin !== null ? (
        <div
          onMouseEnter={csPerMinDrag.onMouseEnter}
          onMouseLeave={csPerMinDrag.onMouseLeave}
          onMouseDown={csPerMinDrag.onMouseDown}
          style={{
            ...(csPerMinDrag.dragPos ? { position: "fixed", left: csPerMinDrag.dragPos.x, top: csPerMinDrag.dragPos.y } : { position: "fixed", top: 130, right: 12 }),
            width: 200,
            cursor: "grab",
            ...cardStyle,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {localRankIcon ? (
              <img src={localRankIcon} alt="" style={{ width: 20, height: 20 }} />
            ) : (
              <span />
            )}
            <span style={{ fontSize: 12, fontWeight: 600, color: localCsPerMin >= localCsTarget ? "#7edc96" : ROSE }}>
              {localCsPerMin} <span style={{ color: MUTED, fontWeight: 400 }}>/ {localCsTarget}</span>
            </span>
          </div>
        </div>
      ) : null}

      {/* Lane gold table: top-left by default, only while Tab is held (see
          tab_watch.rs) — Porofessor/iTero's own timing. Draggable to
          wherever the player wants while it's visible. */}
      {phase === "InProgress" && liveGame && overlayModules.goldDiff && tabHeld ? (
        <div
          onMouseEnter={goldDrag.onMouseEnter}
          onMouseLeave={goldDrag.onMouseLeave}
          onMouseDown={goldDrag.onMouseDown}
          style={{
            ...(goldDrag.dragPos ? { position: "fixed", left: goldDrag.dragPos.x, top: goldDrag.dragPos.y } : { position: "fixed", top: 12, left: 12 }),
            width: "auto",
            cursor: "grab",
            ...cardStyle,
          }}
        >
          <span style={headingStyle}>{t("Overlay.laneGold")}</span>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
            {laneRows.map((row, index) => {
              if (!row.mine && !row.theirs) return null;
              const mineIsLocal = row.mine ? isLocalPlayer(row.mine, liveGame.activePlayerName) : false;
              const mineGold = row.mine ? goldForPlayer(row.mine, mineIsLocal, liveGame.activePlayer?.currentGold) : null;
              const theirsGold = row.theirs ? goldForPlayer(row.theirs, false, undefined) : null;
              const diff = mineGold !== null && theirsGold !== null ? mineGold.amount - theirsGold.amount : null;
              const icon = positionIconUrl(row.position.toUpperCase());
              return (
                <div
                  key={row.position}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto 1fr",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderTop: index > 0 ? BORDER : "none",
                  }}
                >
                  <LaneChampion champ={row.mine ? championInfoFor(champions, row.mine.championName) : undefined} align="right" />
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 60 }}>
                    {icon ? <img src={icon} alt="" style={{ width: 12, height: 12, opacity: 0.6, marginBottom: 2 }} /> : null}
                    <span style={{ fontSize: 12, fontWeight: 700, color: diff === null ? MUTED : diff > 0 ? "#7edc96" : diff < 0 ? ROSE : MUTED }}>
                      {diff === null ? "—" : `${diff > 0 ? "+" : ""}${diff}`}
                    </span>
                  </div>
                  <LaneChampion champ={row.theirs ? championInfoFor(champions, row.theirs.championName) : undefined} align="left" />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Enemy summoner-spell tracker: champion icon + their two spells,
          clickable to start a manual cooldown countdown (see
          SUMMONER_SPELL_INFO above). Own draggable panel, default
          bottom-right, only while Tab is held. */}
      {phase === "InProgress" && liveGame && tabHeld && enemyPlayers.length > 0 ? (
        <div
          onMouseEnter={enemySpellsDrag.onMouseEnter}
          onMouseLeave={enemySpellsDrag.onMouseLeave}
          onMouseDown={enemySpellsDrag.onMouseDown}
          style={{
            ...(enemySpellsDrag.dragPos
              ? { position: "fixed", left: enemySpellsDrag.dragPos.x, top: enemySpellsDrag.dragPos.y }
              : { position: "fixed", bottom: 12, right: 12 }),
            width: "auto",
            cursor: "grab",
            ...cardStyle,
            gap: 6,
            padding: "8px 10px",
          }}
        >
          <span style={headingStyle}>{t("Overlay.enemySpells")}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {enemyPlayers.map((p) => {
              const key = `${p.team}-${p.championName}`;
              const champ = championInfoFor(champions, p.championName);
              const spells = [p.summonerSpells?.summonerSpellOne, p.summonerSpells?.summonerSpellTwo] as const;
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 5, overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.06)" }}>
                    {champ ? <img src={champ.iconUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {spells.map((spell, i) => {
                      if (!spell) return null;
                      const info = SUMMONER_SPELL_INFO[spell.displayName];
                      const slot = i === 0 ? "one" : "two";
                      if (!info) {
                        return (
                          <span key={i} style={{ fontSize: 9, color: MUTED, alignSelf: "center" }}>
                            {spell.displayName}
                          </span>
                        );
                      }
                      const endsAt = enemyCooldowns[key]?.[slot] ?? null;
                      const remaining = endsAt !== null ? Math.ceil((endsAt - now) / 1000) : 0;
                      const onCooldown = remaining > 0;
                      return (
                        <Interactive key={i}>
                          <button
                            onClick={() => {
                              if (onCooldown) return;
                              setEnemyCooldowns((prev) => ({
                                ...prev,
                                [key]: { ...prev[key], [slot]: Date.now() + info.cooldownSeconds * 1000 },
                              }));
                            }}
                            title={spell.displayName}
                            style={{
                              position: "relative",
                              width: 18,
                              height: 18,
                              padding: 0,
                              border: "none",
                              borderRadius: 4,
                              overflow: "hidden",
                              cursor: "pointer",
                              background: "transparent",
                            }}
                          >
                            <img
                              src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${info.ddragonKey}.png`}
                              alt={spell.displayName}
                              style={{ width: "100%", height: "100%", objectFit: "cover", opacity: onCooldown ? 0.35 : 1 }}
                            />
                            {onCooldown ? (
                              <span
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color: "#fff",
                                  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                                }}
                              >
                                {remaining}
                              </span>
                            ) : null}
                          </button>
                        </Interactive>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Recommended-skill highlight: drawn directly over the real Q/W/E
          ability icon in League's own HUD, wherever the player calibrated
          it once (see handleCalibrationClick above) — never a guessed
          position. */}
      {phase === "InProgress" && overlayModules.skillOrder && abilityCalibration && !calibrationStep
        ? (() => {
            const localLevel = localLiveGamePlayer?.level;
            if (localLevel === undefined) return null;
            const next = skillOrder.find((s) => s.level === localLevel + 1);
            if (!next) return null;
            const key = next.skillSlot === 1 ? "q" : next.skillSlot === 2 ? "w" : next.skillSlot === 3 ? "e" : null;
            const point = key ? abilityCalibration[key] : null;
            if (!point) return null;
            return (
              <div
                style={{
                  position: "fixed",
                  left: `calc(${point.x * 100}% - 26px)`,
                  top: `calc(${point.y * 100}% - 26px)`,
                  width: 52,
                  height: 52,
                  borderRadius: 10,
                  border: `3px solid ${ROSE}`,
                  boxShadow: `0 0 16px 4px ${ROSE}99`,
                  pointerEvents: "none",
                }}
              />
            );
          })()
        : null}
    </div>
  );
}

// Champion icon for one side of a lane-gold row — blank placeholder (not
// hidden entirely) when that lane's opponent hasn't picked/isn't resolved
// yet, so the row grid stays aligned instead of collapsing.
function LaneChampion({ champ, align }: { champ: { iconUrl: string; name: string } | undefined; align: "left" | "right" }) {
  return (
    <div style={{ display: "flex", justifyContent: align === "left" ? "flex-start" : "flex-end" }}>
      <div style={{ width: 24, height: 24, borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.06)", flexShrink: 0 }}>
        {champ ? <img src={champ.iconUrl} alt={champ.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      </div>
    </div>
  );
}
