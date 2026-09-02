// Backend bootstrap of the RiftCompass desktop app: app lifecycle
// (single-instance, autostart, tray, global shortcut) and window
// creation.

import { app, globalShortcut, session } from "electron";
import * as gameConnection from "./gameConnection";
import * as settings from "./settings";
import { createTray } from "./tray";
import { registerIpcHandlers } from "./ipc";
import { initTelemetry } from "./telemetry";
import { startAutoUpdater } from "./updater";
import { createMainWindow, createOverlayWindow, getOverlayWindow, showMainWindow } from "./windows";

// Before anything else can throw.
initTelemetry();

// Set as a real response header on every request (not a <meta> tag in
// index.html) so script-src's 'unsafe-eval' and 'unsafe-inline' can be
// dev-only: a static <meta> tag ships identically to dev and production.
// Both are needed by Vite in dev (HMR client uses eval; the React plugin
// injects an inline Fast Refresh preamble, without which the renderer
// throws "can't detect preamble" and never mounts) and by nothing in the
// packaged build. style-src keeps 'unsafe-inline' in both modes for the
// real inline style={{}} props this app renders throughout.
function applyContentSecurityPolicy(): void {
  const isDev = !app.isPackaged;
  const csp = [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://ddragon.leagueoflegends.com https://raw.communitydragon.org https://cdn.communitydragon.org https://*.public.blob.vercel-storage.com",
    // localhost:1421 is Vite's own dev server (HMR websocket + module
    // fetches) — only ever reachable in dev, never bundled into what ships.
    // *.sentry.io: renderer-side error reporting (telemetry.ts) — the DSN
    // host varies by org/region, so this stays a wildcard on the one
    // vendor domain rather than a single hardcoded ingest subdomain.
    `connect-src 'self' https://ddragon.leagueoflegends.com https://raw.communitydragon.org https://riftcompass.com https://*.sentry.io${
      isDev ? " ws://localhost:1421 http://localhost:1421" : ""
    }`,
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

// A second launch should focus the existing instance, not spawn a
// duplicate LCU poller/websocket. Must run before anything else creates
// windows or starts polling.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app.whenReady().then(() => {
    applyContentSecurityPolicy();
    registerIpcHandlers();
    createMainWindow();
    createOverlayWindow();

    // Best-effort, never fatal: registration fails whenever another app
    // already owns Ctrl+Alt+R, and losing the escape-hatch hotkey must
    // not cost the rest of the app.
    const registered = globalShortcut.register("Control+Alt+R", () => {
      const overlay = getOverlayWindow();
      if (!overlay) return;
      if (overlay.isVisible()) overlay.hide();
      else overlay.showInactive();
    });
    if (!registered) {
      console.error("global shortcut ctrl+alt+r not registered");
    }

    createTray();
    startAutoUpdater();
    // Auto-launch on by default from the first run (Settings can turn it
    // off; that choice then sticks).
    settings.ensureDefaultAutoLaunch();

    // The window ships hidden: launched at boot (--background) it stays
    // in the tray until League opens (gameConnection shows it on
    // connect, iTero-style); launched by hand it shows immediately.
    if (!process.argv.includes("--background")) {
      showMainWindow();
    }
    void gameConnection.run();
  });

  app.on("window-all-closed", () => {
    // The main window only ever hides (windows.ts), never actually
    // closes — this handler exists for platform completeness but should
    // never fire in normal operation. Do NOT quit here: this is a tray
    // app, no windows open is the expected steady state on Windows.
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
