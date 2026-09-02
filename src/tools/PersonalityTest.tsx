import { useEffect, useMemo, useState } from "react";
import { fetchChampionMap, toDDragonId, type ChampionInfo } from "../ddragon";
import {
  PERSONALITY_QUESTIONS,
  championsForRole,
  computeAxisScores,
  matchChampions,
  type Answer,
  type PersonalityAxis,
  type PersonalityRole,
} from "../lib/personality-test";
import { positionIconUrl } from "../lib/profile-analysis";
import { useI18n } from "../i18n";
import { COLORS, FONT_HEADING, cardStyle as makeCardStyle } from "../theme";
import { API_BASE_URL } from "../shared/api";

// Real winrate from RiftCompass's own crawler, same public endpoint
// MetaTierList.tsx already uses — shown as extra context next to each
// recommendation, matching the web app's own personality-test.tsx change.
// Matching itself stays pure personality fit; this never affects it.
interface ChampionWinrate {
  championName: string;
  role: string;
  games: number;
  winRate: number;
}

// Ported from the web app's src/components/tools/personality-test.tsx — same
// 12-question quiz, same real-stat distance matching, this app's own UI.
const LIKERT_VALUES: Exclude<Answer, null>[] = [2, 1, 0, -1, -2];
const AXES: PersonalityAxis[] = ["aggression", "resilience", "spellPower", "complexity"];
const ROLES: PersonalityRole[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

// Same draft-survives-a-remount fix as this app's Map Editor/Gold
// Calculator/Champion Pool Builder/Tier List Builder — here the remount
// trigger is MainView's tool-switch key (see its comment), not a locale
// change, but the effect is identical: leaving this screen and coming
// back used to reset role/step/answers to empty, losing an in-progress
// quiz. Same key shape as the web's own personality-test.tsx.
const QUIZ_DRAFT_KEY = "riftcompass-overlay:personality-test:draft:v1";

export function PersonalityTest() {
  const { t } = useI18n();
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const [role, setRole] = useState<PersonalityRole | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    fetchChampionMap().then((m) => setChampions(Object.values(m.byInternalId)));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUIZ_DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as { role?: PersonalityRole; step?: number; answers?: Record<string, Answer> };
        if (draft.role) {
          setRole(draft.role);
          setStep(draft.step ?? 0);
          setAnswers(draft.answers ?? {});
        }
      }
    } catch {
      // Corrupt/unavailable storage — start fresh.
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      if (role) {
        localStorage.setItem(QUIZ_DRAFT_KEY, JSON.stringify({ role, step, answers }));
      } else {
        localStorage.removeItem(QUIZ_DRAFT_KEY);
      }
    } catch {
      // Ignore write failures.
    }
  }, [role, step, answers, restored]);

  const total = PERSONALITY_QUESTIONS.length;
  const isResults = role !== null && step >= total;

  function handleAnswer(value: Answer) {
    const question = PERSONALITY_QUESTIONS[step];
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
    setStep((s) => s + 1);
  }

  function handleBack() {
    if (step === 0) {
      setRole(null);
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  }

  function handleRestart() {
    setRole(null);
    setStep(0);
    setAnswers({});
  }

  if (role === null) {
    return (
      <div style={{ ...cardStyle, maxWidth: 620, margin: "0 auto", padding: 28 }}>
        <h2 style={cardTitleStyle}>{t("PersonalityTest.roleStepTitle")}</h2>
        <p style={cardSubtitleStyle}>{t("PersonalityTest.roleStepSubtitle")}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(140px, 1fr))", gap: 10, marginTop: 18 }}>
          {ROLES.map((r) => {
            const iconUrl = positionIconUrl(r);
            return (
              <button
                key={r}
                onClick={() => setRole(r)}
                style={{ ...optionButtonStyle, display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", fontSize: 14 }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 30,
                    flexShrink: 0,
                    borderRadius: 6,
                    background: `${COLORS.background}99`,
                  }}
                >
                  {iconUrl ? <img src={iconUrl} alt="" style={{ width: 18, height: 18 }} /> : null}
                </span>
                {t(`Profile.positions.${r.toLowerCase()}`)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (isResults) {
    return <Results role={role} answers={answers} champions={champions} onRestart={handleRestart} />;
  }

  const question = PERSONALITY_QUESTIONS[step];

  return (
    <div style={{ ...cardStyle, maxWidth: 620, margin: "0 auto", padding: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>{t("PersonalityTest.progress", { current: step + 1, total })}</span>
        <div style={{ height: 4, borderRadius: 999, background: `${COLORS.background}99`, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${((step + 1) / total) * 100}%`, borderRadius: 999, background: COLORS.rose, transition: "width 200ms" }} />
        </div>
      </div>
      <h2 style={{ ...cardTitleStyle, marginTop: 16 }}>{t(`PersonalityTest.questions.${question.id}`)}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
        {LIKERT_VALUES.map((value) => (
          <button key={value} onClick={() => handleAnswer(value)} style={{ ...optionButtonStyle, textAlign: "left", padding: "13px 16px" }}>
            {t(`PersonalityTest.likert.${value}`)}
          </button>
        ))}
        <button
          onClick={handleBack}
          style={{ alignSelf: "flex-start", marginTop: 6, background: "none", border: "none", color: COLORS.muted, fontSize: 12, cursor: "pointer", padding: 0 }}
        >
          {t("PersonalityTest.back")}
        </button>
      </div>
    </div>
  );
}

function Results({
  role,
  answers,
  champions,
  onRestart,
}: {
  role: PersonalityRole;
  answers: Record<string, Answer>;
  champions: ChampionInfo[];
  onRestart: () => void;
}) {
  const { t } = useI18n();
  const scores = computeAxisScores(answers);
  const roleChampions = useMemo(() => championsForRole(champions, role), [champions, role]);
  const matches = useMemo(() => matchChampions(scores, roleChampions).slice(0, 5), [scores, roleChampions]);

  const [winrates, setWinrates] = useState<ChampionWinrate[]>([]);
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/champion-winrates`)
      .then((r) => r.json())
      .then((data: { winrates: ChampionWinrate[] }) => setWinrates(data.winrates ?? []))
      .catch(() => setWinrates([]));
  }, []);
  const winrateByChampion = useMemo(
    () => new Map(winrates.filter((w) => w.role === role).map((w) => [toDDragonId(w.championName), w])),
    [winrates, role],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={cardStyle}>
        <h2 style={cardTitleStyle}>{t("PersonalityTest.yourStyleTitle")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {AXES.map((axis) => (
            <div key={axis} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 100, flexShrink: 0, fontSize: 13, color: COLORS.muted }}>{t(`PersonalityTest.axis.${axis}`)}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 999, background: `${COLORS.background}99`, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${scores[axis] * 10}%`, borderRadius: 999, background: COLORS.rose }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={cardTitleStyle}>{t("PersonalityTest.resultsTitle")}</h2>
        <p style={cardSubtitleStyle}>{t("PersonalityTest.resultsSubtitle", { role: t(`Profile.positions.${role.toLowerCase()}`) })}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(180px, 1fr))", gap: 8, marginTop: 12 }}>
          {matches.map((m, i) => (
            <div
              key={m.champion.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                borderRadius: 8,
                border: `1px solid ${i === 0 ? `${COLORS.gold}66` : COLORS.cardBorder}`,
                background: i === 0 ? `${COLORS.gold}0d` : `${COLORS.background}40`,
                padding: 10,
                gridColumn: i === 0 ? "1 / -1" : undefined,
              }}
            >
              <span style={{ width: 18, flexShrink: 0, fontFamily: FONT_HEADING, fontSize: i === 0 ? 18 : 15, color: i === 0 ? COLORS.gold : COLORS.muted }}>
                {i + 1}
              </span>
              <img
                src={m.champion.iconUrl}
                alt={m.champion.name}
                style={{
                  width: i === 0 ? 48 : 40,
                  height: i === 0 ? 48 : 40,
                  borderRadius: 6,
                  flexShrink: 0,
                  border: `${i === 0 ? 2 : 1}px solid ${i === 0 ? `${COLORS.gold}80` : COLORS.cardBorder}`,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{m.champion.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLORS.muted }}>
                  {m.champion.tags.join(" / ")}
                  <RealWinrateBadge winrate={winrateByChampion.get(m.champion.internalId)} t={t} />
                </span>
              </div>
              <span style={{ marginLeft: "auto", flexShrink: 0, fontFamily: FONT_HEADING, fontSize: i === 0 ? 18 : 15, color: i === 0 ? COLORS.gold : COLORS.rose }}>
                {m.matchPercent}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onRestart} style={{ ...optionButtonStyle, width: "fit-content" }}>
        {t("PersonalityTest.retake")}
      </button>
    </div>
  );
}

function RealWinrateBadge({
  winrate,
  t,
}: {
  winrate: ChampionWinrate | undefined;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (!winrate) return null;
  return (
    <span
      style={{
        flexShrink: 0,
        borderRadius: 999,
        padding: "1px 5px",
        fontSize: 10,
        fontWeight: 400,
        color: COLORS.rose,
        background: `${COLORS.rose}1a`,
      }}
      title={t("PersonalityTest.realWinrateTooltip")}
    >
      {t("PersonalityTest.realWinrate", { rate: Math.round(winrate.winRate * 100), games: winrate.games })}
    </span>
  );
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

const optionButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: `1px solid ${COLORS.cardBorder}`,
  background: "none",
  color: COLORS.text,
  fontSize: 13,
  cursor: "pointer",
};
