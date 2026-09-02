// Regenerates release/win-unpacked (the build the desktop shortcut runs).
//
// Plain `electron-builder --dir` extracts Electron into release/
// win-unpacked.tmp and then renames it; on this machine that rename
// fails with EPERM every time (something, most likely the antivirus
// scanning the freshly extracted electron.exe, holds the folder for a
// moment). Handing electron-builder an already-unpacked Electron via
// `electronDist` skips the extract-and-rename step entirely: it copies
// the folder instead. The zip is the one @electron/get already cached.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronVersion = require("electron/package.json").version;
const zipName = `electron-v${electronVersion}-win32-x64.zip`;

function findZip(root) {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) {
      const found = findZip(full);
      if (found) return found;
    } else if (entry === zipName) {
      return full;
    }
  }
  return null;
}

const cacheRoot = path.join(process.env.LOCALAPPDATA ?? "", "electron", "Cache");
const zip = findZip(cacheRoot);
if (!zip) {
  console.error(`${zipName} not found under ${cacheRoot}; run \`npx electron-builder --dir --win\` once so @electron/get downloads it.`);
  process.exit(1);
}

const dist = mkdtempSync(path.join(tmpdir(), "riftcompass-electron-dist-"));
execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dist}' -Force`], { stdio: "inherit" });

const release = path.resolve("release");
for (const stale of ["win-unpacked", "win-unpacked.tmp"]) rmSync(path.join(release, stale), { recursive: true, force: true });

try {
  execFileSync("npx", ["electron-builder", "--dir", "--win", `-c.electronDist=${dist}`], { stdio: "inherit", shell: true });
} finally {
  rmSync(dist, { recursive: true, force: true });
}
