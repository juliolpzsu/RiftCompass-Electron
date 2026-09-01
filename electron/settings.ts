// App settings. Auto-launch reads straight from the OS
// (app.getLoginItemSettings, registry-backed on Windows) so it can never
// drift from what's actually registered; overlay module toggles and the
// UI locale persist to a small settings.json in the app's userData dir.
//
// Ported 1:1 from RiftCompass-Tauri/src-tauri/src/settings.rs — same
// tolerant field-by-field JSON parsing (unknown/missing fields fall back
// individually instead of discarding the whole file), same defaults.

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export const SUPPORTED_LOCALES = ["en", "es", "fr", "de"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export interface OverlayModules {
  csPerMinute: boolean;
  goldDiff: boolean;
  skillOrder: boolean;
  autoBuild: boolean;
}

const DEFAULT_OVERLAY_MODULES: OverlayModules = {
  csPerMinute: true,
  goldDiff: true,
  skillOrder: true,
  autoBuild: true,
};

export interface OverlayModulesPatch {
  csPerMinute?: boolean;
  goldDiff?: boolean;
  skillOrder?: boolean;
  autoBuild?: boolean;
}

export type FlashSide = "left" | "right";

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface AbilityBarCalibration {
  q: ScreenPoint;
  w: ScreenPoint;
  e: ScreenPoint;
}

export type OverlayPanelKey = "gold" | "objectives" | "csPerMin" | "enemySpells";

export interface OverlayPanelPositions {
  gold: ScreenPoint | null;
  objectives: ScreenPoint | null;
  csPerMin: ScreenPoint | null;
  enemySpells: ScreenPoint | null;
}

const DEFAULT_PANEL_POSITIONS: OverlayPanelPositions = {
  gold: null,
  objectives: null,
  csPerMin: null,
  enemySpells: null,
};

interface PersistedSettings {
  overlayModules: OverlayModules;
  locale: string;
  // Whether auto-launch has ever been decided (by the first-run default or
  // by the user's own toggle in Settings). The OS registration stays the
  // single source of truth for whether auto-launch IS on — this marker
  // only stops the first-run default from overriding a user who
  // explicitly turned it off. Not exposed in AppSettings.
  autoLaunchConfigured: boolean;
  flashSide: FlashSide;
  abilityBarCalibration: AbilityBarCalibration | null;
  overlayPanelPositions: OverlayPanelPositions;
}

export interface AppSettings {
  autoLaunch: boolean;
  overlayModules: OverlayModules;
  locale: string;
  flashSide: FlashSide;
  abilityBarCalibration: AbilityBarCalibration | null;
  overlayPanelPositions: OverlayPanelPositions;
}

// First launch, before settings.json exists: pick the closest supported
// locale to the OS's own language instead of always defaulting to English.
function systemDefaultLocale(): string {
  const primary = app.getLocale().split(/[-_]/)[0]?.toLowerCase() ?? "";
  return isLocale(primary) ? primary : "en";
}

function defaultPersisted(): PersistedSettings {
  return {
    overlayModules: DEFAULT_OVERLAY_MODULES,
    locale: systemDefaultLocale(),
    autoLaunchConfigured: false,
    flashSide: "left",
    abilityBarCalibration: null,
    overlayPanelPositions: DEFAULT_PANEL_POSITIONS,
  };
}

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function parseScreenPoint(v: unknown): ScreenPoint | null {
  if (typeof v !== "object" || v === null) return null;
  const { x, y } = v as Record<string, unknown>;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function readPersisted(): PersistedSettings {
  const fallback = defaultPersisted();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsFilePath(), "utf-8"));
  } catch {
    return fallback;
  }

  // Tolerant merge: unknown or missing fields fall back individually
  // instead of discarding the whole file.
  const rawModules = parsed.overlayModules as Record<string, unknown> | undefined;
  const overlayModules: OverlayModules = {
    csPerMinute: typeof rawModules?.csPerMinute === "boolean" ? rawModules.csPerMinute : DEFAULT_OVERLAY_MODULES.csPerMinute,
    goldDiff: typeof rawModules?.goldDiff === "boolean" ? rawModules.goldDiff : DEFAULT_OVERLAY_MODULES.goldDiff,
    skillOrder: typeof rawModules?.skillOrder === "boolean" ? rawModules.skillOrder : DEFAULT_OVERLAY_MODULES.skillOrder,
    autoBuild: typeof rawModules?.autoBuild === "boolean" ? rawModules.autoBuild : DEFAULT_OVERLAY_MODULES.autoBuild,
  };
  const locale = typeof parsed.locale === "string" && isLocale(parsed.locale) ? parsed.locale : fallback.locale;
  const autoLaunchConfigured = typeof parsed.autoLaunchConfigured === "boolean" ? parsed.autoLaunchConfigured : false;
  const flashSide: FlashSide = parsed.flashSide === "left" || parsed.flashSide === "right" ? parsed.flashSide : fallback.flashSide;
  const rawCalibration = parsed.abilityBarCalibration as Record<string, unknown> | null | undefined;
  let abilityBarCalibration: AbilityBarCalibration | null = null;
  if (rawCalibration) {
    const q = parseScreenPoint(rawCalibration.q);
    const w = parseScreenPoint(rawCalibration.w);
    const e = parseScreenPoint(rawCalibration.e);
    if (q && w && e) abilityBarCalibration = { q, w, e };
  }
  const rawPositions = parsed.overlayPanelPositions as Record<string, unknown> | undefined;
  const overlayPanelPositions: OverlayPanelPositions = {
    gold: parseScreenPoint(rawPositions?.gold),
    objectives: parseScreenPoint(rawPositions?.objectives),
    csPerMin: parseScreenPoint(rawPositions?.csPerMin),
    enemySpells: parseScreenPoint(rawPositions?.enemySpells),
  };

  return { overlayModules, locale, autoLaunchConfigured, flashSide, abilityBarCalibration, overlayPanelPositions };
}

function writePersisted(next: PersistedSettings): void {
  // Best-effort, like the original — a failed write just means the change
  // doesn't survive restart.
  try {
    fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true });
    fs.writeFileSync(settingsFilePath(), JSON.stringify(next));
  } catch {
    // ignore
  }
}

function autoLaunchEnabled(): boolean {
  return app.getLoginItemSettings({ args: ["--background"] }).openAtLogin;
}

function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ["--background"] : [] });
}

function currentSettings(): AppSettings {
  const persisted = readPersisted();
  return {
    autoLaunch: autoLaunchEnabled(),
    overlayModules: persisted.overlayModules,
    locale: persisted.locale,
    flashSide: persisted.flashSide,
    abilityBarCalibration: persisted.abilityBarCalibration,
    overlayPanelPositions: persisted.overlayPanelPositions,
  };
}

// First launch only: register auto-launch by default (the default this
// kind of companion app ships with). Once the marker is set — here or by
// the user's own toggle — this never touches the registration again, so
// turning it off in Settings sticks across restarts.
export function ensureDefaultAutoLaunch(): void {
  const persisted = readPersisted();
  if (persisted.autoLaunchConfigured) return;
  setAutoLaunch(true);
  writePersisted({ ...persisted, autoLaunchConfigured: true });
}

// For apply_recommended_build — which slot a recommended Flash lands in
// isn't exposed as its own command, just read alongside applying.
export function currentFlashSide(): FlashSide {
  return readPersisted().flashSide;
}

export function settingsGet(): AppSettings {
  return currentSettings();
}

export function settingsSetAutoLaunch(enabled: boolean): AppSettings {
  setAutoLaunch(enabled);
  const persisted = readPersisted();
  if (!persisted.autoLaunchConfigured) {
    writePersisted({ ...persisted, autoLaunchConfigured: true });
  }
  return currentSettings();
}

export function settingsSetOverlayModules(modules: OverlayModulesPatch): AppSettings {
  const persisted = readPersisted();
  const next = { ...persisted, overlayModules: { ...persisted.overlayModules, ...modules } };
  writePersisted(next);
  return currentSettings();
}

export function settingsSetLocale(locale: string): AppSettings {
  if (isLocale(locale)) {
    writePersisted({ ...readPersisted(), locale });
  }
  return currentSettings();
}

export function settingsSetFlashSide(side: string): AppSettings {
  if (side === "left" || side === "right") {
    writePersisted({ ...readPersisted(), flashSide: side });
  }
  return currentSettings();
}

export function settingsSetAbilityBarCalibration(calibration: AbilityBarCalibration): AppSettings {
  writePersisted({ ...readPersisted(), abilityBarCalibration: calibration });
  return currentSettings();
}

export function settingsSetOverlayPanelPosition(panel: string, position: ScreenPoint): AppSettings {
  const persisted = readPersisted();
  const overlayPanelPositions = { ...persisted.overlayPanelPositions };
  if (panel === "gold" || panel === "objectives" || panel === "csPerMin" || panel === "enemySpells") {
    overlayPanelPositions[panel] = position;
  }
  writePersisted({ ...persisted, overlayPanelPositions });
  return currentSettings();
}
