// Tab-held detection for the overlay's gold-diff/objectives modules —
// Porofessor/iTero only show per-player gold while the native scoreboard
// (held Tab) is up, not as a permanent HUD line. Started/stopped by
// gameConnection.ts alongside the Live Client Data poll — only runs while
// a match is actually in progress.
//
// GetAsyncKeyState reads global keyboard state, the same mechanism any
// global hotkey already relies on — it never touches the League process's
// memory or window, so it isn't something Vanguard flags. koffi is a
// prebuilt FFI library (no native compilation on the user's machine)
// calling the Win32 GetAsyncKeyState directly.

import koffi from "koffi";
import { EVT } from "../src/bridge/commands";
import { broadcast } from "./windows";

const VK_TAB = 0x09;
const POLL_MS = 50;

const user32 = koffi.load("user32.dll");
const GetAsyncKeyState = user32.func("short __stdcall GetAsyncKeyState(int vKey)");

// The high-order bit of GetAsyncKeyState's return means "currently down" —
// koffi returns a signed 16-bit value for "short", so that bit set makes
// it negative, same check as the Rust side.
function isTabDown(): boolean {
  return (GetAsyncKeyState(VK_TAB) as number) < 0;
}

let handle: ReturnType<typeof setInterval> | null = null;

// Emits only on a real state change, not every poll tick — the overlay
// just needs to know when to flip a boolean, not a 20Hz event stream.
export function start(): void {
  if (handle) return;
  let held = false;
  handle = setInterval(() => {
    const now = isTabDown();
    if (now !== held) {
      held = now;
      broadcast(EVT.OverlayTabHeld, held);
    }
  }, POLL_MS);
}

export function stop(): void {
  if (handle) clearInterval(handle);
  handle = null;
  broadcast(EVT.OverlayTabHeld, false);
}
