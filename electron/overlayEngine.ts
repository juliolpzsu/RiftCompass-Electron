// The Overwolf integration: swaps the normal top-level overlay window
// (windows.ts's createOverlayWindow, invisible during League's real
// exclusive-fullscreen mode) for a window actually injected into League's
// own process via the `ow-electron` overlay package, which does survive
// exclusive fullscreen — see the root CLAUDE.md's "Por qué Electron" for
// why this migration happened at all.
//
// Access is still pending: Overwolf approved the app proposal but, since
// this targets a Riot game, also require Riot's own approval before
// whitelisting `@overwolf/ow-electron*` for real game injection (see
// docs/overwolf-registration.md). Everything below is real, working code
// against the actual published API (verified against
// node_modules/@overwolf/ow-electron-packages-types and Overwolf's own
// ow-electron-packages-sample repo, not guessed) — it just can't be
// exercised end-to-end against a real League process until that
// whitelisting lands. Until then this module is inert: `isOverwolfRuntime()`
// is false under the plain `electron` binary (today's only real distribution
// and the only one built by `npm run dist`/`pack:dir`), so main.ts falls
// back to windows.ts's createOverlayWindow() exactly as before.
//
// To actually exercise this (once whitelisted): `npx ow-electron .` instead
// of `electron .` (the ow-electron binary is already an installed
// devDependency) launches the app under the real overlay runtime.
import { app, screen } from "electron";
import { kGameIds } from "@overwolf/ow-electron-packages-types/game-list";
import type {
  GameInfo,
  GamesFilter,
  IOverwolfOverlayApi,
  OverlayWindowOptions,
} from "@overwolf/ow-electron-packages-types";
import { APP_ICON, loadRenderer, PRELOAD, setOwOverlayWindow } from "./windows";

// Unique per app, not per window instance — createOverlayWindow() below
// checks this before creating a second one (e.g. if League re-launches
// without the process ever fully exiting).
const OVERLAY_WINDOW_NAME = "riftcompass-overlay";

// `app.overwolf` only exists at runtime under the real `ow-electron`
// binary — plain `electron` never sets it. @overwolf/ow-electron does ship
// an ambient `Electron.App.overwolf` augmentation (ow-electron-types.d.ts),
// but its "mix" entry (the one meant for a project that already has its own
// `electron` types, like this one) didn't actually merge into this app's
// program when tried, for reasons not worth chasing down given this can't
// be exercised end-to-end yet anyway — an explicit, narrow cast here is
// just as correct and doesn't depend on getting that merge exactly right.
// `overwolf.packages.overlay` itself isn't typed by Overwolf's own
// published types at all regardless (verified against
// node_modules/@overwolf/ow-electron/ow-electron-types.d.ts's
// OverwolfPackageManager — no `overlay` member), so a cast is needed
// either way.
interface OverwolfPackages extends NodeJS.EventEmitter {
  overlay: IOverwolfOverlayApi;
}
function getOverwolfPackages(): OverwolfPackages | null {
  const overwolf = (app as unknown as { overwolf?: { packages?: OverwolfPackages } }).overwolf;
  return overwolf?.packages ?? null;
}

export function isOverwolfRuntime(): boolean {
  return getOverwolfPackages() !== null;
}

// Called once from main.ts's app.whenReady(), only when isOverwolfRuntime()
// is true. Everything here is event-driven from that point on — there's no
// second call needed once League actually launches.
export function initOverwolfOverlay(): void {
  const packages = getOverwolfPackages();
  if (!packages) return;
  packages.on("ready", (_event: unknown, name: string) => {
    if (name !== "overlay") return;
    registerAndListen(packages.overlay);
  });
}

function registerAndListen(overlayApi: IOverwolfOverlayApi): void {
  // Only League — not "all games" like Overwolf's own sample defaults to.
  // This app has exactly one target game; registering more would just mean
  // more injection attempts (and more UAC/elevation prompts, see
  // `game-launched` below) for games this overlay never draws anything on.
  const filter: GamesFilter = { gamesIds: [kGameIds.LeagueofLegends], all: false };
  overlayApi.registerGames(filter);

  overlayApi.on(
    "game-launched",
    (event: { inject: () => void; dismiss: () => void }, gameInfo: GameInfo) => {
      // gameInfo.type distinguishes the real game process from its own
      // launcher (LoL's launcher is a separate, lower classId in Overwolf's
      // gameslist) — only the actual game process can host our overlay.
      if (gameInfo.type !== "Game") {
        event.dismiss();
        return;
      }
      event.inject();
    },
  );

  overlayApi.on("game-injection-error", (gameInfo: GameInfo, error: unknown) => {
    console.error("[overlayEngine] injection error for", gameInfo?.name, error);
  });

  overlayApi.on("game-injected", async (gameInfo: GameInfo) => {
    if (gameInfo.type !== "Game") return;
    try {
      await createInGameOverlayWindow(overlayApi);
    } catch (error) {
      console.error("[overlayEngine] failed to create in-game window", error);
    }
  });

  overlayApi.on("game-exit", () => {
    const win = overlayApi.getAllWindows().find((w) => w.name === OVERLAY_WINDOW_NAME);
    win?.window.hide();
  });
}

async function createInGameOverlayWindow(overlayApi: IOverwolfOverlayApi): Promise<void> {
  const existing = overlayApi.getAllWindows().find((w) => w.name === OVERLAY_WINDOW_NAME);
  if (existing) {
    existing.window.showInactive();
    return;
  }

  // The real game window's own size once injected, not the desktop's
  // primary display (windows.ts's plain-Electron path uses the latter
  // since it has no "game window" concept to size against) — falls back
  // to it anyway if gameWindowInfo isn't available yet.
  const gameSize = overlayApi.getActiveGameInfo()?.gameWindowInfo?.size;
  const { width, height } = gameSize ?? screen.getPrimaryDisplay().size;

  // Same shape as windows.ts's createOverlayWindow() (transparent,
  // frameless, hidden until gameConnection.ts's showOverlay() call) plus
  // the overlay-specific options plain Electron has no equivalent for.
  const options: OverlayWindowOptions = {
    name: OVERLAY_WINDOW_NAME,
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    resizable: false,
    frame: false,
    show: false,
    icon: APP_ICON,
    // Click-through by default, same reasoning as windows.ts's
    // setIgnoreMouseEvents(true, { forward: true }) — the renderer asks to
    // become interactive itself via setOverlayInteractive() only while the
    // cursor is over a real control.
    passthrough: "passThroughAndNotify",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  const overlayWindow = await overlayApi.createWindow(options);
  loadRenderer(overlayWindow.window, "view=overlay");
  setOwOverlayWindow(overlayWindow);
  overlayWindow.window.showInactive();
}
