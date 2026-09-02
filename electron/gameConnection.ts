// Owns the whole lifecycle of talking to the League client: polling for
// the lockfile, connecting/reconnecting the LCU websocket, tracking the
// gameflow phase, and polling Live Client Data while a match is running.
// Pushes state to the frontend via src/bridge/commands.ts's EVT map.
//
// Runs as one long-lived loop started from main.ts; the current
// credentials live in module state so the lcu_get and build_import IPC
// handlers can use the same connection.

import type WebSocket from "ws";
import { EVT } from "../src/bridge/commands";
import { connectWs, findLockfile, lcuRequest, parseEventFrame, readLockfile, type LcuCredentials } from "./lcu";
import { fetchLiveGameData } from "./liveclient";
import * as overlayTopmost from "./overlayTopmost";
import * as tabWatch from "./tabWatch";
import { broadcast, showMainWindow, showOverlay } from "./windows";

const LOCKFILE_POLL_MS = 2500;
const LIVE_GAME_POLL_MS = 3000;

let creds: LcuCredentials | null = null;
let localPuuid: string | null = null;
let livePollHandle: ReturnType<typeof setInterval> | null = null;
let tabWatchActive = false;
let topmostActive = false;
let lastIdentity: unknown = null;

// Current connection state, for the lcu_get_state IPC command: events are
// one-shot pushes, so a renderer that finishes loading after the main
// process already connected needs something to pull.
export function connectionSnapshot(): { connected: boolean; identity: unknown } {
  return { connected: creds !== null, identity: lastIdentity };
}

export function currentCreds(): LcuCredentials {
  if (!creds) throw new Error("Not connected to the League client");
  return creds;
}

export async function getLocalPuuid(): Promise<string> {
  if (localPuuid) return localPuuid;
  const c = currentCreds();
  const summoner = (await lcuRequest(c, "GET", "/lol-summoner/v1/current-summoner")) as { puuid?: string } | null;
  if (!summoner?.puuid) throw new Error("current-summoner returned no puuid");
  localPuuid = summoner.puuid;
  return localPuuid;
}

// Region -> API routing platform. `/riotclient/region-locale` is the
// live-verified region endpoint (the community-documented LoginDataPacket
// one 404s on real clients). Only EUW is live-verified in this map; the
// rest are Riot's long-public stable routing codes, and the SEA
// sub-regions are a lower-confidence best guess. Unknown regions return
// null — auto-centering just doesn't kick in rather than routing to a
// wrong platform.
const REGION_TO_PLATFORM: Record<string, string> = {
  NA: "na1",
  EUW: "euw1",
  EUNE: "eun1",
  KR: "kr",
  JP: "jp1",
  BR: "br1",
  LAN: "la1",
  LAS: "la2",
  OCE: "oc1",
  TR: "tr1",
  RU: "ru",
  ME: "me1",
  SG: "sg2",
  PH: "sg2",
  TH: "sg2",
  TW: "tw2",
  VN: "vn2",
};

async function getLocalIdentity(c: LcuCredentials): Promise<unknown> {
  const [summoner, regionLocale] = await Promise.all([
    lcuRequest(c, "GET", "/lol-summoner/v1/current-summoner").catch(() => null),
    lcuRequest(c, "GET", "/riotclient/region-locale").catch(() => null),
  ]);
  if (!summoner || !regionLocale) return null;
  const s = summoner as Record<string, unknown>;
  const gameName = typeof s.gameName === "string" ? s.gameName : "";
  const tagLine = typeof s.tagLine === "string" ? s.tagLine : "";
  const puuid = typeof s.puuid === "string" ? s.puuid : "";
  // Already in this same response — forwarded so the tools-home header
  // chip can show the real profile icon without a second LCU round-trip.
  const profileIconId = typeof s.profileIconId === "number" ? s.profileIconId : 0;
  const region = (regionLocale as Record<string, unknown>).region;
  const platform = typeof region === "string" ? REGION_TO_PLATFORM[region.toUpperCase()] : undefined;
  // The actual client locale (e.g. "es_ES") — Live Client Data reports
  // champion names in this locale for bot-controlled champions ("Maestro
  // Yi" for MasterYi under a Spanish client, not the English Data Dragon
  // key), so the overlay needs it to build a matching localized
  // champion-name lookup (see OverlayView.tsx's resolveLanePlayer).
  const gameClientLocale = (regionLocale as Record<string, unknown>).locale;
  if (platform && gameName && tagLine) {
    return { puuid, gameName, tagLine, platform, profileIconId, gameClientLocale };
  }
  return null;
}

// See overlayTopmost.ts for why a one-time alwaysOnTop isn't enough —
// runs for as long as the overlay is actually shown (both ChampSelect and
// InProgress), not just InProgress like tabWatch.
function startTopmostReassert(): void {
  if (topmostActive) return;
  topmostActive = true;
  overlayTopmost.start();
}

function stopTopmostReassert(): void {
  topmostActive = false;
  overlayTopmost.stop();
}

function setOverlayVisible(show: boolean): void {
  showOverlay(show);
  if (show) startTopmostReassert();
  else stopTopmostReassert();
}

// The Live Client Data API only comes up once the match has actually
// loaded in (a few seconds after the phase flips to "InProgress"), so
// early polls legitimately come back empty until then — not an error.
function startLivePolling(): void {
  if (livePollHandle) return;
  livePollHandle = setInterval(async () => {
    const data = await fetchLiveGameData();
    if (data) broadcast(EVT.LiveGameData, data);
  }, LIVE_GAME_POLL_MS);
}

function stopLivePolling(): void {
  if (livePollHandle) clearInterval(livePollHandle);
  livePollHandle = null;
  broadcast(EVT.LiveGameData, null);
}

// Only runs while a match is in progress — the overlay's gold-diff/
// objectives modules have nothing to gate on Tab outside a live game.
function startTabWatch(): void {
  if (tabWatchActive) return;
  tabWatchActive = true;
  tabWatch.start();
}

function stopTabWatch(): void {
  tabWatchActive = false;
  tabWatch.stop();
}

async function refreshPhase(c: LcuCredentials): Promise<void> {
  // A phase check can race a client restart — the next event/poll recovers.
  let phase: string;
  try {
    phase = (await lcuRequest(c, "GET", "/lol-gameflow/v1/gameflow-phase")) as string;
  } catch {
    return;
  }
  broadcast(EVT.LcuPhase, phase);

  // The overlay HUD only ever shows itself for the two phases it has real
  // content for — every other phase (menus, lobby, matchmaking, loading
  // screen) it stays hidden, matching Porofessor/iTero's behavior.
  setOverlayVisible(phase === "ChampSelect" || phase === "InProgress");

  if (phase === "ChampSelect") {
    try {
      const session = await lcuRequest(c, "GET", "/lol-champ-select/v1/session");
      broadcast(EVT.ChampSelectSession, session);
    } catch {
      // client mid-transition — the next websocket push recovers
    }
  }

  if (phase === "InProgress") {
    startLivePolling();
    startTabWatch();
  } else {
    stopLivePolling();
    stopTabWatch();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The whole connection lifecycle, forever: poll for the lockfile while
// disconnected, run the websocket while connected, clean up and go back
// to polling when the client goes away.
export async function run(): Promise<void> {
  for (;;) {
    // Polls for the lockfile rather than watching the filesystem — the
    // client's lockfile write isn't a single atomic event worth
    // subscribing to, and this only runs while disconnected.
    let found: LcuCredentials | null = null;
    while (!found) {
      const path = findLockfile();
      found = path ? readLockfile(path) : null;
      if (!found) await sleep(LOCKFILE_POLL_MS);
    }

    // A lockfile can be stale (client crashed without cleaning up) or
    // mid-write; a failed connect just means "retry next poll".
    let ws: WebSocket;
    try {
      ws = await connectWs(found);
    } catch {
      await sleep(LOCKFILE_POLL_MS);
      continue;
    }

    creds = found;
    broadcast(EVT.LcuConnection, "connected");
    // League just opened — bring the app up out of the tray. Closing the
    // window afterwards only hides it (windows.ts's close handler), so
    // this loop keeps waiting for the next launch.
    showMainWindow();
    await refreshPhase(found);
    const identity = await getLocalIdentity(found);
    lastIdentity = identity;
    broadcast(EVT.LcuIdentity, identity);

    await new Promise<void>((resolveSocket) => {
      ws.on("message", (raw) => {
        const text = raw.toString();
        const event = parseEventFrame(text);
        if (!event) return; // ping/keepalive/subscribe-ack frame
        if (event.uri === "/lol-gameflow/v1/gameflow-phase") {
          void refreshPhase(found);
        } else if (event.uri === "/lol-champ-select/v1/session") {
          broadcast(EVT.ChampSelectSession, event.data);
        }
      });
      ws.once("close", resolveSocket);
      ws.once("error", resolveSocket); // client closing mid-frame — same as a disconnect
    });

    // Disconnected — clear state and go back to lockfile polling.
    creds = null;
    localPuuid = null;
    lastIdentity = null;
    stopLivePolling();
    stopTabWatch();
    broadcast(EVT.LcuConnection, "disconnected");
    broadcast(EVT.LcuIdentity, null);
    setOverlayVisible(false);
  }
}
