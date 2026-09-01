// Runs in an isolated context with access to Node/Electron APIs, but the
// renderer only ever sees what's explicitly exposed below via
// contextBridge — same "no raw Node in the page" boundary Tauri's IPC
// gave the old build for free. See src/bridge/index.ts for how
// __electronBridge__ becomes the full window.riftcompass API, and
// windows.ts's WINDOW_CHANNELS for the window-chrome channel names.

import { contextBridge, ipcRenderer } from "electron";
import { CMD, EVT } from "../src/bridge/commands";
import { WINDOW_CHANNELS } from "./windows";

// src/bridge/index.ts only ever calls invoke/on with a name from CMD/EVT,
// but that's a renderer-side convention, not a real boundary — nothing
// stops a compromised renderer (e.g. a future remote-content bug) from
// calling __electronBridge__.invoke with an arbitrary string. Checking
// the channel against this same allowlist here, inside trusted preload
// code, makes CMD/EVT an actual enforcement point instead of just
// documentation (found in a 2026-09-01 security review).
const INVOKABLE_CHANNELS: ReadonlySet<string> = new Set(Object.values(CMD));
const LISTENABLE_CHANNELS: ReadonlySet<string> = new Set(Object.values(EVT));

contextBridge.exposeInMainWorld("__electronBridge__", {
  invoke: (channel: string, args?: Record<string, unknown>) => {
    if (!INVOKABLE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Blocked invoke on unknown channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, args);
  },
  on: (channel: string, cb: (payload: unknown) => void) => {
    if (!LISTENABLE_CHANNELS.has(channel)) {
      throw new Error(`Blocked listener on unknown channel: ${channel}`);
    }
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

contextBridge.exposeInMainWorld("riftcompassWindow", {
  minimize: () => ipcRenderer.invoke(WINDOW_CHANNELS.minimize),
  toggleMaximize: () => ipcRenderer.invoke(WINDOW_CHANNELS.toggleMaximize),
  close: () => ipcRenderer.invoke(WINDOW_CHANNELS.close),
  isMaximized: () => ipcRenderer.invoke(WINDOW_CHANNELS.isMaximized),
  onResized: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(WINDOW_CHANNELS.resized, listener);
    return () => ipcRenderer.removeListener(WINDOW_CHANNELS.resized, listener);
  },
});
