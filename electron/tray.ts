// The app lives primarily in the tray. Only "Quit" actually ends the
// process — closing the main window just hides it (windows.ts's close
// handler).
//
// Ported 1:1 from RiftCompass-Tauri/src-tauri/src/lib.rs's create_tray.

import { app, Menu, nativeImage, Tray } from "electron";
import * as path from "node:path";
import { markMainWindowQuitting, showMainWindow } from "./windows";

let tray: Tray | null = null;

export function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "..", "build", "icons", "32x32.png"));
  tray = new Tray(icon);
  tray.setToolTip("RiftCompass");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open RiftCompass", click: () => showMainWindow() },
      { type: "separator" },
      {
        label: "Quit RiftCompass",
        click: () => {
          markMainWindowQuitting();
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", () => showMainWindow());
}
