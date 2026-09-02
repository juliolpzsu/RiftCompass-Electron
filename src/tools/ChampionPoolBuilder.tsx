import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretUp, X } from "@phosphor-icons/react";
import { ChampionCombobox } from "../ChampionCombobox";
import { fetchChampionMap, type ChampionInfo } from "../ddragon";
import {
  MAX_POOL_SIZE,
  POOL_ROLES,
  analyzePool,
  emptyPools,
  recommendForSlots,
  slotKind,
  type PoolsByRole,
} from "../lib/champion-pool-builder";
import { type PersonalityRole } from "../lib/personality-test";
import { useI18n } from "../i18n";
import { COLORS, FONT_HEADING, cardStyle as makeCardStyle } from "../theme";

// Ported from the web app's src/components/tools/champion-pool-builder.tsx.
// The web version also shows real winrate badges from riftcompass.com's own
// crawler database — left out here since that data lives behind the site's
// DB, not Data Dragon, and this app doesn't scrape the site for it. Just
// the honest, fully-computable-offline part: tag/difficulty analysis and
// recommendations.
const STORAGE_KEY = "riftcompass-overlay:champion-pool:v1";

export function ChampionPoolBuilder() {
  const { t } = useI18n();
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const [role, setRole] = useState<PersonalityRole>("TOP");
  const [pools, setPools] = useState<PoolsByRole>(emptyPools());
  const [loaded, setLoaded] = useState(false);
  const [pendingChampion, setPendingChampion] = useState<ChampionInfo | null>(null);

  useEffect(() => {
    fetchChampionMap().then((m) => setChampions(Object.values(m.byInternalId)));
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: Partial<PoolsByRole> = JSON.parse(saved);
        const next = emptyPools();
        for (const r of POOL_ROLES) {
          next[r] = (parsed[r] ?? []).slice(0, MAX_POOL_SIZE);
        }
        setPools(next);
      }
    } catch {
      // Corrupt/unavailable storage — start fresh.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pools));
    } catch {
      // Ignore write failures.
    }
  }, [pools, loaded]);

  const championById = useMemo(() => new Map(champions.map((c) => [c.internalId, c])), [champions]);
  const currentIds = pools[role];
  const currentPool = currentIds.map((id) => championById.get(id)).filter((c): c is ChampionInfo => !!c);
  const analysis = analyzePool(currentPool);
  const isFull = currentIds.length >= MAX_POOL_SIZE;
  const alreadyIn = !!pendingChampion && currentIds.includes(pendingChampion.internalId);
  const slotRecs = isFull
    ? { core: [], flex: [], pocket: [] }
    : recommendForSlots(currentPool, champions, role);
  // Slots fill in order, so each group appears exactly while its slots
  // are the next to fill: 3 core, then 2 flex, then the pocket pick.
  // Everything recomputes from the live pool, so taking a suggestion
  // immediately refills and re-adapts the lists.
  const recGroups = [
    { id: "core" as const, show: currentIds.length < 3, items: slotRecs.core.map((r) => ({ champion: r.champion, reason: t("ChampionPoolBuilder.recommendationReason", { tag: r.missingTag }) })) },
    { id: "flex" as const, show: currentIds.length >= 3 && currentIds.length < 5, items: slotRecs.flex.map((r) => ({ champion: r.champion, reason: t("ChampionPoolBuilder.flexReason", { roles: r.extraRoles.map((x) => t(`Profile.positions.${x.toLowerCase()}`)).join(", ") }) })) },
    { id: "pocket" as const, show: currentIds.length === 5, items: slotRecs.pocket.map((r) => ({ champion: r.champion, reason: t("ChampionPoolBuilder.pocketReason", { difficulty: r.champion.difficulty }) })) },
  ].filter((g) => g.show && g.items.length > 0);

  function updatePool(updater: (ids: string[]) => string[]) {
    setPools((prev) => ({ ...prev, [role]: updater(prev[role]) }));
  }

  function handleAdd() {
    if (!pendingChampion || isFull || alreadyIn) return;
    updatePool((ids) => [...ids, pendingChampion.internalId]);
    setPendingChampion(null);
  }

  function handleAddSpecific(championId: string) {
    if (isFull || currentIds.includes(championId)) return;
    updatePool((ids) => [...ids, championId]);
  }

  function handleRemove(id: string) {
    updatePool((ids) => ids.filter((x) => x !== id));
  }

  function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    updatePool((ids) => {
      if (target < 0 || target >= ids.length) return ids;
      const next = [...ids];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handleClearRole() {
    updatePool(() => []);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {POOL_ROLES.map((r) => {
          const count = pools[r].length;
          const active = role === r;
          return (
            <button
              key={r}
              onClick={() => setRole(r)}
              style={{
                padding: "7px 14px",
                borderRadius: 999,
                border: `1px solid ${active ? COLORS.rose : COLORS.cardBorder}`,
                background: active ? `${COLORS.rose}26` : "none",
                color: active ? COLORS.rose : COLORS.text,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {t(`Profile.positions.${r.toLowerCase()}`)}
              {count > 0 ? <span style={{ color: COLORS.muted }}> ({count})</span> : null}
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(280px, 380px)", gap: 20, alignItems: "start" }}>
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>{t("ChampionPoolBuilder.poolTitle")}</h2>
          <p style={cardSubtitleStyle}>{t("ChampionPoolBuilder.poolIntro")}</p>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 14 }}>
            <div style={{ maxWidth: 280, flex: 1 }}>
              <ChampionCombobox
                champions={champions}
                value={pendingChampion}
                onChange={setPendingChampion}
                placeholder={t("Common.searchChampion")}
                noResultsLabel={t("ChampionPoolBuilder.searchNoResults")}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!pendingChampion || isFull || alreadyIn}
              style={smallButtonStyle(!pendingChampion || isFull || alreadyIn)}
            >
              {t("ChampionPoolBuilder.addButton")}
            </button>
            {isFull ? <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ChampionPoolBuilder.poolFull")}</span> : null}
            {alreadyIn ? <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ChampionPoolBuilder.alreadyInPool")}</span> : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
            {Array.from({ length: MAX_POOL_SIZE }).map((_, index) => {
              const champion = currentPool[index];
              const kind = slotKind(index);
              return (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderRadius: 10,
                    border: `1px solid ${COLORS.cardBorder}`,
                    background: `${COLORS.background}40`,
                    padding: 12,
                  }}
                >
                  <span style={{ width: 56, flexShrink: 0, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.muted }}>
                    {t(`ChampionPoolBuilder.slot.${kind}`)}
                  </span>
                  {champion ? (
                    <>
                      <img src={champion.iconUrl} alt={champion.name} style={{ width: 42, height: 42, borderRadius: 8, flexShrink: 0 }} />
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{champion.name}</span>
                        <span style={{ fontSize: 11, color: COLORS.muted }}>{champion.tags.join(" / ")}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                        <IconButton onClick={() => handleMove(index, -1)} disabled={index === 0}>
                          <CaretUp size={15} />
                        </IconButton>
                        <IconButton onClick={() => handleMove(index, 1)} disabled={index === currentPool.length - 1}>
                          <CaretDown size={15} />
                        </IconButton>
                        <IconButton onClick={() => handleRemove(champion.internalId)}>
                          <X size={15} />
                        </IconButton>
                      </div>
                    </>
                  ) : (
                    <span style={{ flex: 1, fontSize: 13, color: `${COLORS.muted}99` }}>{t("ChampionPoolBuilder.emptySlot")}</span>
                  )}
                </div>
              );
            })}
          </div>

          {currentPool.length > 0 ? (
            <button onClick={handleClearRole} style={{ ...smallButtonStyle(false), width: "fit-content", marginTop: 14 }}>
              {t("ChampionPoolBuilder.clearRole")}
            </button>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {recGroups.length > 0 ? (
            <div style={cardStyle}>
              <h2 style={cardTitleStyle}>{t("ChampionPoolBuilder.recommendationsTitle")}</h2>
              <p style={cardSubtitleStyle}>{t("ChampionPoolBuilder.recommendationsIntro")}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
                {recGroups.map((group) => (
                  <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: COLORS.muted }}>
                      {t(`ChampionPoolBuilder.recGroups.${group.id}`)}
                    </span>
                    {group.items.map((rec) => (
                      <div
                        key={rec.champion.internalId}
                        style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 10, border: `1px solid ${COLORS.cardBorder}`, background: `${COLORS.background}40`, padding: 10 }}
                      >
                        <img src={rec.champion.iconUrl} alt={rec.champion.name} style={{ width: 38, height: 38, borderRadius: 7, flexShrink: 0 }} />
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{rec.champion.name}</span>
                          <span style={{ fontSize: 11, color: COLORS.muted }}>{rec.reason}</span>
                        </div>
                        <button onClick={() => handleAddSpecific(rec.champion.internalId)} style={smallButtonStyle(false)}>
                          {t("ChampionPoolBuilder.addButton")}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {currentPool.length >= 2 ? (
            <div style={cardStyle}>
              <h2 style={cardTitleStyle}>{t("ChampionPoolBuilder.analysisTitle")}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ChampionPoolBuilder.classesLabel")}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {analysis.uniqueTags.map((tag) => (
                    <span key={tag} style={{ borderRadius: 999, border: `1px solid ${COLORS.cardBorder}`, background: `${COLORS.card}99`, padding: "4px 10px", fontSize: 11 }}>
                      {tag}
                    </span>
                  ))}
                </div>
                {analysis.dominantTag ? (
                  <p style={{ fontSize: 12, color: COLORS.gold, marginTop: 4 }}>
                    {t("ChampionPoolBuilder.dominantTagWarning", { tag: analysis.dominantTag })}
                  </p>
                ) : null}
              </div>

              {analysis.averageDifficulty !== null ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                  <span style={{ width: 100, flexShrink: 0, fontSize: 12, color: COLORS.muted }}>{t("ChampionPoolBuilder.difficultyLabel")}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 999, background: `${COLORS.background}99`, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${analysis.averageDifficulty * 10}%`, borderRadius: 999, background: COLORS.rose }} />
                  </div>
                  <span style={{ width: 32, flexShrink: 0, textAlign: "right", fontSize: 12, color: COLORS.muted }}>
                    {analysis.averageDifficulty.toFixed(1)}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function IconButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 26,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "none",
        background: "none",
        color: disabled ? `${COLORS.muted}66` : COLORS.muted,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function smallButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "7px 14px",
    borderRadius: 6,
    border: `1px solid ${COLORS.cardBorder}`,
    background: "none",
    color: disabled ? COLORS.muted : COLORS.text,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const cardStyle = makeCardStyle({ borderRadius: 10, padding: 18 });

const cardTitleStyle: React.CSSProperties = {
  fontFamily: FONT_HEADING,
  fontSize: 17,
  fontWeight: 400,
  margin: 0,
};

const cardSubtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: COLORS.muted,
  marginTop: 6,
};
