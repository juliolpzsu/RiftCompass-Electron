// The renderer<->main-process bridge: implements the whole RiftCompassApi
// over Electron IPC (contextBridge/ipcRenderer, wired in electron/preload.ts)
// and installs it on window.riftcompass — the single seam between UI
// components and the Electron main process.
//
// Two modes:
// - Inside Electron: every method invokes its CMD.* IPC channel; if a
//   channel is missing or fails, the same local stub the browser uses
//   kicks in.
// - Plain browser (`npm run dev`, no Electron needed): the local stub
//   alone. Settings persist to localStorage; account/LCU features report
//   honest failures instead of pretending to work.
import { CMD, EVT } from "./commands";
import type {
  AbilityBarCalibration,
  AccountUser,
  AppSettings,
  FlashSide,
  FolderActionResult,
  LcuIdentity,
  LoginResult,
  LoadMapResult,
  OverlayModules,
  OverlayPanelKey,
  ScreenPoint,
  RiftCompassApi,
  SavedBuild,
  SaveBuildResult,
  SavedDraft,
  SaveDraftResult,
  SavedMapSummary,
  SaveMapResult,
  SavedProfilesPayload,
  SavedTierList,
  SaveTierListResult,
  SupportedLocale,
  ToggleSavedProfileResult,
  UpdateUsernameResult,
} from "../riftcompass";

// Exposed by electron/preload.ts via contextBridge.exposeInMainWorld — a
// deliberately thin primitive (invoke + subscribe) so this file, not the
// preload script, owns the actual API shape and the browser-mode fallback.
declare global {
  interface Window {
    __electronBridge__?: {
      invoke: <T>(channel: string, args?: Record<string, unknown>) => Promise<T>;
      on: <T>(channel: string, cb: (payload: T) => void) => () => void;
    };
  }
}

const IN_ELECTRON = typeof window !== "undefined" && !!window.__electronBridge__;

// ---------------------------------------------------------------------------
// Local settings stub — same defaults and "first launch picks the
// closest supported locale to the OS language" behavior as the main
// process side. Only a fallback: inside Electron the invoke path wins and
// this store goes unused.
// ---------------------------------------------------------------------------
const SETTINGS_KEY = "riftcompass:settings:v1";
const SUPPORTED: readonly SupportedLocale[] = ["en", "es", "fr", "de"];

function detectLocale(): SupportedLocale {
  const lang = (navigator.language || "en").slice(0, 2).toLowerCase();
  return (SUPPORTED as readonly string[]).includes(lang) ? (lang as SupportedLocale) : "en";
}

function defaultSettings(): AppSettings {
  return {
    autoLaunch: false,
    overlayModules: { csPerMinute: true, goldDiff: true, skillOrder: true, autoBuild: true },
    locale: detectLocale(),
    flashSide: "left",
    abilityBarCalibration: null,
    overlayPanelPositions: { gold: null, objectives: null, csPerMin: null, enemySpells: null },
  };
}

function loadLocalSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const base = defaultSettings();
    return {
      autoLaunch: typeof parsed.autoLaunch === "boolean" ? parsed.autoLaunch : base.autoLaunch,
      overlayModules: { ...base.overlayModules, ...(parsed.overlayModules ?? {}) },
      locale: (SUPPORTED as readonly string[]).includes(parsed.locale as string)
        ? (parsed.locale as SupportedLocale)
        : base.locale,
      flashSide: parsed.flashSide === "left" || parsed.flashSide === "right" ? parsed.flashSide : base.flashSide,
      // Calibration and panel dragging genuinely can't happen without the
      // native overlay window (browser dev mode has none) — never
      // fabricate a position.
      abilityBarCalibration: null,
      overlayPanelPositions: { gold: null, objectives: null, csPerMin: null, enemySpells: null },
    };
  } catch {
    return defaultSettings();
  }
}

function saveLocalSettings(settings: AppSettings): AppSettings {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable — settings just won't persist this session.
  }
  return settings;
}

// invoke() the given command; if it fails (not inside Electron, or the
// main-process handler isn't implemented yet), run the local fallback.
async function tryInvoke<T>(cmd: string, args: Record<string, unknown> | undefined, fallback: () => T | Promise<T>): Promise<T> {
  if (IN_ELECTRON) {
    try {
      return await window.__electronBridge__!.invoke<T>(cmd, args);
    } catch (err) {
      console.warn(`[bridge] ${cmd} failed, using local fallback:`, err);
    }
  }
  return fallback();
}

function subscribe<T>(event: string, cb: (payload: T) => void): void {
  if (!IN_ELECTRON) return; // nothing emits these in a plain browser
  window.__electronBridge__!.on<T>(event, cb);
}

// "network" is one of the login error codes MainView already knows how to
// translate (Auth.errors.network) — the honest description of "there is no
// backend to talk to".
const NO_BACKEND = "network";

// The main process connects to a running League client within a couple of
// seconds of launch — often before this renderer has registered its event
// listeners, so the one-shot "connected"/identity pushes can be missed
// entirely on a cold start. Pull the current state once per subscription
// to close that gap; a duplicate delivery is harmless (same value).
function replayLcuState(cb: (state: { connected: boolean; identity: LcuIdentity | null }) => void): void {
  if (!IN_ELECTRON) return;
  window
    .__electronBridge__!.invoke<{ connected: boolean; identity: LcuIdentity | null }>(CMD.LcuGetState)
    .then(cb)
    .catch(() => {});
}

const api: RiftCompassApi = {
  onLcuConnection: (cb) => {
    subscribe(EVT.LcuConnection, cb);
    replayLcuState((state) => cb(state.connected ? "connected" : "disconnected"));
  },
  onPhase: (cb) => subscribe(EVT.LcuPhase, cb),
  onLcuIdentity: (cb) => {
    subscribe(EVT.LcuIdentity, cb);
    replayLcuState((state) => cb(state.identity));
  },
  onChampSelectSession: (cb) => subscribe(EVT.ChampSelectSession, cb),
  onLiveGameData: (cb) => subscribe(EVT.LiveGameData, cb),
  onTabHeld: (cb) => subscribe(EVT.OverlayTabHeld, cb),
  onCalibrationStart: (cb) => subscribe(EVT.OverlayCalibrationStart, cb),

  request: <T = unknown>(method: string, path: string, body?: unknown): Promise<T> =>
    tryInvoke<T>(CMD.LcuRequest, { method, path, body }, () => {
      throw new Error("LCU backend not available");
    }),

  setInteractive: (interactive: boolean): void => {
    if (!IN_ELECTRON) return;
    window.__electronBridge__!.invoke(CMD.OverlaySetInteractive, { interactive }).catch(() => {});
  },

  enterCalibration: (): Promise<void> => tryInvoke(CMD.OverlayEnterCalibration, undefined, () => undefined),
  exitCalibration: (): Promise<void> => tryInvoke(CMD.OverlayExitCalibration, undefined, () => undefined),

  importBuild: (championId) =>
    tryInvoke(CMD.BuildImport, { championId }, () => ({ ok: false as const, reason: "unavailable" })),

  applyRecommendedBuild: (perkIds, primaryStyleId, subStyleId, spellLow, spellHigh) =>
    tryInvoke(
      CMD.ApplyRecommendedBuild,
      { perkIds, primaryStyleId, subStyleId, spellLow, spellHigh },
      () => ({ ok: false as const, reason: "unavailable" }),
    ),

  getSettings: (): Promise<AppSettings> => tryInvoke(CMD.SettingsGet, undefined, loadLocalSettings),
  setAutoLaunch: (enabled: boolean): Promise<AppSettings> =>
    tryInvoke(CMD.SettingsSetAutoLaunch, { enabled }, () =>
      // Auto-launch genuinely can't work without the native side — keep the
      // stored value false so the UI doesn't claim a registration that
      // never happened (same "never fabricate state" rule as main/settings.ts).
      saveLocalSettings({ ...loadLocalSettings(), autoLaunch: false }),
    ),
  setOverlayModules: (modules: Partial<OverlayModules>): Promise<AppSettings> =>
    tryInvoke(CMD.SettingsSetOverlayModules, { modules }, () => {
      const current = loadLocalSettings();
      return saveLocalSettings({ ...current, overlayModules: { ...current.overlayModules, ...modules } });
    }),
  setLocale: (locale: string): Promise<AppSettings> =>
    tryInvoke(CMD.SettingsSetLocale, { locale }, () => {
      const next = (SUPPORTED as readonly string[]).includes(locale) ? (locale as SupportedLocale) : "en";
      return saveLocalSettings({ ...loadLocalSettings(), locale: next });
    }),
  setFlashSide: (side: FlashSide): Promise<AppSettings> =>
    tryInvoke(CMD.SettingsSetFlashSide, { side }, () => saveLocalSettings({ ...loadLocalSettings(), flashSide: side })),
  setAbilityBarCalibration: (calibration: AbilityBarCalibration): Promise<AppSettings> =>
    tryInvoke(CMD.SettingsSetAbilityBarCalibration, { calibration }, () =>
      saveLocalSettings({ ...loadLocalSettings(), abilityBarCalibration: calibration }),
    ),
  setOverlayPanelPosition: (panel: OverlayPanelKey, position: ScreenPoint): Promise<AppSettings> =>
    tryInvoke(CMD.SettingsSetOverlayPanelPosition, { panel, position }, () =>
      // Same "can't really happen outside the native overlay window" case
      // as calibration above — nothing to persist in plain-browser dev mode.
      loadLocalSettings(),
    ),

  login: (email: string, password: string): Promise<LoginResult> =>
    tryInvoke(CMD.AccountLogin, { email, password }, () => ({ ok: false as const, error: NO_BACKEND })),
  logout: (): Promise<void> => tryInvoke(CMD.AccountLogout, undefined, () => undefined),
  getSession: (): Promise<AccountUser | null> => tryInvoke(CMD.AccountGetSession, undefined, () => null),
  getSavedProfiles: (): Promise<SavedProfilesPayload> =>
    tryInvoke(CMD.AccountGetSavedProfiles, undefined, () => ({ folders: [], profiles: [] })),
  toggleSavedProfile: (platform: string, gameName: string, tagLine: string, puuid?: string): Promise<ToggleSavedProfileResult> =>
    tryInvoke(CMD.AccountToggleSavedProfile, { platform, gameName, tagLine, puuid }, () => ({ ok: false as const, error: NO_BACKEND })),
  updateUsername: (username: string): Promise<UpdateUsernameResult> =>
    tryInvoke(CMD.AccountUpdateUsername, { username }, () => ({ ok: false as const, error: NO_BACKEND })),
  createProfileFolder: (name: string): Promise<FolderActionResult> =>
    tryInvoke(CMD.AccountCreateProfileFolder, { name }, () => ({ ok: false as const, error: NO_BACKEND })),
  renameProfileFolder: (id: string, name: string): Promise<FolderActionResult> =>
    tryInvoke(CMD.AccountRenameProfileFolder, { id, name }, () => ({ ok: false as const, error: NO_BACKEND })),
  deleteProfileFolder: (id: string): Promise<FolderActionResult> =>
    tryInvoke(CMD.AccountDeleteProfileFolder, { id }, () => ({ ok: false as const, error: NO_BACKEND })),
  setSavedProfileFolder: (profileId: string, folderId: string): Promise<FolderActionResult> =>
    tryInvoke(CMD.AccountSetProfileFolder, { profileId, folderId }, () => ({ ok: false as const, error: NO_BACKEND })),
  getSavedTierLists: (): Promise<SavedTierList[]> => tryInvoke(CMD.AccountGetSavedTierLists, undefined, () => []),
  createTierList: (name: string, board: Record<string, string[]>): Promise<SaveTierListResult> =>
    tryInvoke(CMD.AccountCreateTierList, { name, board }, () => ({ ok: false as const, error: NO_BACKEND })),
  deleteTierList: (id: string): Promise<SaveTierListResult> =>
    tryInvoke(CMD.AccountDeleteTierList, { id }, () => ({ ok: false as const, error: NO_BACKEND })),
  getSavedDrafts: (): Promise<SavedDraft[]> => tryInvoke(CMD.AccountGetSavedDrafts, undefined, () => []),
  createDraft: (name: string, selections: string[]): Promise<SaveDraftResult> =>
    tryInvoke(CMD.AccountCreateDraft, { name, selections }, () => ({ ok: false as const, error: NO_BACKEND })),
  deleteDraft: (id: string): Promise<SaveDraftResult> =>
    tryInvoke(CMD.AccountDeleteDraft, { id }, () => ({ ok: false as const, error: NO_BACKEND })),
  getSavedMaps: (): Promise<SavedMapSummary[]> => tryInvoke(CMD.AccountGetSavedMaps, undefined, () => []),
  getSavedMap: (id: string): Promise<LoadMapResult> =>
    tryInvoke(CMD.AccountGetSavedMap, { id }, () => ({ ok: false as const, error: NO_BACKEND })),
  createMap: (name: string, strokes: unknown[], notes: string): Promise<SaveMapResult> =>
    tryInvoke(CMD.AccountCreateMap, { name, strokes, notes }, () => ({ ok: false as const, error: NO_BACKEND })),
  deleteMap: (id: string): Promise<SaveMapResult> =>
    tryInvoke(CMD.AccountDeleteMap, { id }, () => ({ ok: false as const, error: NO_BACKEND })),
  getSavedBuilds: (): Promise<SavedBuild[]> => tryInvoke(CMD.AccountGetSavedBuilds, undefined, () => []),
  createBuild: (name: string, items: string[], supportRole: boolean): Promise<SaveBuildResult> =>
    tryInvoke(CMD.AccountCreateBuild, { name, items, supportRole }, () => ({ ok: false as const, error: NO_BACKEND })),
  deleteBuild: (id: string): Promise<SaveBuildResult> =>
    tryInvoke(CMD.AccountDeleteBuild, { id }, () => ({ ok: false as const, error: NO_BACKEND })),

  openExternal: async (url: string): Promise<void> => {
    // Same allowlist the main process enforces (see electron/ipc.ts): only
    // riftcompass.com URLs go out to the OS browser.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== "https:" || !/(^|\.)riftcompass\.com$/.test(parsed.hostname)) return;
    if (IN_ELECTRON) {
      await window.__electronBridge__!.invoke(CMD.ShellOpenExternal, { url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },
};

export function installBridge(): void {
  window.riftcompass = api;
}
