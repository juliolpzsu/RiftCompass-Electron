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
  // A different port than RiftCompass-Tauri's 1420 (kept until the
  // Electron rewrite is verified) — both dev servers may run side by
  // side during the migration.
  server: {
    port: 1421,
    strictPort: true,
  },
});
