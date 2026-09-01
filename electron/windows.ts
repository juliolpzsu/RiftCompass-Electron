// Window creation and lifecycle — ported from
// RiftCompass-Tauri/src-tauri/src/lib.rs's create_overlay_window,
// show_main_window and the window-spec parts of tauri.conf.json.

import { BrowserWindow, screen } from "electron";
import * as path from "node:path";

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

// Frameless-window chrome channels (WindowControls.tsx / preload.ts) —
// kept separate from src/bridge/commands.ts's CMD/EVT allowlist since
// this is OS window plumbing, not an app/game feature (see
// RiftCompassWindowApi's doc comment in src/riftcompass.d.ts).
export const WINDOW_CHANNELS = {
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  close: "window:close",
  isMaximized: "window:is-maximized",
  resized: "window:resized",
} as const;

// Sibling of tsconfig.electron.json's outDir — see package.json's "main".
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
// __dirname here is dist-electron/electron (tsconfig.electron.json's
// rootDir is the project root, to let this share src/bridge/commands.ts's
// CMD/EVT allowlist with the renderer) — dist/ sits two levels up.
const DIST_INDEX = path.join(__dirname, "..", "..", "dist", "index.html");
const PRELOAD = path.join(__dirname, "preload.js");
// Same icon file electron-builder.yml points at for the packaged
// installer — set here too so the dev-run window/taskbar icon isn't
// Electron's own default (Julio, 2026-08-31: "la app no tiene el icono").
const APP_ICON = path.join(__dirname, "..", "..", "build", "icons", "icon.ico");

function loadRenderer(win: BrowserWindow, query?: string): void {
  if (RENDERER_URL) {
    win.loadURL(query ? `${RENDERER_URL}/?${query}` : RENDERER_URL);
  } else {
    win.loadFile(DIST_INDEX, query ? { search: query } : undefined);
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
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
      // Electron 20+ sandboxes preload scripts by default, which blocks
      // even a same-directory `require("./windows")` for the compiled
      // WINDOW_CHANNELS constants — sandboxed preload only allows a
      // handful of Electron/Node builtins, not arbitrary local modules.
      // contextIsolation (above) is the boundary that actually matters:
      // it keeps the *page* content from ever touching Node, regardless
      // of this setting — preload.ts is our own trusted code.
      sandbox: false,
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
  // just its own button clicks — same "resized" signal Tauri's
  // onResized gave it.
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
      sandbox: false, // see createMainWindow's identical option for why
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

export function setOverlayInteractive(interactive: boolean): void {
  if (!overlayWindow) return;
  if (interactive) {
    overlayWindow.setIgnoreMouseEvents(false);
  } else {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }
}

// showInactive(), not show(): the overlay must never steal focus/keyboard
// input from the game (Tauri's .focused(false) at creation covered the
// first show; Electron has no such creation-time flag, so every
// subsequent show has to opt out the same way).
export function showOverlay(show: boolean): void {
  if (!overlayWindow) return;
  if (show) overlayWindow.showInactive();
  else overlayWindow.hide();
}

// Tauri's `app.emit` broadcasts an event to every window's webview at
// once — both the main window and the overlay load the same renderer
// bundle and both subscribe to the same bridge events (App.tsx picks
// which view to render off a `?view=` query param, not off a different
// bundle), so gameConnection.ts's events need the same broadcast, not a
// single webContents.send.
export function broadcast(channel: string, payload?: unknown): void {
  for (const win of [mainWindow, overlayWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
