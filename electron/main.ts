// Backend bootstrap of the RiftCompass desktop app: app lifecycle
// (single-instance, autostart, tray, global shortcut) and window
// creation. Ported from RiftCompass-Tauri/src-tauri/src/lib.rs's run().

import { app, globalShortcut, session } from "electron";
import * as gameConnection from "./gameConnection";
import * as settings from "./settings";
import { createTray } from "./tray";
import { registerIpcHandlers } from "./ipc";
import { createMainWindow, createOverlayWindow, getOverlayWindow, showMainWindow } from "./windows";

// Set as a real response header on every request (not index.html's old
// <meta> tag) so script-src's 'unsafe-eval' can actually be conditional on
// dev vs. production — a static <meta> tag ships identically in both,
// which is why the index.html version's own comment ("the production
// build doesn't use eval, so this is a floor, not a ceiling") wasn't
// actually true: Vite doesn't strip or rewrite meta tags per-mode, so
// 'unsafe-eval' shipped to the packaged app too (found in a 2026-09-01
// security review). style-src keeps 'unsafe-inline' unconditionally in
// both modes — that one's for real inline style={{}} props this app
// renders throughout, not just Vite's dev-mode <style> injection, so it's
// not a dev-only concern the way script-src's eval requirement is.
function applyContentSecurityPolicy(): void {
  const isDev = !app.isPackaged;
  const csp = [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://ddragon.leagueoflegends.com https://raw.communitydragon.org https://cdn.communitydragon.org https://*.public.blob.vercel-storage.com",
    // localhost:1421 is Vite's own dev server (HMR websocket + module
    // fetches) — only ever reachable in dev, never bundled into what ships.
    `connect-src 'self' https://ddragon.leagueoflegends.com https://raw.communitydragon.org https://riftcompass.com${
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

    // Everything downstream (showOverlay, setOverlayInteractive) already
    // no-ops when the window doesn't exist.
    const ENABLE_OVERLAY = true;
    if (ENABLE_OVERLAY) {
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
    }

    createTray();
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
