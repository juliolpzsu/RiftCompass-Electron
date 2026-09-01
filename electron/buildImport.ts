// "Import your last build": real personal data only, pulled from the
// LCU's own match-history endpoint (no Riot API key involved).
// Deliberately does NOT fabricate a "recommended" build from aggregate
// stats RiftCompass doesn't have — it re-applies the player's own most
// recent real game on this champion.
//
// Ported 1:1 from RiftCompass-Tauri/src-tauri/src/build_import.rs.

import { lcuRequest, type LcuCredentials } from "./lcu";

interface ParticipantStats {
  perk0: number;
  perk1: number;
  perk2: number;
  perk3: number;
  perk4: number;
  perk5: number;
  perkPrimaryStyle: number;
  perkSubStyle: number;
  statPerk0: number;
  statPerk1: number;
  statPerk2: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
}

interface Participant {
  championId: number;
  participantId: number;
  spell1Id: number;
  spell2Id: number;
  stats: ParticipantStats;
}

interface ParticipantIdentity {
  participantId: number;
  player: { puuid: string };
}

interface Game {
  participants: Participant[];
  participantIdentities: ParticipantIdentity[];
}

export interface LastBuild {
  perkIds: number[];
  primaryStyleId: number;
  subStyleId: number;
  spell1Id: number;
  spell2Id: number;
  items: number[];
}

export async function fetchLastBuild(creds: LcuCredentials, puuid: string, championId: number): Promise<LastBuild | null> {
  const history = (await lcuRequest(
    creds,
    "GET",
    `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=20`,
  )) as { games: { games: Game[] } };

  for (const game of history.games.games) {
    const identity = game.participantIdentities.find((p) => p.player.puuid === puuid);
    if (!identity) continue;
    const participant = game.participants.find((p) => p.participantId === identity.participantId && p.championId === championId);
    if (!participant) continue;
    const s = participant.stats;
    return {
      // 6 rune slots (keystone + 3 primary + 2 secondary) plus the 3 stat
      // shards — a page the LCU rejects as incomplete without all 9.
      perkIds: [s.perk0, s.perk1, s.perk2, s.perk3, s.perk4, s.perk5, s.statPerk0, s.statPerk1, s.statPerk2],
      primaryStyleId: s.perkPrimaryStyle,
      subStyleId: s.perkSubStyle,
      spell1Id: participant.spell1Id,
      spell2Id: participant.spell2Id,
      items: [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].filter((i) => i > 0),
    };
  }
  return null;
}

// Reuses a single page named "RiftCompass Import" instead of creating a
// new one every time — matches the real page-count limit the LCU enforces
// and keeps the player's own rune pages from getting cluttered. Takes the
// 3 fields it actually needs rather than a whole LastBuild, so
// apply_recommended_build (crawler-sourced runes, not the player's own
// match history) can call it without a LastBuild to build.
export async function applyRunePage(creds: LcuCredentials, perkIds: number[], primaryStyleId: number, subStyleId: number): Promise<void> {
  const pages = (await lcuRequest(creds, "GET", "/lol-perks/v1/pages")) as Array<{ id: number; name: string; isDeletable: boolean }>;
  const existing = pages.find((p) => p.name === "RiftCompass Import" && p.isDeletable);
  if (existing) {
    await lcuRequest(creds, "DELETE", `/lol-perks/v1/pages/${existing.id}`);
  }

  const created = (await lcuRequest(creds, "POST", "/lol-perks/v1/pages", {
    name: "RiftCompass Import",
    primaryStyleId,
    subStyleId,
    selectedPerkIds: perkIds,
  })) as { id?: number };
  if (typeof created.id !== "number") throw new Error("rune page create returned no id");
  await lcuRequest(creds, "PUT", "/lol-perks/v1/currentpage", created.id);
}

export async function applySummonerSpells(creds: LcuCredentials, spell1Id: number, spell2Id: number): Promise<void> {
  await lcuRequest(creds, "PATCH", "/lol-champ-select/v1/session/my-selection", { spell1Id, spell2Id });
}
