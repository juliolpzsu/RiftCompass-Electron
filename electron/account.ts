// Login and account-backed data against riftcompass.com's own accounts —
// same accounts and passwords as the website, never RSO/Riot credentials.
// The bearer token (90-day credential) is encrypted at rest via DPAPI
// (dpapi.ts), tied to the logged-in OS user, and never crosses to the
// renderer: every endpoint is called from here and only plain JSON
// results are returned.

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { protect, unprotect } from "./dpapi";

// Must match src/shared/api.ts on the frontend side.
const API_BASE_URL = "https://riftcompass.com";

export interface AccountUser {
  id: string;
  email: string;
  username: string | null;
  avatarUrl: string | null;
}

interface AccountSession {
  token: string;
  user: AccountUser;
}

function sessionFilePath(): string {
  return path.join(app.getPath("userData"), "session.dat");
}

function persistSession(session: AccountSession): void {
  const json = Buffer.from(JSON.stringify(session), "utf-8");
  // No plaintext fallback: if DPAPI is unavailable (never the case on a
  // normal Windows session) we simply don't persist.
  const encrypted = protect(json);
  if (!encrypted) return;
  try {
    fs.mkdirSync(path.dirname(sessionFilePath()), { recursive: true });
    fs.writeFileSync(sessionFilePath(), encrypted);
  } catch {
    // best-effort, like the settings file
  }
}

function loadPersistedSession(): AccountSession | null {
  let raw: Buffer;
  try {
    raw = fs.readFileSync(sessionFilePath());
  } catch {
    return null;
  }
  const json = unprotect(raw);
  if (!json) return null;
  try {
    return JSON.parse(json.toString("utf-8"));
  } catch {
    return null;
  }
}

function clearPersistedSession(): void {
  try {
    fs.unlinkSync(sessionFilePath());
  } catch {
    // already gone
  }
}

// The tagged { ok: true, ... } | { ok: false, error } result unions the
// bridge expects.
function err(code: string): { ok: false; error: string } {
  return { ok: false, error: code };
}

// riftcompass.com's response bodies are always a JSON object (or absent
// on a parse failure) — typed as a loose record here since each caller
// already knows, and checks for, the specific fields its own endpoint
// returns.
async function readJson(res: Response): Promise<Record<string, any> | null> {
  try {
    return (await res.json()) as Record<string, any>;
  } catch {
    return null;
  }
}

async function postJson(url: string, body: unknown, token?: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

export async function accountLogin(email: string, password: string): Promise<unknown> {
  const res = await postJson(`${API_BASE_URL}/api/v1/auth/login`, { email, password });
  if (!res) return err("network");
  const ok = res.ok;
  const data = await readJson(res);
  if (ok && data?.token && data?.user) {
    persistSession({ token: data.token, user: data.user });
    return { ok: true, user: data.user };
  }
  return err(data?.error ?? "unknown");
}

export function accountLogout(): void {
  clearPersistedSession();
}

// Re-validates the stored token against /api/v1/me. ONLY a 401 clears the
// session (that alone means the token is invalid); any other failure —
// 5xx, offline — falls back to the last-known cached user instead of
// silently logging the user out over a hiccup.
export async function accountGetSession(): Promise<AccountUser | null> {
  const stored = loadPersistedSession();
  if (!stored) return null;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/me`, { headers: { Authorization: `Bearer ${stored.token}` } });
  } catch {
    return stored.user;
  }

  if (res.status === 401) {
    clearPersistedSession();
    return null;
  }
  if (!res.ok) return stored.user;

  const data = await readJson(res);
  if (data?.user) {
    persistSession({ token: stored.token, user: data.user });
    return data.user;
  }
  return stored.user;
}

export async function accountUpdateUsername(username: string): Promise<unknown> {
  const stored = loadPersistedSession();
  if (!stored) return err("notAuthenticated");

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/username`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${stored.token}` },
      body: JSON.stringify({ username }),
    });
  } catch {
    return err("network");
  }
  const ok = res.ok;
  const data = await readJson(res);
  if (ok && data?.user) {
    persistSession({ token: stored.token, user: data.user });
    return { ok: true, user: data.user };
  }
  return err(data?.error ?? "unknown");
}

export async function accountGetSavedProfiles(): Promise<unknown> {
  const empty = { folders: [], profiles: [] };
  const stored = loadPersistedSession();
  if (!stored) return empty;

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/saved-profiles`, { headers: { Authorization: `Bearer ${stored.token}` } });
    if (!res.ok) return empty;
    return await res.json();
  } catch {
    return empty;
  }
}

// Shared by every folder-scoped mutation (profile folders + the toggle
// itself) — the response rides a shared { folders, profiles } payload.
async function folderApiCall(method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const stored = loadPersistedSession();
  if (!stored) return err("notAuthenticated");

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${urlPath}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${stored.token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    return err("network");
  }
  const ok = res.ok;
  const data = await readJson(res);
  if (ok && data?.folders && data?.profiles) {
    return { ...data, ok: true };
  }
  return err(data?.error ?? "unknown");
}

export function accountToggleSavedProfile(platform: string, gameName: string, tagLine: string, puuid?: string): Promise<unknown> {
  return folderApiCall("POST", "/api/v1/saved-profiles", { platform, gameName, tagLine, puuid });
}

export function accountCreateProfileFolder(name: string): Promise<unknown> {
  return folderApiCall("POST", "/api/v1/saved-profile-folders", { name });
}

export function accountRenameProfileFolder(id: string, name: string): Promise<unknown> {
  return folderApiCall("PATCH", `/api/v1/saved-profile-folders/${id}`, { name });
}

export function accountDeleteProfileFolder(id: string): Promise<unknown> {
  return folderApiCall("DELETE", `/api/v1/saved-profile-folders/${id}`);
}

// A profile is always in exactly one folder — moving it "out" just means
// moving it into the default one, so this always sets a real folder id.
export function accountSetProfileFolder(profileId: string, folderId: string): Promise<unknown> {
  return folderApiCall("PATCH", `/api/v1/saved-profiles/${profileId}`, { folderId });
}

async function getList(urlPath: string, key: string): Promise<unknown[]> {
  const stored = loadPersistedSession();
  if (!stored) return [];
  try {
    const res = await fetch(`${API_BASE_URL}${urlPath}`, { headers: { Authorization: `Bearer ${stored.token}` } });
    if (!res.ok) return [];
    const data = await readJson(res);
    return data?.[key] ?? [];
  } catch {
    return [];
  }
}

// Wraps a write response whose body carries the updated list under `key`
// (tier lists, drafts, maps, builds) into the { ok: true, <key>: [...] }
// union the bridge expects.
async function listResult(method: string, urlPath: string, body: unknown, key: string): Promise<unknown> {
  const stored = loadPersistedSession();
  if (!stored) return err("notAuthenticated");
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${urlPath}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${stored.token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    return err("network");
  }
  const ok = res.ok;
  const data = await readJson(res);
  if (ok && data?.[key] !== undefined) {
    return { ok: true, [key]: data[key] };
  }
  return err(data?.error ?? "unknown");
}

export const accountGetSavedTierLists = () => getList("/api/v1/saved-tier-lists", "tierLists");
export const accountCreateTierList = (name: string, board: Record<string, string[]>) =>
  listResult("POST", "/api/v1/saved-tier-lists", { name, board }, "tierLists");
export const accountDeleteTierList = (id: string) => listResult("DELETE", `/api/v1/saved-tier-lists/${id}`, undefined, "tierLists");

export const accountGetSavedDrafts = () => getList("/api/v1/saved-drafts", "drafts");
export const accountCreateDraft = (name: string, selections: string[]) =>
  listResult("POST", "/api/v1/saved-drafts", { name, selections }, "drafts");
export const accountDeleteDraft = (id: string) => listResult("DELETE", `/api/v1/saved-drafts/${id}`, undefined, "drafts");

export const accountGetSavedMaps = () => getList("/api/v1/saved-maps", "maps");
export const accountCreateMap = (name: string, strokes: unknown, notes: string) =>
  listResult("POST", "/api/v1/saved-maps", { name, strokes, notes }, "maps");
export const accountDeleteMap = (id: string) => listResult("DELETE", `/api/v1/saved-maps/${id}`, undefined, "maps");

export async function accountGetSavedMap(id: string): Promise<unknown> {
  const stored = loadPersistedSession();
  if (!stored) return err("notAuthenticated");
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/saved-maps/${id}`, { headers: { Authorization: `Bearer ${stored.token}` } });
  } catch {
    return err("network");
  }
  const ok = res.ok;
  const data = await readJson(res);
  if (ok && data?.strokes !== undefined) {
    return { ...data, ok: true };
  }
  return err(data?.error ?? "unknown");
}

export const accountGetSavedBuilds = () => getList("/api/v1/saved-builds", "builds");
export const accountCreateBuild = (name: string, items: string[], supportRole: boolean) =>
  listResult("POST", "/api/v1/saved-builds", { name, items, supportRole }, "builds");
export const accountDeleteBuild = (id: string) => listResult("DELETE", `/api/v1/saved-builds/${id}`, undefined, "builds");
