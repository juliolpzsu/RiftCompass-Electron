// Backend bootstrap of the RiftCompass desktop app: app lifecycle
// (single-instance, autostart, tray, global shortcut) and window
// creation. Ported from RiftCompass-Tauri/src-tauri/src/lib.rs's run().

import { app, globalShortcut } from "electron";
import * as gameConnection from "./gameConnection";
import * as settings from "./settings";
import { createTray } from "./tray";
import { registerIpcHandlers } from "./ipc";
import { createMainWindow, createOverlayWindow, getOverlayWindow, showMainWindow } from "./windows";

// A second launch should focus the existing instance, not spawn a
// duplicate LCU poller/websocket. Must run before anything else creates
// windows or starts polling.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app.whenReady().then(() => {
    registerIpcHandlers();
    createMainWindow();

    // Reactivated 2026-08-27 for the overlay's real-game review round
    // (Julio testing feature-by-feature in custom games). Everything
    // downstream (showOverlay, setOverlayInteractive) already no-ops when
    // the window doesn't exist.
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
