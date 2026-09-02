// Silent background auto-update: installs already on a user's machine pick
// up new releases on their own, no manual redownload from the web. Reads
// where to check from the `publish` block in electron-builder.yml (GitHub
// Releases) via app-update.yml, which electron-builder only generates for
// packaged builds — never runs in dev.

import { app } from "electron";
import { autoUpdater } from "electron-updater";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export function startAutoUpdater(): void {
  if (!app.isPackaged) return;

  // Downloads happen automatically once a new version is found, and get
  // applied on the next app quit — no restart prompt to click through.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => console.error("auto-updater error:", err));
  autoUpdater.on("update-available", (info) => console.log("update available:", info.version));
  autoUpdater.on("update-downloaded", (info) => console.log("update downloaded, will install on quit:", info.version));

  autoUpdater.checkForUpdates().catch((err) => console.error("auto-updater check failed:", err));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => console.error("auto-updater check failed:", err));
  }, CHECK_INTERVAL_MS);
}
