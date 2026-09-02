// The Live Client Data API — officially documented by Riot
// (https://developer.riotgames.com/docs/lol#game-client-api). Only
// reachable while a match is actually running; same self-signed loopback
// trust model as the LCU. The payload is passed through as raw JSON — the
// shapes are Riot's and only the frontend consumes them.

import * as https from "node:https";

const HOST = "127.0.0.1";
const PORT = 2999;

function get(urlPath: string): Promise<{ status: number; text: string } | null> {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: HOST, port: PORT, path: `/liveclientdata${urlPath}`, method: "GET", rejectUnauthorized: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf-8") }));
      },
    );
    req.on("error", () => resolve(null));
    req.end();
  });
}

// null while the API isn't up (game still loading, or the match just
// ended) — the poller treats that as "nothing to report", not an error.
export async function fetchLiveGameData(): Promise<Record<string, unknown> | null> {
  const [gameRes, nameRes] = await Promise.all([get("/allgamedata"), get("/activeplayername")]);

  if (!gameRes || gameRes.status < 200 || gameRes.status >= 300 || !gameRes.text) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(gameRes.text);
  } catch {
    return null;
  }

  // A plain quoted string body (e.g. `"Locust#LCT"`) — a bare JSON string,
  // merged in as activePlayerName because Riot doesn't include a name on
  // activePlayer itself (separate endpoint). Malformed name payloads
  // aren't worth failing the whole poll over.
  if (nameRes && nameRes.status >= 200 && nameRes.status < 300 && nameRes.text) {
    try {
      const name = JSON.parse(nameRes.text);
      if (typeof name === "string") data.activePlayerName = name;
    } catch {
      // ignore malformed name payload
    }
  }

  return data;
}
