import { useMemo, useState } from "react";
import { RotateCcw, Undo2 } from "lucide-react";
import {
  campXpAtLevel,
  definedCampLevels,
  JUNGLE_CAMPS,
  JUNGLE_CLEAR_ORDER,
  JUNGLE_XP_LEVELS,
  simulateRoute,
  SMITE_STAGES,
  smiteStageForTreats,
  type JungleCampId,
  type JungleXpLevel,
  type RouteEntry,
} from "../lib/jungle-xp";
import { useI18n } from "../i18n";
import { COLORS, FONT_HEADING } from "../theme";

// One accent per clear, used for the reference table's column groups and
// the clears legend below it (mirrors the color-coded design of the
// source table on maurogarih.com).
const CLEAR_COLORS = ["#f0a33a", "#4d9fe8", "#9d6bf5", "#3ecf8e"];

function clearIndexForLevel(level: JungleXpLevel): number | null {
  const index = JUNGLE_CLEAR_ORDER.findIndex((c) => c.levels.includes(level));
  return index === -1 ? null : index;
}

export function JungleXpCalculator() {
  const { t } = useI18n();
  const [route, setRoute] = useState<RouteEntry[]>([]);
  // Per-camp fixed camp level; a camp not in the map follows the
  // jungler's current level ("auto").
  const [campLevels, setCampLevels] = useState<Partial<Record<JungleCampId, JungleXpLevel>>>({});
  // Hovered table position: row and column light up, their intersection
  // darker, as if the two tints stacked.
  const [hover, setHover] = useState<{ row: number | null; col: JungleXpLevel | null } | null>(null);

  const result = useMemo(() => simulateRoute(route), [route]);
  const campById = useMemo(() => new Map(JUNGLE_CAMPS.map((c) => [c.id, c])), []);

  const progress =
    result.toNext === null ? 1 : result.intoLevel / (result.intoLevel + result.toNext);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      {/* Route simulator */}
      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>{t("JungleXpCalculator.simTitle")}</span>
        <span style={{ fontSize: 13, color: COLORS.muted }}>{t("JungleXpCalculator.simSubtitle")}</span>
        <span style={{ fontSize: 12, color: COLORS.gold }}>{t("JungleXpCalculator.firstCampRule")}</span>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            borderRadius: 14,
            border: `1px solid ${COLORS.cardBorder}`,
            background: `${COLORS.card}66`,
            padding: 18,
            marginTop: 4,
          }}
        >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: 8 }}>
          {JUNGLE_CAMPS.map((camp) => {
            const override = campLevels[camp.id];
            const xp = override !== undefined ? camp.xpByLevel[override] : campXpAtLevel(camp, result.level);
            const disabled = xp === null;
            return (
              <div
                key={camp.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                  height: "100%",
                  boxSizing: "border-box",
                  borderRadius: 12,
                  background: `${COLORS.card}66`,
                  padding: "12px 8px 10px",
                }}
              >
                <button
                  onClick={() => !disabled && setRoute((prev) => [...prev, { campId: camp.id, campLevel: override }])}
                  disabled={disabled}
                  title={t(`JungleXpCalculator.camps.${camp.id}`)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 5,
                    border: "none",
                    background: "none",
                    padding: 0,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.4 : 1,
                    color: COLORS.text,
                  }}
                >
                  <img src={camp.iconUrl} alt="" style={{ width: 44, height: 44, borderRadius: 9 }} />
                  <span
                    style={{
                      fontSize: 11,
                      textAlign: "center",
                      lineHeight: 1.2,
                      minHeight: 27,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {t(`JungleXpCalculator.camps.${camp.id}`)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: disabled ? COLORS.muted : COLORS.gold }}>
                    {disabled ? "—" : `+${xp}`}
                  </span>
                </button>
                <select
                  value={override ?? "auto"}
                  onChange={(e) =>
                    setCampLevels((prev) => {
                      const next = { ...prev };
                      if (e.target.value === "auto") delete next[camp.id];
                      else next[camp.id] = Number(e.target.value) as JungleXpLevel;
                      return next;
                    })
                  }
                  title={t("JungleXpCalculator.campLevelLabel")}
                  style={{
                    width: "100%",
                    marginTop: "auto",
                    background: COLORS.background,
                    color: override !== undefined ? COLORS.rose : COLORS.muted,
                    border: `1px solid ${override !== undefined ? `${COLORS.rose}66` : COLORS.cardBorder}`,
                    borderRadius: 7,
                    padding: "3px 4px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  <option value="auto">{t("JungleXpCalculator.campLevelAuto")}</option>
                  {definedCampLevels(camp).map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {t("JungleXpCalculator.level", { level: lvl })} · {camp.xpByLevel[lvl]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 220px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
                {t("JungleXpCalculator.routeLabel")}
              </span>
              {route.length > 0 && (
                <>
                  <button onClick={() => setRoute((prev) => prev.slice(0, -1))} style={miniButtonStyle} title={t("JungleXpCalculator.undo")}>
                    <Undo2 size={12} />
                    {t("JungleXpCalculator.undo")}
                  </button>
                  <button onClick={() => setRoute([])} style={miniButtonStyle} title={t("JungleXpCalculator.reset")}>
                    <RotateCcw size={12} />
                    {t("JungleXpCalculator.reset")}
                  </button>
                </>
              )}
            </div>
            {route.length === 0 ? (
              <span style={{ fontSize: 13, color: `${COLORS.muted}bb` }}>{t("JungleXpCalculator.routeEmpty")}</span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {result.steps.map((step, i) => {
                  const camp = campById.get(step.campId)!;
                  return (
                    <button
                      key={`${step.campId}-${i}`}
                      onClick={() => setRoute((prev) => prev.filter((_, idx) => idx !== i))}
                      title={t("JungleXpCalculator.removeStep")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        borderRadius: 999,
                        border: `1px solid ${COLORS.cardBorder}`,
                        background: `${COLORS.background}66`,
                        padding: "4px 10px 4px 4px",
                        cursor: "pointer",
                        color: COLORS.text,
                      }}
                    >
                      <span style={{ fontSize: 10, color: COLORS.muted, width: 14, textAlign: "center" }}>{i + 1}</span>
                      <img src={camp.iconUrl} alt="" style={{ width: 22, height: 22, borderRadius: 5 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.gold }}>+{step.xpGained}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontFamily: FONT_HEADING, fontSize: 30, color: COLORS.gold, lineHeight: 1 }}>
              {t("JungleXpCalculator.levelReached", { level: result.level })}
            </span>
            <div style={{ height: 8, borderRadius: 999, background: `${COLORS.background}99`, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, borderRadius: 999, background: COLORS.gold }} />
            </div>
            <span style={{ fontSize: 12, color: COLORS.muted }}>
              {result.toNext === null
                ? t("JungleXpCalculator.simMaxed")
                : t("JungleXpCalculator.toNextLevel", { xp: result.toNext, level: result.level + 1 })}
            </span>
            <span style={{ fontSize: 12, color: COLORS.muted }}>
              {t("JungleXpCalculator.xpTotal", { xp: result.totalXp })}
            </span>
          </div>
        </div>
        </div>
      </div>

      {/* Smite evolutions: one treat per cleared camp, so the icon and
          active stage follow the simulated route like they do in game. */}
      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>{t("JungleXpCalculator.smiteTitle")}</span>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          {(() => {
            const treats = route.length;
            const current = smiteStageForTreats(treats);
            return (
              <>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <img
                    src={current.iconUrl}
                    alt=""
                    style={{ width: 48, height: 48, borderRadius: 9, border: `1px solid ${COLORS.gold}55` }}
                  />
                  <span style={{ fontSize: 11, color: COLORS.muted }}>
                    {t("JungleXpCalculator.smiteTreatsCount", { n: treats })}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  {SMITE_STAGES.map((stage) => {
                    const active = stage.id === current.id;
                    return (
                      <div
                        key={stage.id}
                        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", opacity: active ? 1 : 0.55 }}
                      >
                        <img
                          src={stage.iconUrl}
                          alt=""
                          style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${active ? `${COLORS.gold}88` : COLORS.cardBorder}`, flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 600, color: active ? COLORS.gold : COLORS.text }}>
                          {t(`JungleXpCalculator.smiteStages.${stage.id}`)}
                        </span>
                        <span style={{ fontSize: 12, color: COLORS.muted }}>
                          {stage.treats === 0
                            ? t("JungleXpCalculator.smiteBaseTreats")
                            : t("JungleXpCalculator.smiteTreats", { n: stage.treats })}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.gold }}>
                          {t("JungleXpCalculator.smiteDamage", { dmg: stage.damage })}
                        </span>
                        {stage.hitsNearby && (
                          <span style={{ fontSize: 12, color: COLORS.muted }}>{t("JungleXpCalculator.smiteNearby")}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Reference table */}
      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>{t("JungleXpCalculator.tableTitle")}</span>

        <div
          style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${COLORS.cardBorder}` }}
          onMouseLeave={() => setHover(null)}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "left", paddingLeft: 14 }}>{t("JungleXpCalculator.campHeader")}</th>
                {JUNGLE_XP_LEVELS.map((lvl) => {
                  const clearIdx = clearIndexForLevel(lvl);
                  return (
                    <th
                      key={lvl}
                      onMouseEnter={() => setHover({ row: null, col: lvl })}
                      style={{
                        ...thStyle,
                        color: clearIdx !== null ? CLEAR_COLORS[clearIdx] : COLORS.muted,
                        background: hover?.col === lvl ? `${COLORS.rose}14` : undefined,
                      }}
                    >
                      {t("JungleXpCalculator.level", { level: lvl })}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {JUNGLE_CAMPS.map((camp, rowIdx) => (
                <tr key={camp.id} style={{ borderTop: rowIdx > 0 ? `1px solid ${COLORS.cardBorder}` : "none" }}>
                  <td
                    onMouseEnter={() => setHover({ row: rowIdx, col: null })}
                    style={{
                      padding: "9px 14px",
                      whiteSpace: "nowrap",
                      background: hover?.row === rowIdx ? `${COLORS.rose}14` : undefined,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                      <img src={camp.iconUrl} alt="" style={{ width: 26, height: 26, borderRadius: 6 }} />
                      <span>{t(`JungleXpCalculator.camps.${camp.id}`)}</span>
                      {camp.optimalPath && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: COLORS.gold, border: `1px solid ${COLORS.gold}66`, borderRadius: 999, padding: "1px 6px" }}>
                          {t("JungleXpCalculator.optimalPath")}
                        </span>
                      )}
                    </span>
                  </td>
                  {JUNGLE_XP_LEVELS.map((lvl) => {
                    const xp = camp.xpByLevel[lvl];
                    const inRow = hover?.row === rowIdx;
                    const inCol = hover?.col === lvl;
                    return (
                      <td
                        key={lvl}
                        onMouseEnter={() => setHover({ row: rowIdx, col: lvl })}
                        style={{
                          padding: "9px 10px",
                          textAlign: "center",
                          color: xp === null ? `${COLORS.muted}88` : COLORS.text,
                          fontWeight: xp === null ? 400 : 600,
                          background: inRow && inCol ? `${COLORS.rose}33` : inRow || inCol ? `${COLORS.rose}14` : undefined,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {xp ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 26px" }}>
          {JUNGLE_CLEAR_ORDER.map((clear, i) => (
            <span key={clear.clear} style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: CLEAR_COLORS[i], alignSelf: "center" }} />
              <span style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: COLORS.muted }}>
                {t(`JungleXpCalculator.clears.c${clear.clear}`)}
              </span>
              <span style={{ fontFamily: FONT_HEADING, fontSize: 15, color: CLEAR_COLORS[i] }}>
                {clear.levels.map((lvl) => t("JungleXpCalculator.level", { level: lvl })).join(" – ")}
              </span>
            </span>
          ))}
        </div>

        <p style={{ fontSize: 11, color: `${COLORS.muted}bb`, margin: 0, lineHeight: 1.6 }}>{t("JungleXpCalculator.footnote")}</p>
      </div>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: FONT_HEADING,
  fontSize: 13,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: COLORS.muted,
};

const thStyle: React.CSSProperties = {
  padding: "10px 10px",
  fontFamily: FONT_HEADING,
  fontSize: 11,
  fontWeight: 400,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  textAlign: "center",
  color: COLORS.muted,
  borderBottom: `1px solid ${COLORS.cardBorder}`,
  whiteSpace: "nowrap",
};

const miniButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 9px",
  borderRadius: 999,
  border: `1px solid ${COLORS.cardBorder}`,
  background: "none",
  color: COLORS.muted,
  fontSize: 11,
  cursor: "pointer",
};
