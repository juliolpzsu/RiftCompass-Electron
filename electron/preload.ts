// Runs in an isolated context with access to Node/Electron APIs, but the
// renderer only ever sees what's explicitly exposed below via
// contextBridge — same "no raw Node in the page" boundary Tauri's IPC
// gave the old build for free. See src/bridge/index.ts for how
// __electronBridge__ becomes the full window.riftcompass API, and
// windows.ts's WINDOW_CHANNELS for the window-chrome channel names.

import { contextBridge, ipcRenderer } from "electron";
import { WINDOW_CHANNELS } from "./windows";

contextBridge.exposeInMainWorld("__electronBridge__", {
  invoke: (channel: string, args?: Record<string, unknown>) => ipcRenderer.invoke(channel, args),
  on: (channel: string, cb: (payload: unknown) => void) => {
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
