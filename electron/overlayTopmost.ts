// Keeps the overlay window actually on top of the game, not just flagged
// as such. A one-time `alwaysOnTop: true` only puts a window in Windows'
// "topmost band" — it does NOT guarantee it stays visually above every
// other topmost window forever. Within that band, whichever window last
// re-asserted itself via SetForegroundWindow/SetWindowPos wins the
// z-order, and a game engine does exactly that on every focus change.
// The standard fix (same one any overlay/utility app uses) is to
// periodically re-assert topmost instead of trusting the one-time flag.
//
// Ported 1:1 from RiftCompass-Tauri/src-tauri/src/overlay_topmost.rs.

import { getOverlayWindow } from "./windows";

const REASSERT_INTERVAL_MS = 1500;

let handle: ReturnType<typeof setInterval> | null = null;

export function start(): void {
  if (handle) return;
  handle = setInterval(() => {
    getOverlayWindow()?.setAlwaysOnTop(true);
  }, REASSERT_INTERVAL_MS);
}

export function stop(): void {
  if (handle) clearInterval(handle);
  handle = null;
}
