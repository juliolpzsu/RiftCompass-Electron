// The League client's own local API (LCU) — the same mechanism
// Porofessor/Blitz/op.gg's client use. Read-only use plus the
// build-import writes; no automating of game actions.
//
// Auth: the running client writes a `lockfile` next to its executable
// with `name:pid:port:password:protocol` (live-verified format).
//
// TLS: the LCU serves a self-signed cert on 127.0.0.1, so both transports
// must explicitly trust it — plain https.request via `rejectUnauthorized:
// false`, and the websocket via the same option passed to `ws`.

import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";
import WebSocket from "ws";

export interface LcuCredentials {
  port: number;
  password: string;
}

export function findLockfile(): string | null {
  const candidates = ["C:\\Riot Games\\League of Legends\\lockfile"];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(path.join(localAppData, "Riot Games", "League of Legends", "lockfile"));
  }
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function readLockfile(lockfilePath: string): LcuCredentials | null {
  let raw: string;
  try {
    raw = fs.readFileSync(lockfilePath, "utf-8");
  } catch {
    return null;
  }
  // name:pid:port:password:protocol
  const parts = raw.split(":");
  const port = Number(parts[2]);
  const password = parts[3];
  if (!Number.isInteger(port) || !password) return null;
  return { port, password };
}

function basicAuth(creds: LcuCredentials): string {
  return "Basic " + Buffer.from(`riot:${creds.password}`).toString("base64");
}

// 204/empty -> null; otherwise parse whatever came back, success or error
// body alike, and let the caller decide.
export function lcuRequest(creds: LcuCredentials, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: creds.port,
        path: urlPath,
        method: method.toUpperCase(),
        rejectUnauthorized: false,
        headers: {
          Authorization: basicAuth(creds),
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode === 204 || text.length === 0) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error(`LCU returned non-JSON (${res.statusCode}): ${e}`));
          }
        });
      },
    );
    req.on("error", (e) => reject(new Error(`LCU request failed: ${e.message}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

// Real-time push events — the LCU's websocket wants a Socket.IO-flavored
// subscribe frame (`[5,"OnJsonApiEvent"]`) right after connecting, then
// emits `[8, "OnJsonApiEvent_<uri>", payload]` for every REST resource
// that changes.
export interface LcuEvent {
  uri: string;
  eventType: string;
  data: unknown;
}

export function connectWs(creds: LcuCredentials): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${creds.port}`, {
      rejectUnauthorized: false,
      headers: { Authorization: basicAuth(creds) },
    });
    ws.once("open", () => {
      ws.send('[5, "OnJsonApiEvent"]');
      resolve(ws);
    });
    ws.once("error", (e) => reject(new Error(`LCU ws connect failed: ${e.message}`)));
  });
}

// Parses one incoming websocket text frame into an event, if it is one.
// The LCU sends empty keepalive frames and the initial subscribe ack —
// both come back as null.
export function parseEventFrame(text: string): LcuEvent | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed[0] !== 8) return null;
  const payload = parsed[2];
  if (typeof payload !== "object" || payload === null) return null;
  const { uri, eventType, data } = payload as Record<string, unknown>;
  if (typeof uri !== "string") return null;
  return { uri, eventType: typeof eventType === "string" ? eventType : "", data };
}
