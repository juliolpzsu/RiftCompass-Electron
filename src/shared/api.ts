// The desktop app's one real backend: riftcompass.com's own /api/v1/*
// (see the web repo's CLAUDE.md, "API pública v1"). Must match the copy
// in electron/account.ts, which the main process keeps on its own side
// of the IPC boundary.
export const API_BASE_URL = "https://riftcompass.com";
