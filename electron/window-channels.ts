// Frameless-window chrome channels (WindowControls.tsx / preload.ts) —
// kept separate from src/bridge/commands.ts's CMD/EVT allowlist since this
// is OS window plumbing, not an app/game feature (see RiftCompassWindowApi's
// doc comment in src/riftcompass.d.ts).
//
// Its own dependency-free module, not part of windows.ts: preload.ts is
// bundled into a single file (scripts/bundle-preload.mjs) and runs
// sandboxed, where only a handful of Electron/Node builtins exist — pulling
// windows.ts in would drag BrowserWindow, `path` and the rest of the main
// process into that bundle.
export const WINDOW_CHANNELS = {
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  close: "window:close",
  isMaximized: "window:is-maximized",
  resized: "window:resized",
} as const;
