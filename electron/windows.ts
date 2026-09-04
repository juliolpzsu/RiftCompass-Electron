// Window creation and lifecycle: the frameless main window and the
// transparent in-game overlay.

import { BrowserWindow, screen } from "electron";
import * as path from "node:path";
import type { OverlayBrowserWindow } from "@overwolf/ow-electron-packages-types";

let mainWindow: BrowserWindow | null = null;
// Two mutually-exclusive backing stores for "the overlay window", one per
// runtime: `overlayWindow` when running under plain Electron (today's only
// path — a normal top-level BrowserWindow, invisible during real exclusive
// fullscreen), `owOverlayWindow` when running under the `ow-electron` binary
// with Riot/Overwolf's access granted (see overlayEngine.ts) — a window
// actually injected into League's own process, visible in exclusive
// fullscreen too. Exactly one is ever non-null at a time; every function
// below picks whichever is set so every existing caller (main.ts,
// gameConnection.ts, ipc.ts, overlayTopmost.ts) keeps working unmodified
// regardless of which runtime created the window.
let overlayWindow: BrowserWindow | null = null;
let owOverlayWindow: OverlayBrowserWindow | null = null;

// Re-exported so ipc.ts keeps one import for everything window-related;
// the definition lives in its own module for the preload bundle's sake.
import { WINDOW_CHANNELS } from "./window-channels";
export { WINDOW_CHANNELS };

// Sibling of tsconfig.electron.json's outDir — see package.json's "main".
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
// __dirname here is dist-electron/electron (tsconfig.electron.json's
// rootDir is the project root, to let this share src/bridge/commands.ts's
// CMD/EVT allowlist with the renderer) — dist/ sits two levels up.
const DIST_INDEX = path.join(__dirname, "..", "..", "dist", "index.html");
// Exported: overlayEngine.ts's ow-electron-injected window needs the exact
// same preload bridge as every other window here.
export const PRELOAD = path.join(__dirname, "preload.js");
// Same icon file electron-builder.yml points at for the packaged
// installer — set here too so the dev-run window/taskbar icon isn't
// Electron's own default.
export const APP_ICON = path.join(__dirname, "..", "..", "build", "icons", "icon.ico");

function isOwnRendererUrl(url: string): boolean {
  if (RENDERER_URL) return url.startsWith(RENDERER_URL);
  return url.startsWith("file:");
}

// Both windows carry the privileged preload bridge, so they must only ever
// display this app's own renderer: any navigation elsewhere (a stray link,
// a dropped file, a future remote-content bug) and any window.open is
// refused. External links go through ipc.ts's shell_open_external, which
// hands an https://riftcompass.com URL to the OS browser instead.
function lockToOwnRenderer(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isOwnRendererUrl(url)) event.preventDefault();
  });
}

// Exported: overlayEngine.ts's ow-electron-injected window loads the exact
// same renderer bundle, just via a different window-creation API.
export function loadRenderer(win: BrowserWindow, query?: string): void {
  lockToOwnRenderer(win);
  if (RENDERER_URL) {
    win.loadURL(query ? `${RENDERER_URL}/?${query}` : RENDERER_URL);
  } else {
    win.loadFile(DIST_INDEX, query ? { search: query } : undefined);
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// Unified accessor regardless of which runtime owns the window — both
// Overwolf's own sample app and this app's existing callers (main.ts's
// Ctrl+Alt+R escape hatch, overlayTopmost.ts) operate on the plain
// BrowserWindow either way (OverlayBrowserWindow.window is a real
// BrowserWindow, per @overwolf/ow-electron-packages-types).
export function getOverlayWindow(): BrowserWindow | null {
  return owOverlayWindow?.window ?? overlayWindow;
}

// True only when the ow-electron path (overlayEngine.ts) actually created
// the window — overlayTopmost.ts uses this to skip its periodic
// setAlwaysOnTop() re-assert there, since z-order for an injected overlay
// is Overwolf's own overlayOptions.zOrder, not Electron's window-manager
// concept of "always on top".
export function isOwOverlayActive(): boolean {
  return owOverlayWindow !== null;
}

// Called by overlayEngine.ts once its own `createWindow()` call resolves —
// hands the result to the same module-level slot every other function here
// already reads from, so nothing else needs to know which path created it.
export function setOwOverlayWindow(win: OverlayBrowserWindow | null): void {
  owOverlayWindow = win;
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    title: "RiftCompass",
    width: 1440,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    show: false,
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer process runs sandboxed (Chromium's OS-level sandbox,
      // no Node in the process at all). Only possible because preload.ts
      // is bundled into one self-contained file (scripts/bundle-preload.mjs)
      // — a sandboxed preload can't `require` a sibling module, which is
      // what kept this at `false` before. contextIsolation above remains
      // the boundary between page content and the preload's privileges.
      sandbox: true,
    },
  });
  mainWindow.maximize();
  loadRenderer(mainWindow);

  // The app lives primarily in the tray — closing the window only hides
  // it. Only the tray's "Quit" (main.ts) actually ends the process.
  mainWindow.on("close", (e) => {
    if ((mainWindow as unknown as { __quitting?: boolean }).__quitting) return;
    e.preventDefault();
    mainWindow?.hide();
  });

  // WindowControls.tsx's maximize/restore icon needs to reflect real OS
  // state (e.g. after a double-click on the title bar, or Win+Up), not
  // just its own button clicks.
  const notifyResized = () => mainWindow?.webContents.send(WINDOW_CHANNELS.resized);
  mainWindow.on("resize", notifyResized);
  mainWindow.on("maximize", notifyResized);
  mainWindow.on("unmaximize", notifyResized);

  return mainWindow;
}

// The single path every "show the window" trigger goes through (tray
// "Open", tray icon click, a second launch via the single-instance lock,
// and gameConnection.ts opening it when League connects).
export function showMainWindow(): void {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

// Marks the window as genuinely quitting so its own "close" handler
// (above) lets the close through instead of hiding it — set right before
// app.quit()/BrowserWindow.destroy() in main.ts.
export function markMainWindowQuitting(): void {
  if (mainWindow) (mainWindow as unknown as { __quitting?: boolean }).__quitting = true;
}

// The overlay HUD: a transparent, always-on-top, click-through window
// covering the full primary display, hidden until the gameflow phase
// gives it something to show. Several independent panels (lane gold
// table, objective timers, the recommended-skill highlight, the enemy
// spell tracker) are each absolutely positioned within this one window.
// Click-through by default via setIgnoreMouseEvents — the renderer
// explicitly asks to become interactive only while the cursor is over a
// real control (see ipc.ts's overlay_set_interactive).
//
// Only the fallback path: under the real `ow-electron` binary with
// Riot/Overwolf's access granted, overlayEngine.ts creates the actual
// in-game window instead (via the overlay package's own createWindow(),
// injected into League's process so it survives real exclusive
// fullscreen — a normal top-level window like this one never does,
// see the root CLAUDE.md's "Por qué Electron" for why). main.ts only
// calls this one when overlayEngine.isOverwolfRuntime() is false.
export function createOverlayWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().size;
  overlayWindow = new BrowserWindow({
    title: "RiftCompass Overlay",
    width,
    height,
    x: 0,
    y: 0,
    resizable: false,
    movable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // see createMainWindow's identical option
    },
  });
  loadRenderer(overlayWindow, "view=overlay");
  // `forward: true` keeps CSS :hover / onMouseEnter working while
  // click-through — same behavior the OverlayView.tsx comments already
  // document as relied upon (a panel's onMouseEnter turns off click-through
  // just before a real click needs to land).
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  return overlayWindow;
}

// "Click-through" isn't the same concept in both runtimes: plain Electron
// has no OS-level notion of it (setIgnoreMouseEvents is this app's own
// approximation), while the overlay package treats it as a first-class
// window option (`overlayOptions.passthrough`, mutated live — see
// Overwolf's own sample doing the exact same `.overlayOptions.passthrough =`
// assignment in its hotkey handlers). "passThroughAndNotify" (not plain
// "passThrough") to keep the same forward-hover behavior
// setIgnoreMouseEvents's `{ forward: true }` already relied on.
export function setOverlayInteractive(interactive: boolean): void {
  if (owOverlayWindow) {
    owOverlayWindow.overlayOptions.passthrough = interactive ? "noPassThrough" : "passThroughAndNotify";
    return;
  }
  if (!overlayWindow) return;
  if (interactive) {
    overlayWindow.setIgnoreMouseEvents(false);
  } else {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }
}

// showInactive(), not show(): the overlay must never steal focus/keyboard
// input from the game, and Electron has no creation-time flag for that, so
// every show has to opt out explicitly. Same call either way — see
// getOverlayWindow()'s comment on why OverlayBrowserWindow.window already
// behaves like a normal BrowserWindow for this.
export function showOverlay(show: boolean): void {
  const win = getOverlayWindow();
  if (!win) return;
  if (show) win.showInactive();
  else win.hide();
}

// Both the main window and the overlay load the same renderer bundle and
// subscribe to the same bridge events (App.tsx picks which view to render
// off a `?view=` query param), so gameConnection.ts's events go to every
// window, not a single webContents.send.
export function broadcast(channel: string, payload?: unknown): void {
  for (const win of [mainWindow, getOverlayWindow()]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
