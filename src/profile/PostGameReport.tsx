// Dedicated "how did that game go" coaching screen, shown automatically
// from MainView.tsx right after a match ends — not just a jump to the
// profile screen. Reuses the same per-match scoring already computed for
// the profile's match history (summarizeParticipantPerformance in
// lib/profile-analysis.ts) but surfaces the full per-axis breakdown as a
// report instead of a single compact note.
import { useEffect, useState } from "react";
import { championSquareUrl } from "../ddragon";
import { useI18n } from "../i18n";
import { FOCUS_THRESHOLD, STRENGTH_THRESHOLD, summarizeMatchPerformance, type SkillAxis } from "../lib/profile-analysis";
import type { RecentMatchSummary } from "../lib/profile-types";
import type { LcuIdentity } from "../riftcompass";
import { COLORS, TYPE, cardStyle as makeCardStyle } from "../theme";
import { fetchProfile, type ProfileTarget } from "./ProfileShared";

const cardStyle = makeCardStyle();

// gameCreation (what the web API reports as playedAt) is stamped around
// when the loading screen starts, which can land a few seconds BEFORE this
// app's own LcuPhase listener sees "InProgress" — a strict `>=` comparison
// against the captured start time would reject the very match we're
// waiting for. A 5-minute margin absorbs that gap while still reliably
// excluding any real previous match (at least one full game duration
// earlier).
const FRESHNESS_MARGIN_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 5000;

type Sentiment = "good" | "neutral" | "bad";

function axisSentiment(value: number): Sentiment {
  if (value >= STRENGTH_THRESHOLD) return "good";
  if (value < FOCUS_THRESHOLD) return "bad";
  return "neutral";
}

function sentimentColor(s: Sentiment): string {
  if (s === "good") return COLORS.goodMild;
  if (s === "bad") return COLORS.badMild;
  return COLORS.muted;
}

const AXIS_ORDER: SkillAxis[] = ["farm", "vision", "kda", "killParticipation", "damage"];

export function PostGameReport({
  identity,
  gameStartedAt,
  onOpenProfile,
}: {
  identity: LcuIdentity;
  gameStartedAt: number;
  onOpenProfile: (target: ProfileTarget) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"loading" | "ready" | "timeout">("loading");
  const [match, setMatch] = useState<RecentMatchSummary | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [ddragonVersion, setDdragonVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    async function poll() {
      attempt += 1;
      let data = await fetchProfile(identity.platform, identity.gameName, identity.tagLine, { force: attempt === 1 });
      if ("error" in data && data.retryAfterSeconds !== undefined) {
        // The force-refresh cooldown was already spent recently (e.g. the
        // player manually refreshed right before this game) — a plain
        // fetch still returns a reasonably fresh cache instead of failing
        // the whole report over a cooldown that isn't really an error.
        data = await fetchProfile(identity.platform, identity.gameName, identity.tagLine);
      }
      if (cancelled) return;

      if (!("error" in data)) {
        const top = data.profile.recentMatches[0];
        if (top && top.playedAt >= gameStartedAt - FRESHNESS_MARGIN_MS) {
          setMatch(top);
          setTier(data.rankTier);
          setDdragonVersion(data.ddragonVersion);
          setStatus("ready");
          return;
        }
      }

      if (attempt >= MAX_ATTEMPTS) {
        setStatus("timeout");
        return;
      }
      setTimeout(poll, RETRY_DELAY_MS);
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [identity.platform, identity.gameName, identity.tagLine, gameStartedAt]);

  function openFullProfile() {
    onOpenProfile({ platform: identity.platform, gameName: identity.gameName, tagLine: identity.tagLine });
  }

  if (status === "loading") {
    return (
      <div style={cardStyle}>
        <p style={{ margin: 0, color: COLORS.muted, fontSize: TYPE.body }}>{t("PostGameReport.loading")}</p>
      </div>
    );
  }

  if (status === "timeout" || !match) {
    return (
      <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ margin: 0, color: COLORS.muted, fontSize: TYPE.body }}>{t("PostGameReport.timeout")}</p>
        <button
          onClick={openFullProfile}
          style={{
            alignSelf: "flex-start",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            background: `${COLORS.rose}26`,
            color: COLORS.rose,
          }}
        >
          {t("PostGameReport.openProfile")}
        </button>
      </div>
    );
  }

  const note = summarizeMatchPerformance(match, tier);
  const pointByAxis = new Map(note.points.map((p) => [p.axis, p.value]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 14 }}>
        {ddragonVersion ? (
          <img
            src={championSquareUrl(ddragonVersion, match.championName)}
            alt={match.championName}
            style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0 }}
          />
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <span style={{ fontSize: TYPE.subheading, fontWeight: 700, color: match.win ? COLORS.goodMild : COLORS.badMild }}>
            {match.win ? t("PostGameReport.win") : t("PostGameReport.loss")}
          </span>
          <span style={{ fontSize: 12, color: COLORS.muted }}>
            {match.kills}/{match.deaths}/{match.assists} · {Math.round(match.durationSeconds / 60)}m
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ fontSize: TYPE.heading, fontWeight: 700, color: sentimentColor(note.scoreSentiment) }}>{note.score.toFixed(1)}</span>
          <span style={{ fontSize: 11, color: COLORS.muted }}>{t("PostGameReport.scoreLabel")}</span>
        </div>
      </div>

      <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>{t("PostGameReport.breakdownTitle")}</span>
        {AXIS_ORDER.map((axis) => {
          const value = pointByAxis.get(axis) ?? 0;
          const sentiment = axisSentiment(value);
          const color = sentimentColor(sentiment);
          const barWidth = Math.min(100, (value / 150) * 100);
          return (
            <div key={axis} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: COLORS.text }}>{t(`ProfileSearch.axis.${axis}`)}</span>
                <span style={{ color, fontWeight: 700 }}>{value}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: COLORS.background, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${barWidth}%`, background: color, borderRadius: 999 }} />
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={openFullProfile}
        style={{
          alignSelf: "flex-start",
          border: "none",
          borderRadius: 8,
          padding: "8px 14px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          background: `${COLORS.rose}26`,
          color: COLORS.rose,
        }}
      >
        {t("PostGameReport.openProfile")}
      </button>
    </div>
  );
}
