// Bundles electron/preload.ts into one self-contained file, overwriting
// tsc's per-file output for it in dist-electron. A sandboxed preload
// (Electron 20+ default, and what windows.ts now asks for explicitly) can
// only `require` a few builtins, never a sibling module, so the CMD/EVT
// allowlist from src/bridge/commands.ts and the window channels must be
// inlined rather than required at runtime. `electron` itself stays
// external: it is the one module the sandbox does provide.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "electron", "preload.ts")],
  outfile: path.join(root, "dist-electron", "electron", "preload.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  logLevel: "info",
});
