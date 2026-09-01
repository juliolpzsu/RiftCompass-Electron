import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, Route, ShieldAlert, Swords, X, type LucideIcon } from "lucide-react";
import { ChampionSplashAccent } from "../ChampionSplashAccent";
import { COLORS, FONT_HEADING, inputStyle } from "../theme";
import { useI18n } from "../i18n";
import { PLATFORM_LABELS, formatTierRank } from "../lib/rank-lp";
import {
  computeHeadToHead,
  computeRoadmap,
  computeRoleBreakdown,
  computeSkillRadar,
  positionIconUrl,
  rankEmblemUrl,
  RANKED_SOLO_QUEUE_ID,
  RANKED_FLEX_QUEUE_ID,
  type HeadToHeadStat,
  type RoadmapMetric,
  type RoadmapNode,
  type RoleStats,
} from "../lib/profile-analysis";
import type { ProfileApiResponse, RecentMatchSummary, RiotLeagueEntry } from "../lib/profile-types";
import type { SavedProfileWithRank } from "../riftcompass";
import {
  PLATFORMS,
  parseRiotId,
  type FetchProfileError,
  fetchProfile,
  errorMessageKey,
  type ProfileTarget,
  useSavedProfiles,
  DropdownMenu,
  dropdownOptionStyle,
  CompareSavedProfilePicker,
  AXIS_LABEL_KEY,
  cardStyle,
  selectStyle,
  secondaryButtonStyle,
} from "./ProfileShared";

// The duo/squad compare view: a standalone entry point (ProfileCompareEntry,
// up to 5 search slots) and CompareBlock, the inline "Comparar con" popover
// ProfileDetail.tsx opens from a single profile's own header — both end up
// at the same real head-to-head/roadmap/skill comparison below.

// Standalone compare entry point: up to five search slots (a full team),
// compared side by side once at least two are filled.
const MAX_COMPARE_PLAYERS = 5;

// The 3 real sections the results screen renders once you compare
// (head-to-head + skill overview, shared weaknesses, roadmap comparison) —
// surfaced here as a preview so the empty-state screen pitches the tool
// instead of a lone form on an otherwise blank page. Same pattern as the
// web app's /duo page — see RiftCompass-Web's duo/page.tsx.
const COMPARE_PREVIEW_ITEMS: { key: string; Icon: LucideIcon }[] = [
  { key: "comparePreviewHeadToHead", Icon: Swords },
  { key: "comparePreviewWeaknesses", Icon: ShieldAlert },
  { key: "comparePreviewRoadmap", Icon: Route },
];

interface CompareSlotDraft {
  platform: string;
  riotId: string;
}

const EMPTY_COMPARE_SLOT: CompareSlotDraft = { platform: "euw1", riotId: "" };

export function ProfileCompareEntry() {
  const { t } = useI18n();
  const [slots, setSlots] = useState<CompareSlotDraft[]>([{ ...EMPTY_COMPARE_SLOT }, { ...EMPTY_COMPARE_SLOT }]);
  const [targets, setTargets] = useState<ProfileTarget[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const savedProfiles = useSavedProfiles();
  const filledCount = slots.filter((s) => s.riotId.trim() !== "").length;

  if (targets) {
    return <ProfileCompareResult targets={targets} onReset={() => setTargets(null)} />;
  }

  // No per-slot "Buscar" confirmation step — every slot stays a plain text
  // input; "Comparar" parses all of them at once (parseRiotId is
  // local/offline, just splitting "name#tag") since the real existence
  // check already happens in ProfileCompareResult's fetch, which surfaces
  // "not found" with a retry button per player.
  function handleCompare() {
    const filled = slots.filter((s) => s.riotId.trim() !== "");
    if (filled.length < 2) return;
    const parsed: ProfileTarget[] = [];
    for (const s of filled) {
      const result = parseRiotId(s.riotId);
      if (!result) {
        setFormError(t("ProfileSearch.invalidRiotId"));
        return;
      }
      parsed.push({ platform: s.platform, gameName: result.gameName, tagLine: result.tagLine });
    }
    setFormError(null);
    setTargets(parsed);
  }

  return (
    // Two columns instead of one centered narrow form — a plain-text pitch
    // on the left doubling as a table of contents for the results screen,
    // the form on the right split off with a border instead of its own
    // boxed card.
    <div style={{ display: "flex", gap: 40, alignItems: "flex-start", flexWrap: "wrap", marginTop: 24 }}>
      <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h1 style={{ fontFamily: FONT_HEADING, fontSize: 22, fontWeight: 400, margin: 0 }}>{t("ProfileSearch.compareTitle")}</h1>
          <p style={{ color: COLORS.muted, fontSize: 13, marginTop: 6 }}>{t("ProfileSearch.compareIntro")}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: COLORS.muted }}>
            {t("ProfileSearch.comparePreviewEyebrow")}
          </span>
          <ul style={{ display: "flex", flexDirection: "column", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
            {COMPARE_PREVIEW_ITEMS.map(({ key, Icon }) => (
              <li key={key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <Icon size={15} color={COLORS.rose} style={{ flexShrink: 0 }} />
                <span>{t(`ProfileSearch.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div
        style={{
          flex: "0 1 360px",
          minWidth: 280,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          borderLeft: `1px solid ${COLORS.cardBorder}`,
          paddingLeft: 32,
        }}
      >
        {slots.map((slot, i) => (
          <CompareSlot
            key={i}
            label={t("ProfileSearch.compareSlot", { number: i + 1 })}
            platform={slot.platform}
            riotId={slot.riotId}
            savedProfiles={savedProfiles}
            showRemove={slots.length > 2}
            onChangePlatform={(p) => setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, platform: p } : s)))}
            onChangeRiotId={(v) => setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, riotId: v } : s)))}
            onPickSaved={(target) =>
              setSlots((prev) =>
                prev.map((s, j) => (j === i ? { platform: target.platform, riotId: `${target.gameName}#${target.tagLine}` } : s)),
              )
            }
            onRemove={() =>
              setSlots((prev) =>
                prev.length > 2 ? prev.filter((_, j) => j !== i) : prev.map((s, j) => (j === i ? { ...EMPTY_COMPARE_SLOT } : s)),
              )
            }
          />
        ))}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {slots.length < MAX_COMPARE_PLAYERS && (
            <button onClick={() => setSlots((prev) => [...prev, { ...EMPTY_COMPARE_SLOT }])} style={secondaryButtonStyle}>
              {t("ProfileSearch.compareAddPlayer")}
            </button>
          )}
          <button
            onClick={handleCompare}
            disabled={filledCount < 2}
            style={{
              ...secondaryButtonStyle,
              borderColor: filledCount >= 2 ? COLORS.rose : COLORS.cardBorder,
              color: filledCount >= 2 ? COLORS.rose : COLORS.muted,
              cursor: filledCount >= 2 ? "pointer" : "default",
            }}
          >
            {t("ProfileSearch.compareStart")}
          </button>
        </div>
        {formError ? <span style={{ fontSize: 12, color: COLORS.rose }}>{formError}</span> : null}
      </div>
    </div>
  );
}

// Same portal-based dropdown as CompareSavedProfilePicker above (matching
// its aesthetic exactly, 2026-09-01) instead of a native <select> — a real
// OS-rendered dropdown always looks and behaves differently from the rest
// of this app's custom-styled controls.
function ComparePlatformSelect({ value, onChange }: { value: string; onChange: (platform: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...selectStyle,
          // Sized to content instead of a fixed width, so no label ("EUNE",
          // "SEA", ...) can ever crowd the chevron regardless of language
          // or which platform is picked.
          width: "auto",
          minWidth: 64,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
        }}
      >
        {PLATFORM_LABELS[value] ?? value}
        <ChevronDown size={14} color={COLORS.muted} style={{ marginLeft: "auto" }} />
      </button>
      <DropdownMenu triggerRef={triggerRef} open={open} onClose={() => setOpen(false)} align="left" minWidth={90}>
        {PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              onChange(p);
              setOpen(false);
            }}
            style={{
              ...dropdownOptionStyle,
              color: p === value ? COLORS.rose : COLORS.text,
              background: p === value ? `${COLORS.rose}1f` : "none",
            }}
          >
            {PLATFORM_LABELS[p]}
          </button>
        ))}
      </DropdownMenu>
    </div>
  );
}

function CompareSlot({
  label,
  platform,
  riotId,
  savedProfiles,
  showRemove,
  onChangePlatform,
  onChangeRiotId,
  onPickSaved,
  onRemove,
}: {
  label: string;
  platform: string;
  riotId: string;
  savedProfiles: SavedProfileWithRank[];
  showRemove: boolean;
  onChangePlatform: (platform: string) => void;
  onChangeRiotId: (riotId: string) => void;
  onPickSaved: (target: ProfileTarget) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();

  return (
    // No boxed card — just the label above the row, same as every other
    // slot in this form. Always a plain text row, no per-slot "confirmed"
    // state — see ProfileCompareEntry's handleCompare for why.
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, color: COLORS.muted, fontWeight: 600 }}>{label}</span>
        {showRemove ? (
          <button
            onClick={onRemove}
            aria-label={t("ProfileSearch.removePlayer")}
            style={{ background: "none", border: "none", color: COLORS.muted, cursor: "pointer", padding: 0, display: "flex" }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <ComparePlatformSelect value={platform} onChange={onChangePlatform} />
        <div style={{ position: "relative", flex: "1 1 140px", minWidth: 0 }}>
          <input
            value={riotId}
            onChange={(e) => onChangeRiotId(e.target.value)}
            placeholder={t("ProfileSearch.riotIdPlaceholder")}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingRight: 24, fontSize: 14, padding: "10px 12px" }}
          />
          <CompareSavedProfilePicker profiles={savedProfiles} onPick={onPickSaved} />
        </div>
      </div>
    </div>
  );
}

// One accent color per compared player, reused for the card border and
// the name so a player keeps one identity across the whole comparison.
const COMPARE_ACCENTS = [COLORS.rose, "#4d9fe8", COLORS.gold, "#3ecf8e", "#9d6bf5"];

function ProfileCompareResult({ targets, onReset }: { targets: ProfileTarget[]; onReset: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<
    { kind: "loading" } | ({ kind: "error" } & FetchProfileError) | { kind: "ok"; profiles: ProfileApiResponse[] }
  >({ kind: "loading" });
  // Bumped by the retry button to re-run the fetch effect below without
  // needing a real target change — without this, a rate-limit failure had
  // no way to try again except leaving and re-entering the whole comparison.
  const [retryToken, setRetryToken] = useState(0);

  const targetsKey = targets.map((x) => `${x.platform}/${x.gameName}#${x.tagLine}`).join("|");
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all(targets.map((x) => fetchProfile(x.platform, x.gameName, x.tagLine))).then((results) => {
      if (cancelled) return;
      const failed = results.find((r): r is FetchProfileError => "error" in r);
      if (failed) {
        setState({ kind: "error", error: failed.error, status: failed.status });
        return;
      }
      setState({ kind: "ok", profiles: results as ProfileApiResponse[] });
    });
    return () => {
      cancelled = true;
    };
    // targetsKey covers every field of every target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey, retryToken]);

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <button
        onClick={onReset}
        style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", background: "none", border: "none", color: COLORS.muted, fontSize: 13, cursor: "pointer", padding: 0 }}
      >
        <X size={14} /> {t("ProfileSearch.searchAgain")}
      </button>
      {state.kind === "loading" ? (
        <p style={{ fontSize: 13, color: COLORS.muted, textAlign: "center", marginTop: 20 }}>{t("ProfileSearch.loading")}</p>
      ) : state.kind === "error" ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginTop: 20 }}>
          <p style={{ fontSize: 13, color: COLORS.rose, textAlign: "center", margin: 0 }}>
            {t(`ProfileSearch.errors.${errorMessageKey(state.error, state.status)}`)}
          </p>
          <RetryCountdownButton
            key={`${targetsKey}-${retryToken}`}
            seconds={errorMessageKey(state.error, state.status) === "rateLimited" ? 30 : 5}
            onRetry={() => setRetryToken((n) => n + 1)}
          />
        </div>
      ) : (
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Two players: the web /duo aesthetic — each player's top-mastery
              champion as a big faded splash on their own side (same box
              geometry as the web page: 1040x680 intruding 350px from each
              edge, slightly rotated). MainView's scroll container clips
              overflow-x, so the off-screen part can't cause a horizontal
              scrollbar. With 3+ players the sides don't map to anyone, so
              each card carries its own faded background instead. */}
          {state.profiles.length === 2 && state.profiles[0].topMasteryChampionId ? (
            <ChampionSplashAccent
              championId={state.profiles[0].topMasteryChampionId}
              opacity={18}
              style={{ left: -690, top: 0, width: 1040, height: 680, transform: "rotate(-1deg)" }}
            />
          ) : null}
          {state.profiles.length === 2 && state.profiles[1].topMasteryChampionId ? (
            <ChampionSplashAccent
              championId={state.profiles[1].topMasteryChampionId}
              opacity={18}
              style={{ right: -690, top: 0, width: 1040, height: 680, transform: "rotate(1deg)" }}
            />
          ) : null}
          <h1 style={{ fontFamily: FONT_HEADING, fontSize: 22, fontWeight: 400, margin: 0 }}>
            {state.profiles.map((data, i) => (
              <span key={i}>
                {i > 0 ? <span style={{ color: COLORS.muted }}> vs </span> : null}
                <span style={{ color: COMPARE_ACCENTS[i % COMPARE_ACCENTS.length] }}>
                  {data.profile.gameName}#{data.profile.tagLine}
                </span>
              </span>
            ))}
          </h1>
          {/* Five players wrap as 3 + 2 instead of the auto-fit's 4 + 1. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                state.profiles.length === 5 ? "repeat(3, minmax(0, 1fr))" : "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            {state.profiles.map((data, i) => (
              <ComparePlayerColumn
                key={i}
                data={data}
                accent={COMPARE_ACCENTS[i % COMPARE_ACCENTS.length]}
                withBackground={state.profiles.length > 2}
              />
            ))}
          </div>
          <RoadmapComparisonCard profiles={state.profiles} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: state.profiles.length === 2 ? "repeat(auto-fit, minmax(300px, 1fr))" : "1fr",
              gap: 16,
              alignItems: "start",
            }}
          >
            <CompareSkillCard profiles={state.profiles} />
            {state.profiles.length === 2 && (
              <div style={cardStyle}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{t("ProfileSearch.headToHead")}</span>
                <p style={{ fontSize: 13, color: COLORS.muted, margin: "4px 0 12px" }}>{t("ProfileSearch.headToHeadIntro")}</p>
                <HeadToHeadTable
                  nameA={`${state.profiles[0].profile.gameName}#${state.profiles[0].profile.tagLine}`}
                  nameB={`${state.profiles[1].profile.gameName}#${state.profiles[1].profile.tagLine}`}
                  stats={computeHeadToHead(state.profiles[0].profile.recentMatches, state.profiles[1].profile.recentMatches)}
                />
              </div>
            )}
          </div>
          <CompareSharedFocus profiles={state.profiles} />
        </div>
      )}
    </div>
  );
}

// Disabled with a visible countdown instead of a bare "Retry" that just
// fails again immediately against the same still-saturated quota — Riot's
// rate limit window is real (see RiftCompass-Web CLAUDE.md's own docs on
// this), so a rate-limited failure gets a genuinely longer wait than a
// plain network hiccup. Remounted with a fresh `key` per attempt (see the
// call site) so the countdown always restarts at the right length instead
// of carrying over a stale one.
function RetryCountdownButton({ seconds, onRetry }: { seconds: number; onRetry: () => void }) {
  const { t } = useI18n();
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining]);

  const ready = remaining <= 0;
  return (
    <button
      onClick={() => ready && onRetry()}
      disabled={!ready}
      style={{
        ...secondaryButtonStyle,
        cursor: ready ? "pointer" : "default",
        opacity: ready ? 1 : 0.6,
      }}
    >
      <RotateCcw size={13} />
      {ready ? t("ProfileSearch.retryNow") : t("ProfileSearch.retryIn", { seconds: remaining })}
    </button>
  );
}

function CompareSkillCard({ profiles }: { profiles: ProfileApiResponse[] }) {
  const { t } = useI18n();
  const radars = profiles.map((p) => computeSkillRadar(p.profile.recentMatches, p.rankTier));
  const axes = radars[0] ?? [];
  if (axes.length === 0) return null;
  return (
    <div style={cardStyle}>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{t("ProfileSearch.skillOverview")}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
        {axes.map((axisPoint, ai) => (
          <div key={axisPoint.axis} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: COLORS.muted }}>{t(`ProfileSearch.axis.${AXIS_LABEL_KEY[axisPoint.axis]}`)}</span>
            {radars.map((points, pi) => {
              const value = points[ai]?.value ?? 0;
              const accent = COMPARE_ACCENTS[pi % COMPARE_ACCENTS.length];
              return (
                <div key={pi} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 999, background: `${COLORS.background}99`, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, (value / 150) * 100)}%`, borderRadius: 999, background: accent }} />
                  </div>
                  <span style={{ width: 42, flexShrink: 0, fontSize: 12, color: accent, textAlign: "right" }}>{value}%</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
        {profiles.map((p, pi) => (
          <span key={pi} style={{ fontSize: 12, color: COMPARE_ACCENTS[pi % COMPARE_ACCENTS.length] }}>
            {p.profile.gameName}#{p.profile.tagLine}
          </span>
        ))}
      </div>
    </div>
  );
}

// The web /duo shared-weaknesses section: metrics where EVERY compared
// player sits below target, with the same coaching tips.
function CompareSharedFocus({ profiles }: { profiles: ProfileApiResponse[] }) {
  const { t } = useI18n();
  const roadmaps = profiles.map((p) => computeRoadmap(p.profile.recentMatches, p.rankTier));
  const shared = (roadmaps[0] ?? []).filter((node) =>
    roadmaps.every((nodes) => nodes.find((x) => x.metric === node.metric)?.status === "below"),
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 6 }}>
      <h2 style={{ fontFamily: FONT_HEADING, fontSize: 17, fontWeight: 400, margin: 0 }}>{t("ProfileSearch.sharedFocusTitle")}</h2>
      {shared.length === 0 ? (
        <p style={{ fontSize: 13, color: COLORS.muted, margin: 0 }}>{t("ProfileSearch.sharedFocusNone")}</p>
      ) : (
        shared.map((node) => (
          <p key={node.metric} style={{ fontSize: 13, margin: 0, borderLeft: `2px solid ${COLORS.rose}`, paddingLeft: 10, lineHeight: 1.5 }}>
            {t(`ProfileSearch.sharedTips.${node.metric}`)}
          </p>
        ))
      )}
    </div>
  );
}

function CompareRankLine({
  label,
  entry,
  topRole,
}: {
  label: string;
  entry: RiotLeagueEntry | null;
  // Undefined (no matches for this queue in the tracked window) means no
  // real main-position data — never fabricate one just to fill the slot,
  // same rule as the web's RankChip.
  topRole: RoleStats | undefined;
}) {
  const { t } = useI18n();
  const winRate = entry ? Math.round((entry.wins / Math.max(1, entry.wins + entry.losses)) * 100) : null;
  const emblem = entry ? rankEmblemUrl(entry.tier) : null;
  const roleIcon = topRole && topRole.games > 0 ? positionIconUrl(topRole.position) : null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.muted }}>
      {emblem && <img src={emblem} alt="" style={{ width: 18, height: 18 }} />}
      <span>
        {label}: {entry ? `${formatTierRank(entry.tier, entry.rank)} · ${entry.leaguePoints} LP · ${winRate}% WR` : t("ProfileSearch.unranked")}
      </span>
      {roleIcon ? (
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          ·
          <img src={roleIcon} alt="" style={{ width: 14, height: 14 }} />
          {t(`Profile.positions.${topRole!.position.toLowerCase()}`)}
        </span>
      ) : null}
    </div>
  );
}

// One compared player's identity column: name + ranks. Used to repeat a
// full RoadmapCard per player below this too (title, 4 metric rows, a bar
// each) — with 3-5 players that was a wall of near-identical cards, the
// same metric sitting in far-apart columns with nothing to compare it
// against at a glance. Replaced by RoadmapComparisonCard below (one shared
// table, a row per metric, every player's value in its own column) — same
// pattern as the web's /duo page. With two players
// the big side splashes carry the art (web duo aesthetic); with 3+ each
// column gets its own faded top-mastery splash behind it, exactly like the
// web's multi-player columns.
function ComparePlayerColumn({
  data,
  accent,
  withBackground,
}: {
  data: ProfileApiResponse;
  accent: string;
  withBackground: boolean;
}) {
  const { t } = useI18n();
  const { profile, topMasteryChampionId } = data;
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
      {withBackground && topMasteryChampionId ? (
        <ChampionSplashAccent
          championId={topMasteryChampionId}
          opacity={20}
          style={{ left: 0, top: -24, width: "100%", height: 260 }}
        />
      ) : null}
      <span style={{ fontSize: 16, fontWeight: 600, borderLeft: `2px solid ${accent}`, paddingLeft: 8, color: accent }}>
        {profile.gameName}
        <span style={{ color: COLORS.muted, fontWeight: 400 }}>#{profile.tagLine}</span>
      </span>
      <CompareRankLine
        label={t("ProfileSearch.soloQueue")}
        entry={profile.soloQueue}
        topRole={computeRoleBreakdown(profile.recentMatches, RANKED_SOLO_QUEUE_ID)[0]}
      />
      <CompareRankLine
        label={t("ProfileSearch.flexQueue")}
        entry={profile.flexQueue}
        topRole={computeRoleBreakdown(profile.recentMatches, RANKED_FLEX_QUEUE_ID)[0]}
      />
    </div>
  );
}

// Fixed order, not each player's own worst-gap-first order (computeRoadmap
// still sorts that way internally, used below only to pick each player's
// own "biggest opportunity" line) — a comparison needs the same metric to
// land in the same row for every player, or there's nothing to compare.
const ROADMAP_METRIC_ORDER: RoadmapMetric[] = ["csPerMin", "visionPerMin", "kda", "laningAdvantage"];

// One shared table instead of a RoadmapCard per player — see
// ComparePlayerColumn's comment above for why. Same real computeRoadmap
// data every single-profile view already uses, just laid out so the same
// metric reads as one row across every player. A soft per-player color
// wash on the card background stands in for repeating each name next to
// every value (the name is still stated once, in the priority list above
// the table, and once more as a column header above the first metric row).
function RoadmapComparisonCard({ profiles }: { profiles: ProfileApiResponse[] }) {
  const { t } = useI18n();
  const nodesPerPlayer = profiles.map((p) => computeRoadmap(p.profile.recentMatches, p.rankTier));
  const priorityPerPlayer = nodesPerPlayer.map((nodes) => nodes.find((n) => n.status === "below"));

  // Mostly-solid band per player (matching their equal share of the grid
  // columns below), blended into the next player's color only in a strip
  // centered on each internal boundary — a smooth wash end-to-end made it
  // unclear whose color was whose; flat hard edges read as too plain.
  const TRANSITION_PCT = 10;
  const gradientImage =
    profiles.length > 1
      ? `linear-gradient(to right, ${profiles
          .flatMap((_, i) => {
            const accent = COMPARE_ACCENTS[i % COMPARE_ACCENTS.length];
            const stop = `${accent}1a`;
            const bandStart = (i / profiles.length) * 100;
            const bandEnd = ((i + 1) / profiles.length) * 100;
            const half = TRANSITION_PCT / 2;
            const from = i === 0 ? bandStart : bandStart + half;
            const to = i === profiles.length - 1 ? bandEnd : bandEnd - half;
            return [`${stop} ${from}%`, `${stop} ${to}%`];
          })
          .join(", ")})`
      : undefined;

  return (
    <div style={{ ...cardStyle, backgroundImage: gradientImage }}>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{t("ProfileSearch.roadmapComparisonTitle")}</span>
      <p style={{ fontSize: 13, color: COLORS.muted, margin: "4px 0 0" }}>{t("ProfileSearch.roadmapComparisonSubtitle")}</p>

      <ul style={{ display: "flex", flexDirection: "column", gap: 4, margin: "12px 0 0", padding: 0, listStyle: "none" }}>
        {profiles.map((p, i) => {
          const priority = priorityPerPlayer[i];
          const accent = COMPARE_ACCENTS[i % COMPARE_ACCENTS.length];
          return (
            <li key={i} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6, fontSize: 14 }}>
              <span style={{ fontWeight: 600, color: accent }}>{p.profile.gameName}</span>
              {priority ? (
                <span style={{ color: COLORS.muted }}>
                  {t("ProfileSearch.priorityLabel")} {t(`ProfileSearch.metric.${priority.metric}`)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
        {ROADMAP_METRIC_ORDER.map((metric, i) => (
          <RoadmapMetricRow
            key={metric}
            metric={metric}
            profiles={profiles}
            nodesPerPlayer={nodesPerPlayer}
            showNames={i === 0}
            isLast={i === ROADMAP_METRIC_ORDER.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function RoadmapMetricRow({
  metric,
  profiles,
  nodesPerPlayer,
  showNames,
  isLast,
}: {
  metric: RoadmapMetric;
  profiles: ProfileApiResponse[];
  nodesPerPlayer: RoadmapNode[][];
  // Only the first metric row gets a name above its columns — every other
  // row skips it so it isn't repeated once per metric.
  showNames: boolean;
  isLast: boolean;
}) {
  const { t } = useI18n();
  const nodes = nodesPerPlayer.map((playerNodes) => playerNodes.find((n) => n.metric === metric));
  const unit = metric === "laningAdvantage" ? "%" : "";
  const columnGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(110px, 1fr))`,
    columnGap: 16,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 0",
        borderTop: isLast ? undefined : `1px solid ${COLORS.cardBorder}66`,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>{t(`ProfileSearch.metric.${metric}`)}</span>
      {showNames ? (
        <div style={columnGrid}>
          {profiles.map((p, i) => (
            <span
              key={i}
              title={p.profile.gameName}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: COMPARE_ACCENTS[i % COMPARE_ACCENTS.length],
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {p.profile.gameName}
            </span>
          ))}
        </div>
      ) : null}
      <div style={{ ...columnGrid, rowGap: 8 }}>
        {profiles.map((_, i) => {
          const node = nodes[i];
          if (!node) return <div key={i} />;
          const fillPct = Math.min(100, Math.round((node.value / node.target) * 100));
          const color = node.status === "above" ? COLORS.goodMild : COLORS.badMild;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>
                  {node.value}
                  {unit}
                </span>{" "}
                <span style={{ fontSize: 11, color: COLORS.muted }}>
                  / {t("ProfileSearch.target")} {node.target}
                  {unit}
                </span>
              </span>
              <div style={{ height: 6, width: "100%", borderRadius: 999, background: `${COLORS.goodMild}1a`, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${fillPct}%`, borderRadius: 999, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
      {/* Closed by default, same as the web's roadmap-comparison.tsx, so
          the tips don't visually clutter the screen — a native <details>
          needs no state here. */}
      <details>
        <summary style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: COLORS.muted, cursor: "pointer", listStyle: "none" }}>
          <ChevronRight size={12} />
          {t("ProfileSearch.roadmapTips")}
        </summary>
        <ul style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0 0", padding: "0 0 0 16px" }}>
          {profiles.map((p, i) => {
            const node = nodes[i];
            if (!node) return null;
            const above = node.status === "above";
            const tipKey = node.role
              ? `Roadmap.${metric}.${above ? "tipAbove" : "tipBelow"}.${node.role}.${node.band}`
              : `Roadmap.${metric}.${above ? "tipAbove" : "tipBelow"}.${node.band}`;
            return (
              <li key={i} style={{ fontSize: 12, color: COLORS.muted }}>
                <span style={{ fontWeight: 600, color: COMPARE_ACCENTS[i % COMPARE_ACCENTS.length] }}>{p.profile.gameName}:</span> {t(tipKey)}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}

// The inline "Comparar con" popover ProfileDetail.tsx opens from a single
// profile's own header — same fetch/head-to-head machinery as the
// standalone compare entry above, just anchored to one already-open
// profile instead of starting from a blank multi-slot form.
export function CompareBlock({
  base,
  baseMatches,
  compareTarget,
  onSetCompareTarget,
  onClose,
}: {
  base: ProfileTarget;
  baseMatches: RecentMatchSummary[];
  compareTarget: ProfileTarget;
  onSetCompareTarget: (t: ProfileTarget) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [riotId, setRiotId] = useState("");
  const [platform, setPlatform] = useState(base.platform);
  const savedProfiles = useSavedProfiles();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | ({ kind: "error" } & FetchProfileError) | { kind: "ok"; data: ProfileApiResponse }
  >({ kind: "idle" });

  useEffect(() => {
    if (!compareTarget.gameName) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetchProfile(compareTarget.platform, compareTarget.gameName, compareTarget.tagLine).then((result) => {
      if (cancelled) return;
      if ("error" in result) setState({ kind: "error", error: result.error, status: result.status });
      else setState({ kind: "ok", data: result });
    });
    return () => {
      cancelled = true;
    };
  }, [compareTarget.platform, compareTarget.gameName, compareTarget.tagLine]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseRiotId(riotId);
    if (!parsed) return;
    onSetCompareTarget({ platform, gameName: parsed.gameName, tagLine: parsed.tagLine });
  }

  function handlePickSaved(target: ProfileTarget) {
    setPlatform(target.platform);
    setRiotId(`${target.gameName}#${target.tagLine}`);
    onSetCompareTarget(target);
  }

  return (
    // No cardStyle wrapper — DropdownMenu already supplies the background,
    // border, shadow, and padding for its popover; nesting cardStyle here
    // used to draw a card-inside-a-card.
    <div style={{ position: "relative" }}>
      <button onClick={onClose} style={{ position: "absolute", top: -4, right: -4, background: "none", border: "none", color: COLORS.muted, cursor: "pointer" }}>
        <X size={15} />
      </button>
      <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ProfileSearch.compareWith")}</span>
      {state.kind === "idle" ? (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ ...selectStyle, width: 90, flexShrink: 0 }}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <input
                value={riotId}
                onChange={(e) => setRiotId(e.target.value)}
                placeholder={t("ProfileSearch.riotIdPlaceholder")}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingRight: 24 }}
              />
              <CompareSavedProfilePicker profiles={savedProfiles} onPick={handlePickSaved} />
            </div>
          </div>
          <button type="submit" style={secondaryButtonStyle}>
            {t("ProfileSearch.searchButton")}
          </button>
        </form>
      ) : state.kind === "loading" ? (
        <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 10 }}>{t("ProfileSearch.loading")}</p>
      ) : state.kind === "error" ? (
        <p style={{ fontSize: 12, color: COLORS.rose, marginTop: 10 }}>
          {t(`ProfileSearch.errors.${errorMessageKey(state.error, state.status)}`)}
        </p>
      ) : (
        <HeadToHeadTable
          nameA={`${base.gameName}#${base.tagLine}`}
          nameB={`${state.data.profile.gameName}#${state.data.profile.tagLine}`}
          stats={computeHeadToHead(baseMatches, state.data.profile.recentMatches)}
        />
      )}
    </div>
  );
}

// Generously spaced so this card reads as substantial next to Skill
// Overview even at equal grid width — the difference is content density,
// not column size. A border between rows gives each stat real vertical
// weight instead of just a tight list of numbers.
function HeadToHeadTable({ nameA, nameB, stats }: { nameA: string; nameB: string; stats: HeadToHeadStat[] }) {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
        <span style={{ color: COLORS.rose }}>{nameA}</span>
        <span style={{ color: COLORS.goodMild }}>{nameB}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {stats.map((s, i) => {
          const aBetter = s.higherIsBetter ? s.valueA >= s.valueB : s.valueA <= s.valueB;
          return (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 15,
                padding: "10px 0",
                borderTop: i > 0 ? `1px solid ${COLORS.cardBorder}66` : "none",
              }}
            >
              <span style={{ width: 64, flexShrink: 0, fontWeight: aBetter ? 700 : 400, color: aBetter ? COLORS.rose : COLORS.text }}>{s.valueA}</span>
              <span style={{ flex: 1, textAlign: "center", color: COLORS.muted, fontSize: 12 }}>{t(`ProfileSearch.h2h.${s.key}`)}</span>
              <span style={{ width: 64, flexShrink: 0, textAlign: "right", fontWeight: !aBetter ? 700 : 400, color: !aBetter ? COLORS.goodMild : COLORS.text }}>{s.valueB}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
