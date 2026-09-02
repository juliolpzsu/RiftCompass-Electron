import { useEffect, useMemo, useState } from "react";
import {
  Coins,
  Crosshair,
  Drop,
  DropSimple,
  Footprints,
  Heart,
  HandHeart,
  Heartbeat,
  Hourglass,
  SquaresFour,
  Plus,
  MagnifyingGlass,
  Shield,
  ShieldSlash,
  Skull,
  Sparkle,
  Sword,
  Target,
  MagicWand,
  Wind,
  X,
  Lightning,
  type Icon,
} from "@phosphor-icons/react";
import { fetchItemCatalog, fetchLatestVersion, itemIconUrl, type ItemCatalog, type ItemSummary } from "../ddragon";
import { useI18n } from "../i18n";
import type { AccountUser, SavedBuild } from "../riftcompass";
import { COLORS, FONT_HEADING } from "../theme";
import {
  CLASS_ITEM_IDS,
  isShopBoots,
  isShopItem,
  SHOP_GROUP_ORDER,
  shopGroupOf,
  SUPPORT_ITEM_IDS,
  SUPPORT_STARTER_ID,
  type ShopClassId,
  type ShopGroupId,
} from "./goldShopData";

type CategoryId = "all" | ShopClassId;

const BUILD_SIZE = 6;

function hasAny(tags: string[], names: string[]): boolean {
  return names.some((n) => tags.includes(n));
}

// Class tabs backed by goldShopData's curated per-class item lists (the
// same curation lolshop.gg uses); boots are always visible, like the real
// shop.
const CATEGORIES: { id: CategoryId; icon: Icon }[] = [
  { id: "all", icon: SquaresFour },
  { id: "fighter", icon: Sword },
  { id: "marksman", icon: Target },
  { id: "assassin", icon: Skull },
  { id: "mage", icon: MagicWand },
  { id: "tank", icon: Shield },
  { id: "support", icon: HandHeart },
];

function categoryMatch(category: CategoryId, item: ItemSummary): boolean {
  if (category === "all") return true;
  return CLASS_ITEM_IDS[category].has(item.id) || isShopBoots(item);
}

type StatFilterId =
  | "ad" | "crit" | "attackSpeed" | "armorPen" | "onHit" | "lifeSteal"
  | "ap" | "mana" | "magicPen"
  | "health" | "armor" | "magicResist"
  | "abilityHaste" | "moveSpeed" | "omnivamp" | "goldIncome";

// The stat sidebar of the in-game shop, driven by Data Dragon's own
// item.tags. Grouped into the same offensive/magic/defense/utility
// sections the client uses.
const STAT_SECTIONS: { id: StatFilterId; icon: Icon; tags: string[] }[][] = [
  [
    { id: "ad", icon: Sword, tags: ["Damage"] },
    { id: "crit", icon: Crosshair, tags: ["CriticalStrike"] },
    { id: "attackSpeed", icon: Wind, tags: ["AttackSpeed"] },
    { id: "armorPen", icon: ShieldSlash, tags: ["ArmorPenetration"] },
    { id: "onHit", icon: Lightning, tags: ["OnHit"] },
    { id: "lifeSteal", icon: Drop, tags: ["LifeSteal"] },
  ],
  [
    { id: "ap", icon: Sparkle, tags: ["SpellDamage"] },
    { id: "mana", icon: DropSimple, tags: ["Mana", "ManaRegen"] },
    { id: "magicPen", icon: MagicWand, tags: ["MagicPenetration"] },
  ],
  [
    { id: "health", icon: Heart, tags: ["Health", "HealthRegen"] },
    { id: "armor", icon: Shield, tags: ["Armor"] },
    { id: "magicResist", icon: Heartbeat, tags: ["SpellBlock"] },
  ],
  [
    { id: "abilityHaste", icon: Hourglass, tags: ["AbilityHaste", "CooldownReduction"] },
    { id: "moveSpeed", icon: Footprints, tags: ["NonbootsMovement", "Boots"] },
    { id: "omnivamp", icon: Heartbeat, tags: ["SpellVamp", "Omnivamp"] },
    { id: "goldIncome", icon: Coins, tags: ["GoldPer"] },
  ],
];

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function GoldCalculator() {
  const { t, locale } = useI18n();
  const [version, setVersion] = useState("");
  const [catalog, setCatalog] = useState<ItemCatalog | null>(null);
  const [selected, setSelected] = useState<ItemSummary | null>(null);
  const [category, setCategory] = useState<CategoryId>("all");
  const [statFilters, setStatFilters] = useState<StatFilterId[]>([]);
  const [query, setQuery] = useState("");
  const [build, setBuild] = useState<string[]>([]);
  const [supportRole, setSupportRole] = useState(false);
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [saveOpen, setSaveOpen] = useState(false);
  const [buildName, setBuildName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedBuilds, setSavedBuilds] = useState<SavedBuild[] | null>(null);
  const [buildListOpen, setBuildListOpen] = useState(false);

  useEffect(() => {
    window.riftcompass.getSession().then(setUser);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLatestVersion().then((v) => {
      fetchItemCatalog(v, locale).then((data) => {
        if (cancelled) return;
        setVersion(v);
        setCatalog(data);
        // Re-resolve the selection so a locale switch keeps it, localized.
        setSelected((prev) => (prev ? data.byId[prev.id] ?? null : null));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  // An `into` id is only worth showing if it resolves to a shop item.
  const resolveInto = (item: ItemSummary): ItemSummary[] =>
    catalog
      ? [...new Set(item.into)]
          .map((id) => catalog.byId[id])
          .filter((i): i is ItemSummary => Boolean(i) && isShopItem(i))
      : [];

  const activeStatTags = STAT_SECTIONS.flat().filter((s) => statFilters.includes(s.id));

  const grouped = useMemo(() => {
    if (!catalog) return [] as { group: ShopGroupId; items: ItemSummary[] }[];
    const q = normalize(query.trim());
    const visible = catalog.list.filter(
      (item) =>
        isShopItem(item) &&
        categoryMatch(category, item) &&
        activeStatTags.every((s) => hasAny(item.tags, s.tags)) &&
        (!q || normalize(item.name).includes(q)),
    );
    const buckets = new Map<ShopGroupId, ItemSummary[]>();
    for (const item of visible) {
      const g = shopGroupOf(item);
      const bucket = buckets.get(g);
      if (bucket) bucket.push(item);
      else buckets.set(g, [item]);
    }
    return SHOP_GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
      group: g,
      items: buckets.get(g)!.sort((a, b) => b.totalGold - a.totalGold),
    }));
    // activeStatTags is derived from statFilters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, query, category, statFilters]);

  const toggleStat = (id: StatFilterId) =>
    setStatFilters((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const addToBuild = (item: ItemSummary) => {
    setBuild((prev) => {
      // The support role keeps exactly one quest item: a new one replaces it.
      if (supportRole && SUPPORT_ITEM_IDS.has(item.id)) {
        const idx = prev.findIndex((id) => SUPPORT_ITEM_IDS.has(id));
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = item.id;
          return next;
        }
      }
      if (prev.length >= BUILD_SIZE) return prev;
      return [...prev, item.id];
    });
  };

  const removeFromBuild = (index: number) => {
    setBuild((prev) => {
      const removed = prev[index];
      const next = prev.filter((_, i) => i !== index);
      // The support slot is mandatory while the role is on — removing its
      // item falls back to the starter quest item instead of emptying it.
      if (supportRole && SUPPORT_ITEM_IDS.has(removed) && !next.some((id) => SUPPORT_ITEM_IDS.has(id))) {
        return [...next, SUPPORT_STARTER_ID];
      }
      return next;
    });
  };

  const toggleSupportRole = () => {
    const next = !supportRole;
    setSupportRole(next);
    if (next) {
      setBuild((prev) => {
        if (prev.some((id) => SUPPORT_ITEM_IDS.has(id))) return prev;
        const base = prev.length >= BUILD_SIZE ? prev.slice(0, BUILD_SIZE - 1) : prev;
        return [...base, SUPPORT_STARTER_ID];
      });
    }
  };

  async function handleConfirmSave() {
    if (!buildName.trim() || build.length === 0) return;
    setIsSaving(true);
    setSaveError(null);
    const result = await window.riftcompass.createBuild(buildName.trim(), build, supportRole);
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSaved(true);
    setSaveOpen(false);
    setBuildName("");
    setSavedBuilds(result.builds);
  }

  async function toggleBuildList() {
    const next = !buildListOpen;
    setBuildListOpen(next);
    if (next && savedBuilds === null) {
      setSavedBuilds(await window.riftcompass.getSavedBuilds());
    }
  }

  function handleLoadBuild(saved: SavedBuild) {
    setBuild(saved.items.slice(0, BUILD_SIZE));
    setSupportRole(saved.supportRole);
  }

  async function handleDeleteBuild(id: string) {
    const result = await window.riftcompass.deleteBuild(id);
    if (result.ok) setSavedBuilds(result.builds);
  }

  const buildItems = catalog ? build.map((id) => catalog.byId[id]).filter(Boolean) : [];
  const buildTotal = buildItems.reduce((sum, item) => sum + item.totalGold, 0);
  const buildFull = build.length >= BUILD_SIZE;
  const canAddSelected =
    selected !== null && (!buildFull || (supportRole && SUPPORT_ITEM_IDS.has(selected.id) && build.some((id) => SUPPORT_ITEM_IDS.has(id))));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr) minmax(260px, 320px)", gap: 18, alignItems: "start" }}>
      {/* Stat sidebar, like the in-game shop's left rail */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderRadius: 12,
          border: `1px solid ${COLORS.cardBorder}`,
          background: `${COLORS.card}80`,
          padding: "10px 0",
          position: "sticky",
          top: 0,
        }}
      >
        {version && (
          <span style={{ fontSize: 11, color: COLORS.muted, padding: "0 14px 8px", letterSpacing: 0.4 }}>
            {t("GoldCalculator.patch", { version })}
          </span>
        )}
        {STAT_SECTIONS.map((section, si) => (
          <div
            key={si}
            style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${COLORS.cardBorder}`, padding: "6px 0" }}
          >
            {section.map((stat) => {
              const active = statFilters.includes(stat.id);
              return (
                <button
                  key={stat.id}
                  onClick={() => toggleStat(stat.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 14px",
                    border: "none",
                    background: active ? `${COLORS.rose}1f` : "none",
                    color: active ? COLORS.rose : COLORS.muted,
                    fontSize: 12,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <stat.icon size={13} style={{ flexShrink: 0 }} />
                  {t(`GoldCalculator.filters.${stat.id}`)}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Item grid: search, class tabs, tier-grouped icons with prices */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <div style={{ position: "relative" }}>
          <MagnifyingGlass size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: COLORS.muted }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("GoldCalculator.search")}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: COLORS.card,
              color: COLORS.text,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 10,
              padding: "10px 12px 10px 34px",
              fontSize: 14,
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)} style={categoryPillStyle(category === c.id)}>
              <c.icon size={13} />
              {t(`GoldCalculator.categories.${c.id}`)}
            </button>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            maxHeight: 560,
            overflowY: "auto",
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${COLORS.cardBorder}`,
            background: `${COLORS.background}66`,
          }}
        >
          {grouped.map(({ group, items }) => (
            <div key={group} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontFamily: FONT_HEADING, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", color: COLORS.muted }}>
                {t(`GoldCalculator.groups.${group}`)}
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))", gap: 8 }}>
                {items.map((item) => {
                  const isSelected = selected?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelected(item)}
                      onDoubleClick={() => addToBuild(item)}
                      title={item.name}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 3,
                        padding: 0,
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                      }}
                    >
                      <img
                        src={itemIconUrl(version, item.id)}
                        alt={item.name}
                        style={{
                          width: "100%",
                          aspectRatio: "1",
                          display: "block",
                          objectFit: "cover",
                          borderRadius: 8,
                          border: `2px solid ${isSelected ? COLORS.gold : "transparent"}`,
                          boxShadow: isSelected ? `0 0 10px ${COLORS.gold}66` : "none",
                        }}
                      />
                      <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.gold, lineHeight: 1 }}>
                        {item.totalGold}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {grouped.length === 0 && (
            <span style={{ fontSize: 13, color: COLORS.muted, textAlign: "center", padding: 24 }}>
              {t("GoldCalculator.noResults")}
            </span>
          )}
        </div>
      </div>

      {/* Build panel: 6 slots, build total vs your gold, item detail */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 0 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderRadius: 14,
            border: `1px solid ${COLORS.cardBorder}`,
            background: `${COLORS.card}99`,
            padding: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={detailLabelStyle}>{t("GoldCalculator.build")}</span>
            <button
              onClick={toggleSupportRole}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 10px",
                borderRadius: 999,
                border: `1px solid ${supportRole ? COLORS.rose : COLORS.cardBorder}`,
                background: supportRole ? `${COLORS.rose}26` : "none",
                color: supportRole ? COLORS.rose : COLORS.muted,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              <HandHeart size={12} />
              {t("GoldCalculator.supportRole")}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
            {Array.from({ length: BUILD_SIZE }, (_, i) => {
              const item = catalog && build[i] ? catalog.byId[build[i]] : null;
              const isSupport = item ? SUPPORT_ITEM_IDS.has(item.id) : false;
              return item ? (
                <button
                  key={i}
                  onClick={() => removeFromBuild(i)}
                  title={`${item.name} · ${item.totalGold}`}
                  style={{
                    position: "relative",
                    padding: 0,
                    border: `2px solid ${isSupport && supportRole ? COLORS.rose : `${COLORS.gold}55`}`,
                    borderRadius: 8,
                    background: "none",
                    cursor: "pointer",
                    lineHeight: 0,
                  }}
                >
                  <img
                    src={itemIconUrl(version, item.id)}
                    alt={item.name}
                    style={{ width: "100%", aspectRatio: "1", display: "block", objectFit: "cover", borderRadius: 6 }}
                  />
                  <X
                    size={10}
                    style={{
                      position: "absolute",
                      top: 1,
                      right: 1,
                      color: COLORS.text,
                      background: "rgba(0,0,0,0.7)",
                      borderRadius: 3,
                    }}
                  />
                </button>
              ) : (
                <div
                  key={i}
                  style={{
                    aspectRatio: "1",
                    borderRadius: 8,
                    border: `1px dashed ${supportRole && i === build.length && !build.some((id) => SUPPORT_ITEM_IDS.has(id)) ? COLORS.rose : COLORS.cardBorder}`,
                    background: `${COLORS.background}55`,
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 13, color: COLORS.muted }}>{t("GoldCalculator.buildTotal")}</span>
            <span style={{ fontFamily: FONT_HEADING, fontSize: 20, color: COLORS.gold, fontWeight: 400 }}>{buildTotal}</span>
          </div>
          {build.length === 0 && (
            <span style={{ fontSize: 12, color: COLORS.muted }}>{t("GoldCalculator.buildEmpty")}</span>
          )}

          {user ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${COLORS.cardBorder}`, paddingTop: 10 }}>
              {saveOpen ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input
                    value={buildName}
                    onChange={(e) => setBuildName(e.target.value)}
                    placeholder={t("GoldCalculator.saveBuildPlaceholder")}
                    autoFocus
                    maxLength={60}
                    style={{
                      flex: "1 1 120px",
                      minWidth: 0,
                      background: COLORS.card,
                      color: COLORS.text,
                      border: `1px solid ${COLORS.cardBorder}`,
                      borderRadius: 8,
                      padding: "7px 10px",
                      fontSize: 13,
                    }}
                  />
                  <button
                    onClick={handleConfirmSave}
                    disabled={isSaving || !buildName.trim() || build.length === 0}
                    style={saveButtonStyle(!isSaving && Boolean(buildName.trim()) && build.length > 0)}
                  >
                    {isSaving ? t("GoldCalculator.saveBuildSaving") : t("GoldCalculator.saveBuildConfirm")}
                  </button>
                  <button
                    onClick={() => {
                      setSaveOpen(false);
                      setSaveError(null);
                    }}
                    style={saveButtonStyle(false)}
                  >
                    {t("GoldCalculator.saveBuildCancel")}
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      setSaveOpen(true);
                      setSaveError(null);
                      setSaved(false);
                    }}
                    disabled={build.length === 0}
                    style={saveButtonStyle(build.length > 0)}
                  >
                    {t("GoldCalculator.saveBuild")}
                  </button>
                  <button onClick={toggleBuildList} style={saveButtonStyle(false)}>
                    {t("GoldCalculator.myBuilds")}
                  </button>
                  {saved && <span style={{ fontSize: 12, color: COLORS.rose }}>{t("GoldCalculator.saveBuildSuccess")}</span>}
                </div>
              )}
              {saveError && (
                <span style={{ fontSize: 12, color: COLORS.destructive }}>{t(`GoldCalculator.saveBuildErrors.${saveError}`)}</span>
              )}
              {buildListOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {savedBuilds === null ? null : savedBuilds.length === 0 ? (
                    <span style={{ fontSize: 12, color: COLORS.muted }}>{t("GoldCalculator.myBuildsEmpty")}</span>
                  ) : (
                    savedBuilds.map((sb) => {
                      const total = catalog
                        ? sb.items.reduce((sum, id) => sum + (catalog.byId[id]?.totalGold ?? 0), 0)
                        : 0;
                      return (
                      <div
                        key={sb.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          borderRadius: 8,
                          border: `1px solid ${COLORS.cardBorder}`,
                          padding: "5px 8px",
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                          {sb.name}
                        </span>
                        <span style={{ fontSize: 11, color: COLORS.gold, flexShrink: 0 }}>{total}</span>
                        <span style={{ fontSize: 11, color: COLORS.muted, flexShrink: 0 }}>{new Date(sb.createdAt).toLocaleDateString(locale)}</span>
                        <button onClick={() => handleLoadBuild(sb)} style={saveButtonStyle(true)}>
                          {t("GoldCalculator.load")}
                        </button>
                        <button
                          onClick={() => handleDeleteBuild(sb.id)}
                          title={t("GoldCalculator.delete")}
                          style={{ ...saveButtonStyle(false), padding: "4px 6px", lineHeight: 0 }}
                        >
                          <X size={11} />
                        </button>
                      </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ) : user === null ? (
            <span style={{ fontSize: 12, color: COLORS.muted, borderTop: `1px solid ${COLORS.cardBorder}`, paddingTop: 10 }}>
              {t("GoldCalculator.loginToSave")}
            </span>
          ) : null}
        </div>

        {selected && catalog ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              borderRadius: 14,
              border: `1px solid ${COLORS.cardBorder}`,
              background: `${COLORS.card}99`,
              padding: 16,
            }}
          >
            {resolveInto(selected).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={detailLabelStyle}>{t("GoldCalculator.buildsInto")}</span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {resolveInto(selected).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelected(item)}
                      title={`${item.name} · ${item.totalGold}`}
                      style={{ padding: 0, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 6, background: "none", cursor: "pointer", lineHeight: 0 }}
                    >
                      <img src={itemIconUrl(version, item.id)} alt={item.name} style={{ width: 26, height: 26, borderRadius: 5, display: "block" }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img
                src={itemIconUrl(version, selected.id)}
                alt={selected.name}
                style={{ width: 52, height: 52, borderRadius: 10, flexShrink: 0, border: `1px solid ${COLORS.gold}55` }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontFamily: FONT_HEADING, fontSize: 16, fontWeight: 400 }}>{selected.name}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: COLORS.gold }}>{selected.totalGold}</span>
              </div>
            </div>

            <button
              onClick={() => addToBuild(selected)}
              disabled={!canAddSelected}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 10,
                border: `1px solid ${canAddSelected ? COLORS.gold : COLORS.cardBorder}`,
                background: canAddSelected ? `${COLORS.gold}1a` : "none",
                color: canAddSelected ? COLORS.gold : COLORS.muted,
                fontSize: 13,
                fontWeight: 500,
                cursor: canAddSelected ? "pointer" : "default",
              }}
            >
              <Plus size={14} />
              {buildFull && !canAddSelected ? t("GoldCalculator.buildFull") : t("GoldCalculator.addToBuild")}
            </button>

            {selected.stats.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {selected.stats.map((line) => (
                  <span key={line} style={{ fontSize: 13, color: COLORS.text }}>
                    {line}
                  </span>
                ))}
              </div>
            )}

            {selected.from.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={detailLabelStyle}>{t("GoldCalculator.buildPath")}</span>
                <span style={{ fontSize: 12, color: COLORS.muted }}>
                  {t("GoldCalculator.combineCost", { cost: selected.baseGold })}
                </span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {selected.from.map((id, idx) => (
                    <BuildTreeNode key={`${id}-${idx}`} id={id} catalog={catalog} version={version} depth={0} onSelect={setSelected} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 14,
              border: `1px dashed ${COLORS.cardBorder}`,
              color: `${COLORS.muted}bb`,
              fontSize: 13,
              minHeight: 120,
              textAlign: "center",
              padding: 24,
            }}
          >
            {t("GoldCalculator.itemPlaceholder")}
          </div>
        )}
      </div>
    </div>
  );
}

function BuildTreeNode({
  id,
  catalog,
  version,
  depth,
  onSelect,
}: {
  id: string;
  catalog: ItemCatalog;
  version: string;
  depth: number;
  onSelect: (item: ItemSummary) => void;
}) {
  const item = catalog.byId[id];
  if (!item) return null;
  return (
    <div style={{ marginLeft: depth * 14, borderLeft: depth > 0 ? `1px solid ${COLORS.cardBorder}` : "none", paddingLeft: depth > 0 ? 8 : 0 }}>
      <button
        onClick={() => onSelect(item)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "3px 4px",
          border: "none",
          borderRadius: 6,
          background: "none",
          color: COLORS.text,
          fontSize: 12,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <img src={itemIconUrl(version, item.id)} alt="" style={{ width: 22, height: 22, borderRadius: 4, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
        <span style={{ fontWeight: 700, color: COLORS.gold }}>{item.totalGold}</span>
      </button>
      {item.from.map((childId, idx) => (
        <BuildTreeNode key={`${childId}-${idx}`} id={childId} catalog={catalog} version={version} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  );
}

function saveButtonStyle(primary: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: 8,
    border: `1px solid ${primary ? COLORS.gold : COLORS.cardBorder}`,
    background: primary ? `${COLORS.gold}1a` : "none",
    color: primary ? COLORS.gold : COLORS.muted,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  };
}

const detailLabelStyle: React.CSSProperties = {
  fontFamily: FONT_HEADING,
  fontSize: 11,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: COLORS.muted,
};

function categoryPillStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? COLORS.rose : COLORS.cardBorder}`,
    background: active ? `${COLORS.rose}26` : "none",
    color: active ? COLORS.rose : COLORS.text,
    fontSize: 12,
    cursor: "pointer",
  };
}
