// Registers every ipcMain.handle for the CMD.* allowlist in
// src/bridge/commands.ts — the renderer-facing counterpart of
// RiftCompass-Tauri/src-tauri/src/lib.rs's #[tauri::command] surface plus
// its invoke_handler list.

import { ipcMain, shell } from "electron";
import { CMD, EVT } from "../src/bridge/commands";
import * as account from "./account";
import { applyRunePage, applySummonerSpells, fetchLastBuild } from "./buildImport";
import { connectionSnapshot, currentCreds, getLocalPuuid } from "./gameConnection";
import { lcuRequest } from "./lcu";
import * as settings from "./settings";
import { broadcast, getMainWindow, setOverlayInteractive, showOverlay, WINDOW_CHANNELS } from "./windows";

const FLASH_ID = 4;

export function registerIpcHandlers(): void {
  ipcMain.handle(CMD.LcuGetState, () => connectionSnapshot());
  ipcMain.handle(CMD.LcuRequest, (_e, { method, path, body }: { method: string; path: string; body?: unknown }) =>
    lcuRequest(currentCreds(), method, path, body),
  );

  ipcMain.handle(CMD.OverlaySetInteractive, (_e, { interactive }: { interactive: boolean }) => {
    setOverlayInteractive(interactive);
  });

  // Ability-bar calibration (Settings' "Calibrar" button): the overlay is
  // force-shown and made fully interactive (not click-through) so the
  // user can click their real Q/W/E icons, wherever they actually are on
  // screen — there's no official API exposing that position otherwise.
  ipcMain.handle(CMD.OverlayEnterCalibration, () => {
    showOverlay(true);
    setOverlayInteractive(true);
    broadcast(EVT.OverlayCalibrationStart);
  });
  // Restores click-through and hides the overlay rather than recomputing
  // "should it be visible right now" here — if a real game is still in
  // progress when this runs, the next phase transition (gameConnection.ts,
  // already continuous) shows it again; calibration is a one-off Settings
  // action done before queuing up, not mid-match.
  ipcMain.handle(CMD.OverlayExitCalibration, () => {
    setOverlayInteractive(false);
    showOverlay(false);
  });

  ipcMain.handle(CMD.BuildImport, async (_e, { championId }: { championId: number }) => {
    const creds = currentCreds();
    const puuid = await getLocalPuuid();
    const build = await fetchLastBuild(creds, puuid, championId);
    if (!build) return { ok: false, reason: "no-recent-game" };
    await applyRunePage(creds, build.perkIds, build.primaryStyleId, build.subStyleId);
    await applySummonerSpells(creds, build.spell1Id, build.spell2Id);
    return { ok: true, items: build.items };
  });

  // Applies a crawler-recommended build (runes + summoner spells only —
  // items have no LCU purchase endpoint, so they only ever show as a
  // reference in the overlay). Flash's slot follows the user's own
  // flashSide setting rather than whatever order the aggregated data
  // happened to store.
  ipcMain.handle(
    CMD.ApplyRecommendedBuild,
    async (
      _e,
      {
        perkIds,
        primaryStyleId,
        subStyleId,
        spellLow,
        spellHigh,
      }: { perkIds: number[]; primaryStyleId: number; subStyleId: number; spellLow: number; spellHigh: number },
    ) => {
      const creds = currentCreds();
      await applyRunePage(creds, perkIds, primaryStyleId, subStyleId);

      let spell1 = spellLow;
      let spell2 = spellHigh;
      if (spellLow === FLASH_ID || spellHigh === FLASH_ID) {
        const other = spellLow === FLASH_ID ? spellHigh : spellLow;
        const side = settings.currentFlashSide();
        [spell1, spell2] = side === "left" ? [FLASH_ID, other] : [other, FLASH_ID];
      }
      await applySummonerSpells(creds, spell1, spell2);
      return { ok: true };
    },
  );

  ipcMain.handle(CMD.SettingsGet, () => settings.settingsGet());
  ipcMain.handle(CMD.SettingsSetAutoLaunch, (_e, { enabled }: { enabled: boolean }) => settings.settingsSetAutoLaunch(enabled));
  ipcMain.handle(CMD.SettingsSetOverlayModules, (_e, { modules }: { modules: settings.OverlayModulesPatch }) =>
    settings.settingsSetOverlayModules(modules),
  );
  ipcMain.handle(CMD.SettingsSetLocale, (_e, { locale }: { locale: string }) => settings.settingsSetLocale(locale));
  ipcMain.handle(CMD.SettingsSetFlashSide, (_e, { side }: { side: string }) => settings.settingsSetFlashSide(side));
  ipcMain.handle(CMD.SettingsSetAbilityBarCalibration, (_e, { calibration }: { calibration: settings.AbilityBarCalibration }) =>
    settings.settingsSetAbilityBarCalibration(calibration),
  );
  ipcMain.handle(
    CMD.SettingsSetOverlayPanelPosition,
    (_e, { panel, position }: { panel: string; position: settings.ScreenPoint }) =>
      settings.settingsSetOverlayPanelPosition(panel, position),
  );

  ipcMain.handle(CMD.AccountLogin, (_e, { email, password }: { email: string; password: string }) => account.accountLogin(email, password));
  ipcMain.handle(CMD.AccountLogout, () => account.accountLogout());
  ipcMain.handle(CMD.AccountGetSession, () => account.accountGetSession());
  ipcMain.handle(CMD.AccountGetSavedProfiles, () => account.accountGetSavedProfiles());
  ipcMain.handle(
    CMD.AccountToggleSavedProfile,
    (_e, { platform, gameName, tagLine, puuid }: { platform: string; gameName: string; tagLine: string; puuid?: string }) =>
      account.accountToggleSavedProfile(platform, gameName, tagLine, puuid),
  );
  ipcMain.handle(CMD.AccountUpdateUsername, (_e, { username }: { username: string }) => account.accountUpdateUsername(username));
  ipcMain.handle(CMD.AccountCreateProfileFolder, (_e, { name }: { name: string }) => account.accountCreateProfileFolder(name));
  ipcMain.handle(CMD.AccountRenameProfileFolder, (_e, { id, name }: { id: string; name: string }) => account.accountRenameProfileFolder(id, name));
  ipcMain.handle(CMD.AccountDeleteProfileFolder, (_e, { id }: { id: string }) => account.accountDeleteProfileFolder(id));
  ipcMain.handle(
    CMD.AccountSetProfileFolder,
    (_e, { profileId, folderId }: { profileId: string; folderId: string }) => account.accountSetProfileFolder(profileId, folderId),
  );
  ipcMain.handle(CMD.AccountGetSavedTierLists, () => account.accountGetSavedTierLists());
  ipcMain.handle(CMD.AccountCreateTierList, (_e, { name, board }: { name: string; board: Record<string, string[]> }) =>
    account.accountCreateTierList(name, board),
  );
  ipcMain.handle(CMD.AccountDeleteTierList, (_e, { id }: { id: string }) => account.accountDeleteTierList(id));
  ipcMain.handle(CMD.AccountGetSavedDrafts, () => account.accountGetSavedDrafts());
  ipcMain.handle(CMD.AccountCreateDraft, (_e, { name, selections }: { name: string; selections: string[] }) =>
    account.accountCreateDraft(name, selections),
  );
  ipcMain.handle(CMD.AccountDeleteDraft, (_e, { id }: { id: string }) => account.accountDeleteDraft(id));
  ipcMain.handle(CMD.AccountGetSavedMaps, () => account.accountGetSavedMaps());
  ipcMain.handle(CMD.AccountGetSavedMap, (_e, { id }: { id: string }) => account.accountGetSavedMap(id));
  ipcMain.handle(CMD.AccountCreateMap, (_e, { name, strokes, notes }: { name: string; strokes: unknown; notes: string }) =>
    account.accountCreateMap(name, strokes, notes),
  );
  ipcMain.handle(CMD.AccountDeleteMap, (_e, { id }: { id: string }) => account.accountDeleteMap(id));
  ipcMain.handle(CMD.AccountGetSavedBuilds, () => account.accountGetSavedBuilds());
  ipcMain.handle(CMD.AccountCreateBuild, (_e, { name, items, supportRole }: { name: string; items: string[]; supportRole: boolean }) =>
    account.accountCreateBuild(name, items, supportRole),
  );
  ipcMain.handle(CMD.AccountDeleteBuild, (_e, { id }: { id: string }) => account.accountDeleteBuild(id));

  // Defense in depth: the renderer's bridge (src/bridge/index.ts) already
  // enforces this same allowlist before ever calling invoke, but the main
  // process must never trust the renderer — same rule as any other
  // privilege boundary.
  ipcMain.handle(CMD.ShellOpenExternal, (_e, { url }: { url: string }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== "https:" || !/(^|\.)riftcompass\.com$/.test(parsed.hostname)) return;
    return shell.openExternal(url);
  });

  // Frameless main-window chrome (WindowControls.tsx) — see
  // windows.ts's WINDOW_CHANNELS doc comment for why these live outside
  // the CMD/EVT allowlist.
  ipcMain.handle(WINDOW_CHANNELS.minimize, () => getMainWindow()?.minimize());
  ipcMain.handle(WINDOW_CHANNELS.toggleMaximize, () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle(WINDOW_CHANNELS.close, () => getMainWindow()?.close());
  ipcMain.handle(WINDOW_CHANNELS.isMaximized, () => getMainWindow()?.isMaximized() ?? false);
}
