import { useI18n } from "../i18n";
import { COLORS, FONT_HEADING } from "../theme";

// CommunityDragon HUD portraits — same asset family the Map Editor's
// minion tool already uses.
const MELEE_ICON = "https://raw.communitydragon.org/latest/game/assets/characters/sru_chaosminionmelee/hud/bluemelee_square.png";
const CASTER_ICON = "https://raw.communitydragon.org/latest/game/assets/characters/sru_chaosminionranged/hud/bluerange_square.png";
const CANNON_ICON = "https://raw.communitydragon.org/latest/game/assets/characters/sru_chaosminionsiege/hud/bluemechcannon_square.png";

interface WaveComposition {
  melee: number;
  caster: number;
  cannon: number;
  gold: string;
}

// Wave economy per game-time bracket, from the League Wiki's minion page
// (season 2026): waves every 30s from 1:05, speeding up to 25s at 14:00
// and 20s at 30:00; the cannon joins every 3rd wave, then every 2nd from
// 14:00 and every wave from 25:00, REPLACING a melee minion in its wave.
// Melee 20g, caster 14g; cannon gold scales with game time (50 → 69).
const PHASES: {
  range: string;
  cadence: number;
  cannonEvery: number;
  normal: WaveComposition | null;
  cannonWave: WaveComposition;
}[] = [
  {
    range: "1:05 – 14:00",
    cadence: 30,
    cannonEvery: 3,
    normal: { melee: 3, caster: 3, cannon: 0, gold: "102" },
    cannonWave: { melee: 2, caster: 3, cannon: 1, gold: "132 – 141" },
  },
  {
    range: "14:00 – 25:00",
    cadence: 25,
    cannonEvery: 2,
    normal: { melee: 3, caster: 3, cannon: 0, gold: "102" },
    cannonWave: { melee: 2, caster: 3, cannon: 1, gold: "141 – 148" },
  },
  {
    range: "25:00 – 30:00",
    cadence: 25,
    cannonEvery: 1,
    normal: null,
    cannonWave: { melee: 2, caster: 3, cannon: 1, gold: "≈ 148" },
  },
  {
    range: "30:00+",
    cadence: 20,
    cannonEvery: 1,
    normal: null,
    cannonWave: { melee: 2, caster: 2, cannon: 1, gold: "≈ 137" },
  },
];

function MinionIcons({ composition }: { composition: WaveComposition }) {
  const icons = [
    ...Array.from({ length: composition.melee }, (_, i) => ({ key: `m${i}`, src: MELEE_ICON })),
    ...Array.from({ length: composition.caster }, (_, i) => ({ key: `c${i}`, src: CASTER_ICON })),
    ...Array.from({ length: composition.cannon }, (_, i) => ({ key: `s${i}`, src: CANNON_ICON })),
  ];
  return (
    <span style={{ display: "inline-flex", gap: 2, verticalAlign: "middle" }}>
      {icons.map((icon) => (
        <img
          key={icon.key}
          src={icon.src}
          alt=""
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            borderRadius: 4,
            border: `1px solid ${icon.src === CANNON_ICON ? `${COLORS.gold}88` : COLORS.cardBorder}`,
          }}
        />
      ))}
    </span>
  );
}

export function WaveTimer() {
  const { t } = useI18n();

  const minionCards = [
    { icon: MELEE_ICON, name: t("WaveTimer.melee"), gold: "20", highlight: false, note: null },
    { icon: CASTER_ICON, name: t("WaveTimer.caster"), gold: "14", highlight: false, note: null },
    { icon: CANNON_ICON, name: t("WaveTimer.cannon"), gold: "50 – 69", highlight: true, note: t("WaveTimer.cannonScales") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 860 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {minionCards.map((card) => (
          <div
            key={card.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderRadius: 14,
              border: `1px solid ${card.highlight ? `${COLORS.gold}55` : COLORS.cardBorder}`,
              background: card.highlight ? `${COLORS.gold}0d` : `${COLORS.card}99`,
              padding: "14px 16px",
            }}
          >
            <img
              src={card.icon}
              alt={card.name}
              style={{ width: 52, height: 52, borderRadius: 10, border: `1px solid ${COLORS.cardBorder}`, flexShrink: 0 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: COLORS.muted }}>{card.name}</span>
              <span style={{ fontFamily: FONT_HEADING, fontSize: 20, color: COLORS.gold }}>
                {t("WaveTimer.goldAmount", { amount: card.gold })}
              </span>
              {card.note && <span style={{ fontSize: 11, color: COLORS.muted }}>{card.note}</span>}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          borderRadius: 14,
          border: `1px solid ${COLORS.cardBorder}`,
          background: `${COLORS.card}66`,
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {[
                t("WaveTimer.phaseHeader"),
                t("WaveTimer.cadenceHeader"),
                t("WaveTimer.cannonHeader"),
                t("WaveTimer.normalHeader"),
                t("WaveTimer.cannonWaveHeader"),
              ].map((header) => (
                <th
                  key={header}
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontFamily: FONT_HEADING,
                    fontSize: 11,
                    fontWeight: 400,
                    letterSpacing: 1.1,
                    textTransform: "uppercase",
                    color: COLORS.muted,
                    borderBottom: `1px solid ${COLORS.cardBorder}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PHASES.map((phase, i) => (
              <tr key={phase.range} style={{ borderBottom: i < PHASES.length - 1 ? `1px solid ${COLORS.cardBorder}` : "none" }}>
                <td style={{ padding: "14px 16px", fontFamily: FONT_HEADING, fontSize: 15, color: COLORS.text, whiteSpace: "nowrap" }}>
                  {phase.range}
                </td>
                <td style={{ padding: "14px 16px", color: COLORS.text, whiteSpace: "nowrap" }}>
                  {t("WaveTimer.seconds", { n: phase.cadence })}
                </td>
                <td style={{ padding: "14px 16px", color: COLORS.text, whiteSpace: "nowrap" }}>
                  {phase.cannonEvery === 1 ? t("WaveTimer.everyWave") : t("WaveTimer.everyN", { n: phase.cannonEvery })}
                </td>
                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                  {phase.normal ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <MinionIcons composition={phase.normal} />
                      <span style={{ fontWeight: 700, color: COLORS.gold }}>{phase.normal.gold}</span>
                    </span>
                  ) : (
                    <span style={{ color: COLORS.muted }}>{t("WaveTimer.allCannon")}</span>
                  )}
                </td>
                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <MinionIcons composition={phase.cannonWave} />
                    <span style={{ fontWeight: 700, color: COLORS.gold }}>{phase.cannonWave.gold}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontFamily: FONT_HEADING, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", color: COLORS.muted }}>
          {t("WaveTimer.notesTitle")}
        </span>
        {[t("WaveTimer.noteCannon"), t("WaveTimer.noteLanes")].map((note) => (
          <span key={note} style={{ fontSize: 13, color: COLORS.text, lineHeight: 1.5 }}>
            {note}
          </span>
        ))}
      </div>
    </div>
  );
}
