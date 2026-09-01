// Same public Data Dragon source the main RiftCompass web app uses for
// champion data — no API key needed, just the current patch version.
export interface ChampionInfo {
  id: number;
  internalId: string;
  name: string;
  iconUrl: string;
  tags: string[];
  difficulty: number;
  attack: number;
  defense: number;
  magic: number;
}

export interface ChampionMaps {
  byId: Record<number, ChampionInfo>;
  // Keyed by Data Dragon's internal id (e.g. "MonkeyKing") — this is what
  // champ-select's assignedPosition/championId resolve to, and what real
  // (non-bot) players' Live Client Data championName reports.
  byInternalId: Record<string, ChampionInfo>;
  // Keyed by a normalized (lowercased, non-alphanumeric stripped) name —
  // covers both the internal id ("twistedfate") and, once
  // mergeLocalizedChampionNames adds them, the League client's own
  // display-locale name ("maestroyi" for "Maestro Yi"). Needed because
  // Live Client Data reports BOT-controlled champions' names in the
  // client's display locale, not the English internal id (verified live
  // 2026-08-31 against a Spanish-locale client: "Maestro Yi" for
  // MasterYi, "Twisted Fate"/"Xin Zhao" with a space where the internal
  // id has none) — see OverlayView.tsx's resolveLanePlayer.
  byNormalizedName: Record<string, ChampionInfo>;
}

export function normalizeChampionName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function fetchChampionMap(): Promise<ChampionMaps> {
  const versions: string[] = await fetch("https://ddragon.leagueoflegends.com/api/versions.json").then((r) =>
    r.json(),
  );
  const version = versions[0];
  const data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`).then(
    (r) => r.json(),
  );
  const byId: Record<number, ChampionInfo> = {};
  const byInternalId: Record<string, ChampionInfo> = {};
  const byNormalizedName: Record<string, ChampionInfo> = {};
  for (const champ of Object.values(data.data) as Array<{
    id: string;
    key: string;
    name: string;
    image: { full: string };
    tags: string[];
    info: { difficulty: number; attack: number; defense: number; magic: number };
  }>) {
    const info: ChampionInfo = {
      id: Number(champ.key),
      internalId: champ.id,
      name: champ.name,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.image.full}`,
      tags: champ.tags,
      difficulty: champ.info.difficulty,
      attack: champ.info.attack,
      defense: champ.info.defense,
      magic: champ.info.magic,
    };
    byId[info.id] = info;
    byInternalId[champ.id] = info;
    byNormalizedName[normalizeChampionName(champ.id)] = info;
  }
  return { byId, byInternalId, byNormalizedName };
}

// Adds the League client's own display-locale champion names into an
// already-fetched ChampionMaps' byNormalizedName lookup, mutating it in
// place — a second Data Dragon fetch (locale-specific champion.json),
// merged by numeric key so it lines up with the English-keyed maps
// already built. Best-effort: an unsupported/unreachable locale just
// means bot champion names in that locale keep failing to resolve,
// same as before this function existed.
export async function mergeLocalizedChampionNames(maps: ChampionMaps, version: string, ddLocale: string): Promise<void> {
  if (ddLocale === "en_US") return; // already covered by fetchChampionMap's own English pass
  let data: { data: Record<string, { key: string; name: string }> };
  try {
    data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/${ddLocale}/champion.json`).then((r) =>
      r.json(),
    );
  } catch {
    return;
  }
  for (const champ of Object.values(data.data)) {
    const info = maps.byId[Number(champ.key)];
    if (info) maps.byNormalizedName[normalizeChampionName(champ.name)] = info;
  }
}

export async function fetchLatestVersion(): Promise<string> {
  const versions: string[] = await fetch("https://ddragon.leagueoflegends.com/api/versions.json").then((r) =>
    r.json(),
  );
  return versions[0];
}

export function championSquareUrl(version: string, championInternalId: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championInternalId}.png`;
}

export function profileIconUrl(version: string, iconId: number): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${iconId}.png`;
}

export function itemIconUrl(version: string, itemId: number | string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
}
export interface ItemSummary {
  id: string;
  name: string;
  totalGold: number;
  // Combine cost: what the item itself adds on top of its components.
  baseGold: number;
  // Data Dragon's own item.tags (e.g. "Boots", "Consumable", "Trinket").
  tags: string[];
  // Component/build relations by item id, straight from Data Dragon.
  from: string[];
  into: string[];
  // Localized stat lines parsed out of the description's <stats> block —
  // Data Dragon has no reliable structured stats field, but every shop
  // item carries this block in every locale.
  stats: string[];
}

export interface ItemCatalog {
  // Deduped, name-sorted list of what the shop grid shows.
  list: ItemSummary[];
  // Every purchasable id (pre-dedupe) so from/into chains always resolve.
  byId: Record<string, ItemSummary>;
}

const DDRAGON_LOCALES: Record<string, string> = { en: "en_US", es: "es_ES", fr: "fr_FR", de: "de_DE" };

function parseStatLines(description: string): string[] {
  const match = /<stats>([\s\S]*?)<\/stats>/.exec(description);
  if (!match) return [];
  return match[1]
    .split(/<br\s*\/?>/)
    .map((line) => line.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
}

// Ported from the web app's src/lib/riot/ddragon.ts getItemList() — same
// real filtering logic, not re-derived: purchasable-on-Summoner's-Rift
// items only (map "11"), with Data Dragon's Arena-mode remix duplicates
// (id = 300000 + the real item's id) and legitimately-two-id duplicates
// (jungle pet evolutions, Kalista's Black Spear) collapsed by name.
export async function fetchItemCatalog(version: string, locale: string): Promise<ItemCatalog> {
  const ddLocale = DDRAGON_LOCALES[locale] ?? "en_US";
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/${ddLocale}/item.json`);
  const json = await res.json();
  const entries = Object.entries(json.data) as [
    string,
    {
      name: string;
      description: string;
      gold: { base: number; total: number; purchasable: boolean };
      maps: Record<string, boolean>;
      tags?: string[];
      from?: string[];
      into?: string[];
    },
  ][];

  const byId: Record<string, ItemSummary> = {};
  const byName = new Map<string, ItemSummary>();
  for (const [id, item] of entries) {
    if (!item.gold.purchasable || !item.maps["11"]) continue;
    if (Number(id) >= 300000) continue;
    const summary: ItemSummary = {
      id,
      name: item.name,
      totalGold: item.gold.total,
      baseGold: item.gold.base,
      tags: item.tags ?? [],
      from: item.from ?? [],
      into: item.into ?? [],
      stats: parseStatLines(item.description ?? ""),
    };
    byId[id] = summary;
    const existing = byName.get(item.name);
    if (existing && Number(existing.id) <= Number(id)) continue;
    byName.set(item.name, summary);
  }

  return { list: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), byId };
}

export function spellIconUrl(version: string, spellImageFull: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${spellImageFull}`;
}

export interface SummonerSpellInfo {
  name: string;
  // Base cooldown only (no CDR items/runes factored in) — Data Dragon has
  // no way to know a player's actual reduction, same honesty rule as the
  // gold estimate above. Always show this prefixed "~" in the UI.
  cooldownSeconds: number;
  iconUrl: string;
}

// Keyed by display name ("Flash", "Ignite"...) — the same human-readable
// name the Live Client Data API's summonerSpells.summonerSpellOne/Two
// .displayName already uses, so no id-mapping step is needed to match them.
export async function fetchSummonerSpells(version: string): Promise<Record<string, SummonerSpellInfo>> {
  const data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/summoner.json`).then((r) =>
    r.json(),
  );
  const byName: Record<string, SummonerSpellInfo> = {};
  for (const spell of Object.values(data.data) as Array<{
    name: string;
    cooldown: number[];
    image: { full: string };
  }>) {
    byName[spell.name] = {
      name: spell.name,
      cooldownSeconds: spell.cooldown[0] ?? 0,
      iconUrl: spellIconUrl(version, spell.image.full),
    };
  }
  return byName;
}

// Keyed by Riot's numeric spell id (Match-V5's summoner1Id/summoner2Id use
// this, not the display name fetchSummonerSpells above is keyed by) — same
// approach as the web's getSummonerSpellIconMap (src/lib/riot/ddragon.ts).
export async function fetchSummonerSpellIconsById(version: string): Promise<Record<number, string>> {
  const data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/summoner.json`).then((r) =>
    r.json(),
  );
  const byId: Record<number, string> = {};
  for (const spell of Object.values(data.data) as Array<{ key: string; image: { full: string } }>) {
    byId[Number(spell.key)] = spellIconUrl(version, spell.image.full);
  }
  return byId;
}

export interface ChampionSpell {
  id: string;
  name: string;
  cooldown: number[];
  maxrank: number;
  image: { full: string };
}

export interface ChampionDetail {
  id: string;
  name: string;
  spells: ChampionSpell[];
}

// Ported from the web app's src/lib/riot/ddragon.ts getChampionDetail().
export async function fetchChampionDetail(version: string, championId: string): Promise<ChampionDetail> {
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion/${championId}.json`);
  const json = await res.json();
  return json.data[championId];
}
