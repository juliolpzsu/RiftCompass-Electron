// Single allowlist of every IPC channel and event name this app uses —
// nothing outside this file should write a raw channel/event string. The
// main process (electron/) must register `ipcMain.handle` for EXACTLY
// these command names, and push events via `webContents.send` with
// EXACTLY these event names.

export const CMD = {
  /** invoke, no args. returns { connected, identity } — current LCU state */
  LcuGetState: "lcu_get_state",
  /** invoke. args: { path } — read-only LCU GET, limited to the paths ipc.ts allowlists */
  LcuGet: "lcu_get",
  /** invoke. args: { interactive } — overlay window click-through toggle */
  OverlaySetInteractive: "overlay_set_interactive",
  /** invoke, no args — force-shows the overlay, fully interactive, for ability-bar calibration */
  OverlayEnterCalibration: "overlay_enter_calibration",
  /** invoke, no args — restores click-through + hides the overlay again */
  OverlayExitCalibration: "overlay_exit_calibration",
  /** invoke. args: { championId } */
  BuildImport: "build_import",
  /** invoke. args: { perkIds, primaryStyleId, subStyleId, spellLow, spellHigh } — recommended runes+spells, Flash slotted per flashSide */
  ApplyRecommendedBuild: "apply_recommended_build",
  /** invoke, no args. returns AppSettings */
  SettingsGet: "settings_get",
  /** invoke. args: { enabled } */
  SettingsSetAutoLaunch: "settings_set_auto_launch",
  /** invoke. args: { modules } */
  SettingsSetOverlayModules: "settings_set_overlay_modules",
  /** invoke. args: { locale } */
  SettingsSetLocale: "settings_set_locale",
  /** invoke. args: { side } — "left" | "right" */
  SettingsSetFlashSide: "settings_set_flash_side",
  /** invoke. args: { calibration } — { q, w, e } normalized screen points */
  SettingsSetAbilityBarCalibration: "settings_set_ability_bar_calibration",
  /** invoke. args: { panel: "gold" | "objectives", position: { x, y } } — normalized screen point, set by dragging an overlay panel */
  SettingsSetOverlayPanelPosition: "settings_set_overlay_panel_position",
  /** invoke. args: { email, password } */
  AccountLogin: "account_login",
  /** invoke, no args */
  AccountLogout: "account_logout",
  /** invoke, no args. returns AccountUser | null */
  AccountGetSession: "account_get_session",
  /** invoke, no args. returns { folders, profiles } */
  AccountGetSavedProfiles: "account_get_saved_profiles",
  /** invoke. args: { platform, gameName, tagLine, puuid? } — save/unsave toggle */
  AccountToggleSavedProfile: "account_toggle_saved_profile",
  /** invoke. args: { name } */
  AccountCreateProfileFolder: "account_create_profile_folder",
  /** invoke. args: { id, name } */
  AccountRenameProfileFolder: "account_rename_profile_folder",
  /** invoke. args: { id } */
  AccountDeleteProfileFolder: "account_delete_profile_folder",
  /** invoke. args: { profileId, folderId } */
  AccountSetProfileFolder: "account_set_profile_folder",
  /** invoke. args: { username } */
  AccountUpdateUsername: "account_update_username",
  /** invoke, no args. returns SavedTierList[] */
  AccountGetSavedTierLists: "account_get_saved_tier_lists",
  /** invoke. args: { name, board } */
  AccountCreateTierList: "account_create_tier_list",
  /** invoke. args: { id } */
  AccountDeleteTierList: "account_delete_tier_list",
  /** invoke, no args. returns SavedDraft[] */
  AccountGetSavedDrafts: "account_get_saved_drafts",
  /** invoke. args: { name, selections } */
  AccountCreateDraft: "account_create_draft",
  /** invoke. args: { id } */
  AccountDeleteDraft: "account_delete_draft",
  /** invoke, no args. returns SavedMapSummary[] */
  AccountGetSavedMaps: "account_get_saved_maps",
  /** invoke. args: { id } — loads one map's full strokes + notes */
  AccountGetSavedMap: "account_get_saved_map",
  /** invoke. args: { name, strokes, notes } */
  AccountCreateMap: "account_create_map",
  /** invoke. args: { id } */
  AccountDeleteMap: "account_delete_map",
  /** invoke, no args. returns SavedBuild[] */
  AccountGetSavedBuilds: "account_get_saved_builds",
  /** invoke. args: { name, items, supportRole } */
  AccountCreateBuild: "account_create_build",
  /** invoke. args: { id } */
  AccountDeleteBuild: "account_delete_build",
  /** invoke. args: { url } — opens an https://riftcompass.com URL in the OS browser */
  ShellOpenExternal: "shell_open_external",
} as const;

// Main process -> renderer pushes, via webContents.send.
export const EVT = {
  /** payload: "connected" | "disconnected" */
  LcuConnection: "lcu:connection",
  /** payload: gameflow phase string, e.g. "ChampSelect" */
  LcuPhase: "lcu:phase",
  /** payload: {puuid,gameName,tagLine,platform} | null */
  LcuIdentity: "lcu:identity",
  /** payload: champ-select session object */
  ChampSelectSession: "champselect:session",
  /** payload: live game data object, or null when no match is running */
  LiveGameData: "livegame:data",
  /** payload: boolean — Tab is currently held (only emitted while InProgress) */
  OverlayTabHeld: "overlay:tab-held",
  /** payload: none — ability-bar calibration mode just started */
  OverlayCalibrationStart: "overlay:calibration-start",
} as const;
