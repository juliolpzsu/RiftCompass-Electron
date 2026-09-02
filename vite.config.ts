import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The packaged app loads dist/index.html via a plain file:// URL (see
  // electron/windows.ts's loadFile) — Vite's default "/" base produces
  // absolute asset paths that don't resolve under file://, so this must
  // stay relative.
  base: "./",
  clearScreen: false,
  // Fixed port: package.json's dev:electron waits on it and electron/
  // main.ts's dev CSP allowlists it.
  server: {
    port: 1421,
    strictPort: true,
  },
});
