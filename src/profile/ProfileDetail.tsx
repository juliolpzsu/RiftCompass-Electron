import { useEffect, useId, useRef, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Crosshair,
  Eye,
  Flame,
  GitCompare,
  RefreshCw,
  Search,
  Sparkles,
  Swords,
  Target,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { API_BASE_URL } from "../shared/api";
import { COLORS, FONT_HEADING, TYPE, inputStyle } from "../theme";
import { useI18n } from "../i18n";
import { championSquareUrl, profileIconUrl, itemIconUrl, fetchSummonerSpellIconsById } from "../ddragon";
import { ChampionSplashAccent } from "../ChampionSplashAccent";
import { PLATFORM_LABELS, formatTierRank, tierColor as lpTierColor } from "../lib/rank-lp";
import {
  buildActivityGrid,
  computeChampionOverview,
  computeChampionPool,
  computePerformanceBadges,
  computeRoadmap,
  computeRoleBreakdown,
  computeSkillRadar,
  positionIconUrl,
  rankEmblemUrl,
  summarizeMatchPerformance,
  summarizeParticipant,
  RANKED_SOLO_QUEUE_ID,
  RANKED_FLEX_QUEUE_ID,
  type DayActivity,
  type PerformanceBadge,
  type RoadmapNode,
  type RoleStats,
  type SkillAxis,
  type SkillRadarPoint,
} from "../lib/profile-analysis";
import type { ProfileApiResponse, RecentMatchSummary, RiotLeagueEntry } from "../lib/profile-types";
import type { SavedProfileWithRank } from "../riftcompass";
import {
  parseRiotId,
  type FetchProfileError,
  fetchProfile,
  errorMessageKey,
  type ProfileTarget,
  useSavedProfiles,
  DropdownMenu,
  PlatformSelect,
  CompareSavedProfilePicker,
  AXIS_LABEL_KEY,
  cardStyle,
  selectStyle,
  secondaryButtonStyle,
} from "./ProfileShared";
import { CompareBlock } from "./ProfileCompare";

// Riot ID search + single-profile view — same real data as
// riftcompass.com's own profile page (via the public
// GET /api/v1/profile/[platform]/[riotId]), matching its section set
// (rank, LP trend + skill radar, activity calendar, role breakdown,
// champion pool, roadmap, match history), computed from the same payload
// client-side rather than a copy-pasted DOM.

// Backs the activity calendar's month navigation (/api/v1/activity-calendar) —
// the only way this app can browse a month beyond the profile payload's own
// recent-matches range, same real Riot query the web page's own
// fetchActivityGridForMonth makes server-side. `month` is 1-12 here, matching
// the endpoint's public contract (see its own route.ts comment for why that's
// deliberately not 0-indexed).
async function fetchActivityCalendarMonth(
  platform: string,
  puuid: string,
  year: number,
  month: number,
): Promise<DayActivity[] | FetchProfileError> {
  try {
    const url = `${API_BASE_URL}/api/v1/activity-calendar?platform=${platform}&puuid=${encodeURIComponent(puuid)}&year=${year}&month=${month}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? "unknown", status: data.status ?? res.status, retryAfterSeconds: data.retryAfterSeconds };
    return data.days as DayActivity[];
  } catch {
    return { error: "network" };
  }
}

// Module-level (not per-component-instance) cache: summoner spell icons
// are static per DDragon version, so every MatchHistoryCard across every
// profile view this session reuses the same fetch instead of repeating it.
const summonerSpellIconCache = new Map<string, Record<number, string>>();

// Powers the expanded match scoreboard's spell icons (MatchScoreboard
// below) — added 2026-08-29 alongside the rest of that section's detail,
// see its own comment for why.
function useSummonerSpellIcons(ddragonVersion: string): Record<number, string> {
  const [icons, setIcons] = useState<Record<number, string>>(
    () => summonerSpellIconCache.get(ddragonVersion) ?? {},
  );
  useEffect(() => {
    if (!ddragonVersion) return;
    const cached = summonerSpellIconCache.get(ddragonVersion);
    if (cached) {
      setIcons(cached);
      return;
    }
    let cancelled = false;
    fetchSummonerSpellIconsById(ddragonVersion).then((byId) => {
      summonerSpellIconCache.set(ddragonVersion, byId);
      if (!cancelled) setIcons(byId);
    });
    return () => {
      cancelled = true;
    };
  }, [ddragonVersion]);
  return icons;
}

function SavedProfileSelect({
  profiles,
  onPick,
}: {
  profiles: SavedProfileWithRank[];
  onPick: (target: ProfileTarget) => void;
}) {
  const { t } = useI18n();
  if (profiles.length === 0) return null;
  return (
    <select
      value=""
      onChange={(e) => {
        const profile = profiles.find((p) => p.id === e.target.value);
        if (profile) onPick({ platform: profile.platform, gameName: profile.gameName, tagLine: profile.tagLine });
      }}
      style={{ ...selectStyle, width: "100%", marginTop: 8, color: COLORS.muted }}
    >
      <option value="" disabled>
        {t("ProfileSearch.pickSaved")}
      </option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.gameName}#{p.tagLine} · {PLATFORM_LABELS[p.platform] ?? p.platform}
        </option>
      ))}
    </select>
  );
}

export function ProfileScreen({ initialTarget, canSave = false }: { initialTarget?: ProfileTarget | null; canSave?: boolean }) {
  const [target, setTarget] = useState<ProfileTarget | null>(initialTarget ?? null);

  if (!target) return <ProfileSearchForm onSearch={setTarget} />;
  return <ProfileDetail target={target} canSave={canSave} onSearchAgain={() => setTarget(null)} onOpenProfile={setTarget} />;
}

function ProfileSearchForm({ onSearch }: { onSearch: (target: ProfileTarget) => void }) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState("euw1");
  const [riotId, setRiotId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const savedProfiles = useSavedProfiles();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseRiotId(riotId);
    if (!parsed) {
      setError(t("ProfileSearch.invalidRiotId"));
      return;
    }
    setError(null);
    onSearch({ platform, gameName: parsed.gameName, tagLine: parsed.tagLine });
  }

  return (
    <div style={{ maxWidth: 480, margin: "40px auto 0" }}>
      <h1 style={{ fontFamily: FONT_HEADING, fontSize: 22, fontWeight: 400, margin: 0 }}>{t("ProfileSearch.title")}</h1>
      <p style={{ color: COLORS.muted, fontSize: 13, marginTop: 6 }}>{t("ProfileSearch.intro")}</p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <PlatformSelect value={platform} onChange={setPlatform} />
          <input
            value={riotId}
            onChange={(e) => setRiotId(e.target.value)}
            placeholder={t("ProfileSearch.riotIdPlaceholder")}
            style={{ ...inputStyle, flex: 1 }}
          />
        </div>
        {error ? <span style={{ fontSize: 12, color: COLORS.rose }}>{error}</span> : null}
        <button type="submit" style={{ ...primaryButtonStyle, alignSelf: "flex-start" }}>
          <Search size={14} /> {t("ProfileSearch.searchButton")}
        </button>
      </form>
      <SavedProfileSelect profiles={savedProfiles} onPick={onSearch} />
    </div>
  );
}

// The desktop app's equivalent of the web's RefreshProfileButton — same
// force-refresh bypass (?force=true on /api/v1/profile, same
// profileRefresh rate limit server-side, see route.ts), just reachable
// over the public API instead of a Server Action. Cooldown is real, not
// just visual: the server re-checks on every click, so a manipulated
// client re-clicking early still gets rejected with its own
// retryAfterSeconds.
function RefreshProfileButton({
  platform,
  gameName,
  tagLine,
  fetchedAt,
  onRefreshed,
}: {
  platform: string;
  gameName: string;
  tagLine: string;
  fetchedAt: string;
  onRefreshed: (data: ProfileApiResponse) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "cooldown"; seconds: number }>({
    kind: "idle",
  });
  const [minutesAgo, setMinutesAgo] = useState(0);

  useEffect(() => {
    const update = () => setMinutesAgo(Math.max(0, Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 60000)));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  useEffect(() => {
    if (status.kind !== "cooldown" || status.seconds <= 0) return;
    const id = setTimeout(() => setStatus((s) => (s.kind === "cooldown" ? { kind: "cooldown", seconds: s.seconds - 1 } : s)), 1000);
    return () => clearTimeout(id);
  }, [status]);

  async function handleClick() {
    setStatus({ kind: "loading" });
    const result = await fetchProfile(platform, gameName, tagLine, { force: true });
    if ("error" in result) {
      // Same generic backoff the web's own RefreshProfileButton falls back
      // to for a non-rate-limit failure (Riot itself erroring right after
      // our own cooldown just cleared) — retryAfterSeconds is only ever
      // set on the real cooldown response.
      setStatus({ kind: "cooldown", seconds: result.retryAfterSeconds ?? 30 });
      return;
    }
    setStatus({ kind: "idle" });
    onRefreshed(result);
  }

  const onCooldown = status.kind === "cooldown" && status.seconds > 0;
  const loading = status.kind === "loading";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: COLORS.muted }}>
        {minutesAgo <= 0 ? t("ProfileSearch.lastUpdatedNow") : t("ProfileSearch.lastUpdatedMinutes", { minutes: minutesAgo })}
      </span>
      <button onClick={handleClick} disabled={loading || onCooldown} style={{ ...secondaryButtonStyle, opacity: loading || onCooldown ? 0.6 : 1 }}>
        <RefreshCw size={13} />
        {onCooldown && status.kind === "cooldown"
          ? t("ProfileSearch.refreshCooldown", { time: `${Math.floor(status.seconds / 60)}:${String(status.seconds % 60).padStart(2, "0")}` })
          : loading
            ? t("ProfileSearch.refreshing")
            : t("ProfileSearch.refresh")}
      </button>
    </div>
  );
}

function ProfileDetail({
  target,
  canSave,
  onSearchAgain,
  onOpenProfile,
}: {
  target: ProfileTarget;
  canSave?: boolean;
  onSearchAgain: () => void;
  onOpenProfile: (target: ProfileTarget) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<
    { kind: "loading" } | ({ kind: "error" } & FetchProfileError) | { kind: "ok"; data: ProfileApiResponse }
  >({ kind: "loading" });
  const [compareTarget, setCompareTarget] = useState<ProfileTarget | null>(null);
  const compareButtonRef = useRef<HTMLButtonElement>(null);
  const [searchAgainOpen, setSearchAgainOpen] = useState(false);
  const searchAgainButtonRef = useRef<HTMLButtonElement>(null);
  // null = still unknown (either the saved-list fetch is in flight or the
  // user isn't logged in) — the button only renders once this is boolean.
  const [saved, setSaved] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  // Called unconditionally, before the loading/error early returns below —
  // React requires every hook to run on every render regardless of state,
  // and this one used to sit after those returns, so it went from unrun
  // (loading) to run (ok) between renders and crashed the whole tree with
  // "Rendered more hooks than during the previous render". Empty string
  // here (state not "ok" yet) is a real, valid version the hook itself now
  // guards against fetching for.
  const summonerSpellIcons = useSummonerSpellIcons(state.kind === "ok" ? state.data.ddragonVersion : "");

  useEffect(() => {
    if (!canSave) return;
    let cancelled = false;
    setSaved(null);
    window.riftcompass.getSavedProfiles().then((data) => {
      if (cancelled) return;
      setSaved(
        data.profiles.some(
          (p) =>
            p.platform === target.platform &&
            p.gameName.toLowerCase() === target.gameName.toLowerCase() &&
            p.tagLine.toLowerCase() === target.tagLine.toLowerCase(),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [canSave, target.platform, target.gameName, target.tagLine]);

  useEffect(() => {
    // Cancellation guard (same pattern as SavedProfilesList) — without it,
    // React StrictMode's dev-only double-invoke of this effect fires two
    // real requests for the same profile; whichever settles last wins the
    // final state regardless of which was more "current", so a slower
    // first request finishing after a faster retry could stomp a good
    // result, or vice versa. Confirmed live: the very race this guards
    // against was caught by chance during debugging — the fetch itself
    // was fine (200 OK, real data) but the screen still ended up on the
    // network-error branch.
    let cancelled = false;
    setState({ kind: "loading" });
    fetchProfile(target.platform, target.gameName, target.tagLine).then((result) => {
      if (cancelled) return;
      if ("error" in result) setState({ kind: "error", error: result.error, status: result.status });
      else setState({ kind: "ok", data: result });
    });
    return () => {
      cancelled = true;
    };
  }, [target.platform, target.gameName, target.tagLine]);

  if (state.kind === "loading") {
    return <p style={{ fontSize: 13, color: COLORS.muted, marginTop: 40, textAlign: "center" }}>{t("ProfileSearch.loading")}</p>;
  }
  if (state.kind === "error") {
    const key = errorMessageKey(state.error, state.status);
    return (
      <div style={{ maxWidth: 480, margin: "40px auto 0", display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CircleAlert size={18} color={COLORS.rose} />
            <p style={{ fontFamily: FONT_HEADING, fontSize: TYPE.subheading, fontWeight: 400, margin: 0, color: COLORS.text }}>
              {t("ProfileSearch.errorTitle")}
            </p>
          </div>
          <p style={{ fontSize: TYPE.body, color: COLORS.muted, margin: 0, lineHeight: 1.5 }}>{t(`ProfileSearch.errors.${key}`)}</p>
        </div>
        <button onClick={onSearchAgain} style={secondaryButtonStyle}>
          {t("ProfileSearch.searchAgain")}
        </button>
      </div>
    );
  }

  const { profile, ddragonVersion, rankTier, topMasteryChampionId, lpHistory } = state.data;

  // Same semantics as the web's SaveProfileButton: one toggle endpoint,
  // canonical names from the fetched profile (not the raw search input),
  // and a window event nudging the saved-profiles sidebar to refetch.
  async function handleToggleSaved() {
    if (saved === null || saving) return;
    setSaving(true);
    const result = await window.riftcompass.toggleSavedProfile(
      target.platform,
      profile.gameName,
      profile.tagLine,
      profile.puuid,
    );
    setSaving(false);
    if (result.ok) {
      setSaved(result.saved);
      window.dispatchEvent(new Event("riftcompass:profile-panel-refresh"));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "relative" }}>
      {topMasteryChampionId ? (
        // The player's own highest-mastery champion as a faded background
        // accent, exactly like the web profile header: blurred into the
        // page, never a cropped strip that cuts the face off.
        <ChampionSplashAccent
          championId={topMasteryChampionId}
          opacity={20}
          style={{ right: -120, top: -40, width: 640, height: 360 }}
        />
      ) : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src={profileIconUrl(ddragonVersion, profile.profileIconId)}
            alt=""
            style={{ width: 52, height: 52, borderRadius: 999, border: `2px solid ${COLORS.rose}66` }}
          />
          <div>
            <h1 style={{ fontFamily: FONT_HEADING, fontSize: 20, fontWeight: 400, margin: 0 }}>
              {profile.gameName}
              <span style={{ color: COLORS.muted }}>#{profile.tagLine}</span>
            </h1>
            <span style={{ fontSize: 12, color: COLORS.muted }}>
              {PLATFORM_LABELS[target.platform] ?? target.platform} · {t("ProfileSearch.level", { level: profile.summonerLevel })}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <RefreshProfileButton
            platform={target.platform}
            gameName={profile.gameName}
            tagLine={profile.tagLine}
            fetchedAt={profile.fetchedAt}
            onRefreshed={(data) => setState({ kind: "ok", data })}
          />
          {canSave && saved !== null ? (
            <button
              onClick={handleToggleSaved}
              disabled={saving}
              style={
                saved
                  ? { ...secondaryButtonStyle, borderColor: `${COLORS.rose}66`, background: `${COLORS.rose}1a`, color: COLORS.rose }
                  : secondaryButtonStyle
              }
            >
              {saved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
              {saved ? t("ProfileSearch.savedProfile") : t("ProfileSearch.saveProfile")}
            </button>
          ) : null}
          <button
            ref={compareButtonRef}
            onClick={() => setCompareTarget(compareTarget ? null : { platform: target.platform, gameName: "", tagLine: "" })}
            style={secondaryButtonStyle}
          >
            <GitCompare size={13} /> {t("ProfileSearch.compare")}
          </button>
          <button
            ref={searchAgainButtonRef}
            onClick={() => setSearchAgainOpen((v) => !v)}
            style={secondaryButtonStyle}
          >
            <Search size={13} /> {t("ProfileSearch.searchAgain")}
          </button>
        </div>
      </div>

      {/* Small popover next to the button, not a full-page takeover — same
          shape as the header's own quick search on the Herramientas screen
          (MainView.tsx's HeaderProfileSearch). Picking a result calls
          onOpenProfile directly (swaps `target` on the same ProfileScreen,
          same as onOpenProfile everywhere else in this file) instead of
          onSearchAgain's full reset to the standalone search screen — this
          IS the search, no separate screen needed for it anymore. */}
      <DropdownMenu
        triggerRef={searchAgainButtonRef}
        open={searchAgainOpen}
        onClose={() => setSearchAgainOpen(false)}
        align="right"
        minWidth={280}
        maxWidth={320}
        maxHeight={200}
        padding={12}
      >
        <SearchAgainBlock
          defaultPlatform={target.platform}
          onOpen={(t) => {
            onOpenProfile(t);
            setSearchAgainOpen(false);
          }}
        />
      </DropdownMenu>

      {/* Anchored to the Comparar button itself, rather than a full-width
          card sitting inline in the page flow — same DropdownMenu portal
          every other popover in this file already uses, just with roomier
          sizing than the small option-list default since this one holds a
          real form and a result table. */}
      <DropdownMenu
        triggerRef={compareButtonRef}
        open={compareTarget !== null}
        onClose={() => setCompareTarget(null)}
        align="right"
        minWidth={320}
        maxWidth={380}
        maxHeight={480}
        padding={16}
      >
        {compareTarget ? (
          <CompareBlock
            base={target}
            baseMatches={profile.recentMatches}
            compareTarget={compareTarget}
            onSetCompareTarget={setCompareTarget}
            onClose={() => setCompareTarget(null)}
          />
        ) : null}
      </DropdownMenu>

      <PerformanceBadgesRow points={computeSkillRadar(profile.recentMatches, rankTier)} />

      {/* Paired rows, matching the web's own already-refined pairing
          (page.tsx: rank cards together, RankTrend+SkillRadar together,
          Calendar+ChampionOverview together, ChampionPool and Roadmap each
          full-width alone) instead of ad-hoc pairs. The web's pairing
          groups cards whose natural content height is close (a rank card
          next to another rank card, a compact chart next to another
          compact chart, a taller grid next to a similarly-tall table) —
          same real content, same real height, just wider fractions here
          since the desktop window has more room than a web viewport. Each
          card's own internal layout (see cardStyle usage below) still
          centers its content vertically within the row's `stretch`, so
          any residual height difference reads as intentional, not
          leftover space. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        <RankCard
          title={t("ProfileSearch.soloQueue")}
          entry={profile.soloQueue}
          roleStats={computeRoleBreakdown(profile.recentMatches, RANKED_SOLO_QUEUE_ID)}
        />
        <RankCard
          title={t("ProfileSearch.flexQueue")}
          entry={profile.flexQueue}
          roleStats={computeRoleBreakdown(profile.recentMatches, RANKED_FLEX_QUEUE_ID)}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        <RankTrendCard lpHistory={lpHistory} matches={profile.recentMatches} />
        <SkillRadarCard matches={profile.recentMatches} tier={rankTier} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
        <ActivityCalendarCard matches={profile.recentMatches} puuid={profile.puuid} platform={target.platform} />
        <ChampionOverviewCard matches={profile.recentMatches} ddragonVersion={ddragonVersion} />
      </div>

      <ChampionPoolCard matches={profile.recentMatches} ddragonVersion={ddragonVersion} />

      <RoadmapCard matches={profile.recentMatches} tier={rankTier} />

      <hr style={{ border: "none", borderTop: `1px solid ${COLORS.cardBorder}`, margin: 0 }} />

      <MatchHistoryCard
        matches={profile.recentMatches}
        ddragonVersion={ddragonVersion}
        summonerSpellIcons={summonerSpellIcons}
        puuid={profile.puuid}
        tier={rankTier}
        platform={target.platform}
        onOpenProfile={onOpenProfile}
      />
    </div>
  );
}

// Web's PerformanceBadges (src/components/performance-badges.tsx): one pill
// per skill-radar axis that clears a strength/focus threshold, same
// benchmark-derived data already feeding SkillRadarCard — never a separate
// computation.
const AXIS_ICON: Record<SkillAxis, LucideIcon> = {
  farm: Wheat,
  vision: Eye,
  kda: Crosshair,
  killParticipation: Swords,
  damage: Flame,
};

function badgeIcon(badge: PerformanceBadge): LucideIcon {
  if (badge.key === "wellRounded") return Sparkles;
  if (badge.key === "focus") return Target;
  return AXIS_ICON[badge.axis as SkillAxis];
}

function PerformanceBadgesRow({ points }: { points: SkillRadarPoint[] }) {
  const { t } = useI18n();
  const badges = computePerformanceBadges(points);
  if (badges.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {badges.map((badge) => {
        const Icon = badgeIcon(badge);
        const axisLabel = badge.axis ? t(`ProfileSearch.axis.${badge.axis}`) : "";
        const label =
          badge.key === "focus"
            ? t("ProfileSearch.badges.focus.label", { axis: axisLabel })
            : t(`ProfileSearch.badges.${badge.key}.label`);
        const colors =
          badge.sentiment === "good"
            ? { border: `${COLORS.goodMild}4d`, bg: `${COLORS.goodMild}1a`, text: COLORS.goodMild }
            : badge.sentiment === "bad"
              ? { border: `${COLORS.badMild}4d`, bg: `${COLORS.badMild}1a`, text: COLORS.badMild }
              : { border: COLORS.cardBorder, bg: "transparent", text: COLORS.muted };
        return (
          <span
            key={`${badge.key}-${badge.axis ?? ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              border: `1px solid ${colors.border}`,
              background: colors.bg,
              color: colors.text,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Icon size={13} />
            {label}
          </span>
        );
      })}
    </div>
  );
}

// Web's RankCard (src/app/[locale]/profile/[platform]/[riotId]/page.tsx):
// rank info and that queue's own role breakdown live in the SAME card,
// side by side, rather than a standalone role-breakdown card further down
// the page.
function RankCard({ title, entry, roleStats }: { title: string; entry: RiotLeagueEntry | null; roleStats: RoleStats[] }) {
  const { t } = useI18n();
  const emblem = entry ? rankEmblemUrl(entry.tier) : null;
  const total = entry ? entry.wins + entry.losses : 0;
  const winPct = total > 0 && entry ? Math.round((entry.wins / total) * 100) : 0;
  return (
    <div style={{ ...cardStyle, borderTop: entry ? `2px solid ${lpTierColor(entry.tier)}` : cardStyle.border, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 12, color: COLORS.muted }}>{title}</span>
      {/* flex:1 + centered, not just marginTop — so a row that stretches
          this card taller than its own content re-centers the actual
          rank/role info in the extra height instead of leaving it pinned
          to the top with dead space below. */}
      <div style={{ flex: 1, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 8 }}>
        {entry ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {emblem ? (
              <img src={emblem} alt={entry.tier} style={{ width: 40, height: 40 }} />
            ) : null}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>
                {formatTierRank(entry.tier, entry.rank)} · {entry.leaguePoints} LP
              </span>
              <span style={{ fontSize: 12, color: COLORS.muted }}>
                {t("ProfileSearch.winLossRate", { wins: entry.wins, losses: entry.losses, rate: winPct })}
              </span>
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 14, color: COLORS.muted }}>{t("ProfileSearch.unranked")}</span>
        )}
        {roleStats.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {roleStats.map((r) => {
              const icon = positionIconUrl(r.position);
              const rate = r.games > 0 ? `${Math.round((r.wins / r.games) * 100)}%` : "—";
              return (
                <div key={r.position} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  {icon ? <img src={icon} alt="" style={{ width: 13, height: 13, flexShrink: 0 }} /> : null}
                  <span style={{ width: 48, flexShrink: 0, color: COLORS.muted }}>
                    {t(`Profile.positions.${r.position.toLowerCase()}`)}
                  </span>
                  <span style={{ width: 28, flexShrink: 0, fontWeight: 600 }}>{rate}</span>
                  <span style={{ color: COLORS.muted }}>({r.games})</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Matches the web's SkillRadarChart shape (a real polar/spider chart, not
// a bar list) — same 5 axes, same 0-150 scale (100 = on-benchmark). Hand-
// rolled SVG rather than pulling in a charting library, same approach the
// sidebar's InlineLpSparkline (MainView.tsx) already uses for its own chart.
function SkillRadarSvg({ points }: { points: SkillRadarPoint[] }) {
  const { t } = useI18n();
  const size = 220;
  const center = size / 2;
  const maxRadius = size / 2 - 34;
  const maxValue = 150;
  const angleFor = (i: number) => (Math.PI * 2 * i) / points.length - Math.PI / 2;
  const coordFor = (i: number, value: number): [number, number] => {
    const r = (Math.min(maxValue, value) / maxValue) * maxRadius;
    const angle = angleFor(i);
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
  };
  const polygon = points.map((p, i) => coordFor(i, p.value).join(",")).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ margin: "0 auto", display: "block" }}>
      {[50, 100, 150].map((ring) => (
        <polygon
          key={ring}
          points={points.map((_, i) => coordFor(i, ring).join(",")).join(" ")}
          fill="none"
          stroke={COLORS.cardBorder}
          strokeWidth={1}
        />
      ))}
      {points.map((_, i) => {
        const [x, y] = coordFor(i, maxValue);
        return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke={COLORS.cardBorder} strokeWidth={1} />;
      })}
      <polygon points={polygon} fill={`${COLORS.rose}33`} stroke={COLORS.rose} strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => {
        const [x, y] = coordFor(i, maxValue + 30);
        return (
          <text key={p.axis} x={x} y={y} fill={COLORS.muted} fontSize={10} textAnchor="middle" dominantBaseline="middle">
            {t(`ProfileSearch.axis.${AXIS_LABEL_KEY[p.axis]}`)}
          </text>
        );
      })}
    </svg>
  );
}

function SkillRadarCard({ matches, tier }: { matches: RecentMatchSummary[]; tier: string | null }) {
  const { t } = useI18n();
  const points = computeSkillRadar(matches, tier);
  return (
    <div style={{ ...cardStyle, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ProfileSearch.skillOverview")}</span>
      {points.length === 0 ? (
        <p style={{ fontSize: 12, color: COLORS.muted, margin: "10px 0 0" }}>{t("ProfileSearch.noMatches")}</p>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", marginTop: 6 }}>
          <SkillRadarSvg points={points} />
        </div>
      )}
    </div>
  );
}

// LP over time, real snapshots only (lib/riot/rank-snapshot.ts on the web
// side, same source) — never fabricated history. Same gradient-fill
// polyline pattern as InlineLpSparkline, just full-size.
function RankTrendCard({ lpHistory, matches }: { lpHistory: ProfileApiResponse["lpHistory"]; matches: RecentMatchSummary[] }) {
  const { t } = useI18n();
  const gradientId = useId();

  // Same fallback the web's RankTrendChart uses (rank-trend-chart.tsx): a
  // single real LP snapshot can't draw a line. Riot's API has no
  // LP-history endpoint, so absent ≥2 of our own snapshots this plots a
  // running win(+1)/loss(-1) tally from real match results instead — an
  // honest momentum line, not fabricated LP.
  if (lpHistory.length < 2) {
    if (matches.length === 0) return null;
    return <MomentumTrendCard matches={matches} />;
  }

  const width = 400;
  const height = 140;
  const values = lpHistory.map((h) => h.leaguePoints);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const trendingUp = values[values.length - 1] >= values[0];
  const color = trendingUp ? COLORS.goodMild : COLORS.badMild;
  const latest = lpHistory[lpHistory.length - 1];

  return (
    <div style={{ ...cardStyle, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ProfileSearch.rankTrend")}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{formatTierRank(latest.tier, latest.rank)}</span>
        <span style={{ fontSize: 12, color: COLORS.muted }}>{latest.leaguePoints} LP</span>
      </div>
      {/* height:100% (not a fixed px height) — a row that stretches this
          card taller than its own natural content grows the chart itself
          instead of leaving empty space around a fixed-size one;
          preserveAspectRatio "none" already means the viewBox freely
          rescales to the real rendered box. */}
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ marginTop: 8, display: "block", flex: 1, minHeight: 80 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill={`url(#${gradientId})`} />
        <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// Win/loss momentum fallback for RankTrendCard above — same data and math
// as the web's RankTrendChart (rank-trend-chart.tsx) when it has fewer
// than 2 real LP snapshots: a running +1/-1 tally across recent games,
// zero-referenced so a losing stretch reads as a real dip below the line.
function MomentumTrendCard({ matches }: { matches: RecentMatchSummary[] }) {
  const { t } = useI18n();
  const gradientId = useId();
  const width = 400;
  const height = 140;

  const reversed = [...matches].reverse();
  const momentum = reversed.map((_, index) => {
    const soFar = reversed.slice(0, index + 1);
    return soFar.filter((m) => m.win).length - soFar.filter((m) => !m.win).length;
  });
  const current = momentum[momentum.length - 1];
  const color = current >= 0 ? COLORS.goodMild : COLORS.badMild;

  const scaleValues = [...momentum, 0];
  const min = Math.min(...scaleValues);
  const max = Math.max(...scaleValues);
  const range = max - min || 1;
  const pad = range * 0.15;
  const paddedMin = min - pad;
  const paddedRange = range + pad * 2;
  const y = (v: number) => height - ((v - paddedMin) / paddedRange) * height;
  const zeroY = y(0);

  const points = momentum
    .map((v, i) => `${(i / Math.max(1, momentum.length - 1)) * width},${y(v)}`)
    .join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <div style={{ ...cardStyle, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ProfileSearch.rankTrend")}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color }}>
          {current > 0 ? "+" : current < 0 ? "−" : ""}
          {Math.abs(current)}
        </span>
        <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ProfileSearch.momentumSubtitle")}</span>
      </div>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ marginTop: 8, display: "block", flex: 1, minHeight: 80 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={COLORS.muted} strokeOpacity={0.35} strokeDasharray="4 4" />
        <polygon points={areaPoints} fill={`url(#${gradientId})`} />
        <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function ActivityCalendarCard({ matches, puuid, platform }: { matches: RecentMatchSummary[]; puuid: string; platform: string }) {
  const { t, locale } = useI18n();
  const now = new Date();
  // null = the current month, rendered from `matches` the profile fetch
  // already brought back — free, no extra Riot call. Any other month needs
  // a real fetch (/api/v1/activity-calendar), same as the web page's own
  // month navigation.
  const [viewedMonth, setViewedMonth] = useState<{ year: number; monthIndex: number } | null>(null);
  const [monthState, setMonthState] = useState<
    { kind: "idle" } | { kind: "loading" } | ({ kind: "error" } & FetchProfileError) | { kind: "ok"; days: DayActivity[] }
  >({ kind: "idle" });

  const isCurrentMonth = viewedMonth === null;
  const targetYear = viewedMonth?.year ?? now.getFullYear();
  const targetMonthIndex = viewedMonth?.monthIndex ?? now.getMonth();

  useEffect(() => {
    if (isCurrentMonth) {
      setMonthState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setMonthState({ kind: "loading" });
    fetchActivityCalendarMonth(platform, puuid, targetYear, targetMonthIndex + 1).then((result) => {
      if (cancelled) return;
      if (Array.isArray(result)) setMonthState({ kind: "ok", days: result });
      else setMonthState({ kind: "error", ...result });
    });
    return () => {
      cancelled = true;
    };
  }, [isCurrentMonth, platform, puuid, targetYear, targetMonthIndex]);

  const grid = isCurrentMonth ? buildActivityGrid(matches) : monthState.kind === "ok" ? monthState.days : [];
  const firstDate = new Date(targetYear, targetMonthIndex, 1);
  const leadingBlanks = firstDate.getDay();
  // Local Y-M-D, not `new Date().toISOString()` (that's UTC — same
  // hydration-date gotcha CLAUDE.md already documents elsewhere) — grid
  // dates are lexicographically comparable in this format, so a plain
  // string compare is enough to tell a future day from today/the past.
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // Explicit `locale`, not `undefined` (which reads the OS locale instead
  // of the one the user picked in Ajustes) — same bug class as the web's
  // hydration gotcha around Intl without a real locale (see CLAUDE.md).
  const monthLabel = firstDate.toLocaleDateString(locale, { month: "long", year: "numeric" });
  // Same reference-Sunday trick as the web's ActivityCalendar, so the
  // weekday initials always read Sun..Sat regardless of what day of the
  // month `firstDate` happens to be.
  const referenceSunday = new Date(2026, 0, 4);
  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(
      new Date(referenceSunday.getFullYear(), referenceSunday.getMonth(), referenceSunday.getDate() + i),
    ),
  );

  function goToMonth(monthDelta: number) {
    const d = new Date(targetYear, targetMonthIndex + monthDelta, 1);
    const isBackToCurrent = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    setViewedMonth(isBackToCurrent ? null : { year: d.getFullYear(), monthIndex: d.getMonth() });
  }

  return (
    <div style={{ ...cardStyle, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>
          {t("ProfileSearch.activityCalendar")} · {monthLabel}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            onClick={() => goToMonth(-1)}
            aria-label={t("ProfileSearch.previousMonth")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, border: "none", background: "none", color: COLORS.muted, cursor: "pointer", borderRadius: 4 }}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => !isCurrentMonth && goToMonth(1)}
            disabled={isCurrentMonth}
            aria-label={t("ProfileSearch.nextMonth")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              border: "none",
              background: "none",
              color: isCurrentMonth ? `${COLORS.muted}4d` : COLORS.muted,
              cursor: isCurrentMonth ? "default" : "pointer",
              borderRadius: 4,
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {monthState.kind === "loading" ? (
        <p style={{ fontSize: 12, color: COLORS.muted, margin: "10px 0 0" }}>{t("ProfileSearch.loading")}</p>
      ) : monthState.kind === "error" ? (
        <p style={{ fontSize: 12, color: COLORS.rose, margin: "10px 0 0" }}>
          {t(`ProfileSearch.errors.${errorMessageKey(monthState.error, monthState.status)}`)}
        </p>
      ) : (
      // Fluid, up to a cap (same idea as the web's ActivityCalendar,
      // mx-auto max-w-[280px]) instead of a fixed 26px cell size — the
      // card this sits in can be a lot wider than 7×26px on a real
      // window, which would otherwise leave the grid looking tiny relative
      // to it. Cells stay square (day count fixes the grid's real height),
      // so a taller row just centers this block vertically instead of
      // stretching cells into rectangles.
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", maxWidth: 320, margin: "10px auto 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
          {weekdayLabels.map((label, i) => (
            <span key={i} style={{ textAlign: "center", fontSize: 11, color: COLORS.muted }}>
              {label}
            </span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, marginTop: 4 }}>
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {grid.map((day) => {
          const dayNum = Number(day.date.slice(-2));
          const isFuture = day.date > todayKey;
          const bg =
            day.games === 0
              ? `${COLORS.background}99`
              : day.wins > day.losses
                ? `${COLORS.goodMild}66`
                : day.wins < day.losses
                  ? `${COLORS.badMild}66`
                  : `${COLORS.muted}66`;
          return (
            <div
              key={day.date}
              title={isFuture ? undefined : t("ProfileSearch.activityDayTitle", { games: day.games, wins: day.wins, losses: day.losses })}
              style={{
                width: "100%",
                aspectRatio: "1",
                borderRadius: 5,
                background: bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: day.games === 0 ? COLORS.muted : COLORS.text,
                // Not-yet-played days stay in the grid (so the month never
                // looks broken/empty right after it starts) but read as
                // clearly distinct from real, already-played days.
                opacity: isFuture ? 0.35 : 1,
              }}
            >
              {dayNum}
            </div>
          );
        })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 11, color: COLORS.muted }}>
          <span>{t("ProfileSearch.activityLegendLoss")}</span>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: COLORS.badMild }} />
          <span style={{ width: 12, height: 12, borderRadius: 3, background: `${COLORS.muted}66` }} />
          <span style={{ width: 12, height: 12, borderRadius: 3, background: COLORS.goodMild }} />
          <span>{t("ProfileSearch.activityLegendWin")}</span>
        </div>
      </div>
      )}
    </div>
  );
}

// Real, already-played champions only per role — see
// profile-analysis.ts::computeChampionPool for why this deliberately
// never recommends a champion the player hasn't actually played.
function ChampionPoolCard({
  matches,
  ddragonVersion,
}: {
  matches: RecentMatchSummary[];
  ddragonVersion: string;
}) {
  const { t } = useI18n();
  const pools = computeChampionPool(matches);
  if (pools.length === 0) return null;

  return (
    <div style={cardStyle}>
      <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ProfileSearch.championPool")}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 10 }}>
        {pools.map((pool) => {
          const icon = positionIconUrl(pool.position);
          return (
            <div key={pool.position} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ width: 76, flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
                {icon ? <img src={icon} alt="" style={{ width: 14, height: 14 }} /> : null}
                <span style={{ fontSize: 11, color: COLORS.muted }}>{t(`Profile.positions.${pool.position.toLowerCase()}`)}</span>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {pool.champions.map((c) => {
                  const winPct = c.games > 0 ? Math.round((c.wins / c.games) * 100) : 0;
                  return (
                    <div key={c.championName} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: 56 }}>
                      <img
                        src={championSquareUrl(ddragonVersion, c.championName)}
                        alt=""
                        style={{ width: 36, height: 36, borderRadius: 8 }}
                      />
                      <span
                        style={{ fontSize: 10, fontWeight: 600, maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={c.championName}
                      >
                        {c.championName}
                      </span>
                      <span style={{ fontSize: 10, color: COLORS.muted }}>
                        {c.games}G · {winPct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoadmapCard({ matches, tier }: { matches: RecentMatchSummary[]; tier: string | null }) {
  const { t } = useI18n();
  const nodes = computeRoadmap(matches, tier);
  const topPriority = nodes.find((n) => n.status === "below");
  return (
    <div style={cardStyle}>
      <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ProfileSearch.roadmap")}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {topPriority ? (
          <p style={{ margin: 0, padding: "8px 10px", borderRadius: 6, border: `1px solid ${COLORS.rose}4d`, background: `${COLORS.rose}0d`, fontSize: 12 }}>
            <span style={{ fontWeight: 600, color: COLORS.rose }}>{t("Roadmap.priorityLabel")}</span>{" "}
            <span style={{ color: COLORS.muted }}>{t(`Roadmap.${topPriority.metric}.title`)}</span>
          </p>
        ) : null}
        {nodes.map((n) => (
          <RoadmapRow key={n.metric} node={n} />
        ))}
        {nodes.length === 0 ? <p style={{ fontSize: 12, color: COLORS.muted, margin: 0 }}>{t("ProfileSearch.noMatches")}</p> : null}
      </div>
    </div>
  );
}

// Same fillPct/track-and-fill pattern as the web's ImprovementRoadmap
// (src/components/improvement-roadmap.tsx) — a bare number/arrow told you
// which side of the target you were on, but not how close, which is the
// whole point of a "roadmap".
function RoadmapRow({ node }: { node: RoadmapNode }) {
  const { t } = useI18n();
  const above = node.status === "above";
  const color = above ? COLORS.goodMild : COLORS.badMild;
  const unit = node.metric === "laningAdvantage" ? "%" : "";
  const fillPct = Math.min(100, Math.round((node.value / node.target) * 100));
  // Same lookup as the web's ImprovementRoadmap (improvement-roadmap.tsx) —
  // laningAdvantage's tip is role-scoped (jungle vs laner), the other three
  // metrics aren't.
  const tipKey = node.role
    ? `Roadmap.${node.metric}.${above ? "tipAbove" : "tipBelow"}.${node.role}.${node.band}`
    : `Roadmap.${node.metric}.${above ? "tipAbove" : "tipBelow"}.${node.band}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>{t(`ProfileSearch.metric.${node.metric}`)}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>
          {node.value}
          {unit} {above ? "↑" : "↓"} {t("ProfileSearch.target")} {node.target}
          {unit}
        </span>
      </div>
      <div style={{ height: 6, width: "100%", borderRadius: 999, background: `${COLORS.goodMild}1a`, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${fillPct}%`, borderRadius: 999, background: color }} />
      </div>
      <p style={{ fontSize: 11, color: COLORS.muted, margin: 0, lineHeight: 1.5 }}>{t(tipKey)}</p>
    </div>
  );
}

// Web's ChampionOverview (src/components/champion-overview.tsx): the
// player's most-played champions across all roles in this match sample,
// paired next to the activity calendar — distinct from ChampionPoolCard
// below, which groups real mastery per role instead of raw play count.
function ChampionOverviewCard({ matches, ddragonVersion }: { matches: RecentMatchSummary[]; ddragonVersion: string }) {
  const { t } = useI18n();
  const rows = computeChampionOverview(matches);
  if (rows.length === 0) return null;

  return (
    <div style={{ ...cardStyle, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ProfileSearch.championOverviewTitle")}</span>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", marginTop: 10, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: COLORS.muted }}>
              <th style={{ paddingBottom: 6, fontWeight: 500 }}>{t("ProfileSearch.championOverviewChampion")}</th>
              <th style={{ paddingBottom: 6, fontWeight: 500, textAlign: "right" }}>{t("ProfileSearch.championOverviewGames")}</th>
              <th style={{ paddingBottom: 6, fontWeight: 500, textAlign: "right" }}>{t("ProfileSearch.championOverviewWinRate")}</th>
              <th style={{ paddingBottom: 6, fontWeight: 500, textAlign: "right" }}>{t("ProfileSearch.championOverviewKda")}</th>
              <th style={{ paddingBottom: 6, fontWeight: 500, textAlign: "right" }}>{t("ProfileSearch.championOverviewCsPerMin")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const winRate = Math.round((row.wins / row.games) * 100);
              const kda = Math.round(((row.kills + row.assists) / Math.max(1, row.deaths)) * 10) / 10;
              const csPerMin = Math.round((row.cs / Math.max(1, row.minutes)) * 10) / 10;
              return (
                <tr key={row.championName} style={{ borderTop: `1px solid ${COLORS.cardBorder}` }}>
                  <td style={{ padding: "6px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <img src={championSquareUrl(ddragonVersion, row.championName)} alt="" style={{ width: 24, height: 24, borderRadius: 5 }} />
                      <span style={{ fontWeight: 500 }}>{row.championName}</span>
                    </div>
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right", color: COLORS.muted }}>{row.games}</td>
                  <td
                    style={{
                      padding: "6px 0",
                      textAlign: "right",
                      fontWeight: 600,
                      color: winRate >= 50 ? COLORS.goodMild : COLORS.badMild,
                    }}
                  >
                    {winRate}%
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right", color: COLORS.muted }}>{kda}</td>
                  <td style={{ padding: "6px 0", textAlign: "right", color: COLORS.muted }}>{csPerMin}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchHistoryCard({
  matches,
  ddragonVersion,
  summonerSpellIcons,
  puuid,
  tier,
  platform,
  onOpenProfile,
}: {
  matches: RecentMatchSummary[];
  ddragonVersion: string;
  summonerSpellIcons: Record<number, string>;
  puuid: string;
  tier: string | null;
  platform: string;
  onOpenProfile: (target: ProfileTarget) => void;
}) {
  const { t } = useI18n();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div style={cardStyle}>
      <span style={{ fontSize: 12, color: COLORS.muted }}>{t("ProfileSearch.recentMatches")}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {matches.length === 0 ? <p style={{ fontSize: 12, color: COLORS.muted, margin: 0 }}>{t("ProfileSearch.noMatches")}</p> : null}
        {matches.map((m) => {
          const isOpen = expandedId === m.matchId;
          const note = summarizeMatchPerformance(m, tier);
          return (
            <div key={m.matchId} style={{ borderRadius: 8, overflow: "hidden", background: `${COLORS.background}66` }}>
              <button
                onClick={() => setExpandedId(isOpen ? null : m.matchId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  width: "100%",
                  background: "none",
                  border: "none",
                  borderLeftWidth: 3,
                  borderLeftStyle: "solid",
                  borderLeftColor: m.win ? COLORS.goodMild : COLORS.badMild,
                  cursor: "pointer",
                  color: COLORS.text,
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <img src={championSquareUrl(ddragonVersion, m.championName)} alt={m.championName} style={{ width: 28, height: 28, borderRadius: 6 }} />
                  {positionIconUrl(m.teamPosition) ? (
                    <img
                      src={positionIconUrl(m.teamPosition)!}
                      alt={m.teamPosition}
                      style={{ position: "absolute", bottom: -3, right: -3, width: 13, height: 13, borderRadius: "50%", background: COLORS.background, padding: 1 }}
                    />
                  ) : null}
                </div>
                <span style={{ width: 60, flexShrink: 0, fontSize: 12, fontWeight: 600, color: m.win ? COLORS.goodMild : COLORS.badMild }}>
                  {m.win ? t("ProfileSearch.win") : t("ProfileSearch.loss")}
                </span>
                <span style={{ width: 80, flexShrink: 0, fontSize: 12 }}>
                  {m.kills}/{m.deaths}/{m.assists}
                </span>
                <span style={{ width: 70, flexShrink: 0, fontSize: 11, color: COLORS.muted }}>{m.cs} CS</span>
                <span style={{ width: 90, flexShrink: 0, fontSize: 11, color: COLORS.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.queueName}
                </span>
                <span
                  title={t(`ProfileSearch.axis.${note.axis === "wellRounded" ? "farm" : note.axis}`)}
                  style={{
                    width: 34,
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: "right",
                    color: note.scoreSentiment === "good" ? COLORS.goodMild : note.scoreSentiment === "bad" ? COLORS.badMild : COLORS.muted,
                  }}
                >
                  {note.score.toFixed(1)}
                </span>
                <span style={{ flex: 1, fontSize: 11, color: COLORS.muted, textAlign: "right" }}>{Math.round(m.durationSeconds / 60)}m</span>
                {/* Same circular chevron badge as the web's
                    match-history.tsx (h-7 w-7 rounded-full border, rose
                    border/bg/text + 180° rotation when open), not a bare
                    icon inline in the row. */}
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    flexShrink: 0,
                    borderRadius: 999,
                    border: `1px solid ${isOpen ? `${COLORS.rose}80` : COLORS.cardBorder}`,
                    background: isOpen ? `${COLORS.rose}1a` : "transparent",
                    color: isOpen ? COLORS.rose : COLORS.muted,
                    transform: isOpen ? "rotate(180deg)" : undefined,
                    transition: "transform 200ms, border-color 200ms, background 200ms, color 200ms",
                  }}
                >
                  <ChevronDown size={14} />
                </span>
              </button>
              {isOpen ? (
                <MatchScoreboard
                  match={m}
                  puuid={puuid}
                  tier={tier}
                  ddragonVersion={ddragonVersion}
                  summonerSpellIcons={summonerSpellIcons}
                  platform={platform}
                  onOpenProfile={onOpenProfile}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Expandable match scoreboard, like the web's (match-history.tsx): the
// same real per-participant stats already in the match payload, scored
// with the same honest benchmark formula (see summarizeParticipant in
// lib/profile-analysis.ts) applied to all 10 players instead of only the
// tracked one. Same level of detail as the web's own scoreboard — team
// header (result/KDA/gold/objectives), column headers, and per player:
// level badge, summoner spells, kill participation, gold, a damage bar
// (not just the raw number), and the real 7-slot item build.
function MatchScoreboard({
  match,
  puuid,
  tier,
  ddragonVersion,
  summonerSpellIcons,
  platform,
  onOpenProfile,
}: {
  match: RecentMatchSummary;
  puuid: string;
  tier: string | null;
  ddragonVersion: string;
  summonerSpellIcons: Record<number, string>;
  platform: string;
  onOpenProfile: (target: ProfileTarget) => void;
}) {
  const { t } = useI18n();
  const teamA = match.participants.filter((p) => p.teamId === 100);
  const teamB = match.participants.filter((p) => p.teamId === 200);
  const teamASummary = match.teams.find((tm) => tm.teamId === 100);
  const teamBSummary = match.teams.find((tm) => tm.teamId === 200);
  const maxDamage = Math.max(1, ...match.participants.map((p) => p.damageDealt));
  const minutes = Math.max(1, match.durationSeconds / 60);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 10px 12px", borderTop: `1px solid ${COLORS.cardBorder}`, overflowX: "auto" }}>
      {[
        { team: teamA, summary: teamASummary },
        { team: teamB, summary: teamBSummary },
      ].map(({ team, summary }, i) => {
        if (!summary) return null;
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 620 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                borderRadius: 6,
                background: `${COLORS.background}66`,
                padding: "5px 10px",
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 600, color: summary.win ? COLORS.goodMild : COLORS.badMild }}>
                {t(summary.teamId === 100 ? "ProfileSearch.blueTeam" : "ProfileSearch.redTeam")} ·{" "}
                {summary.win ? t("ProfileSearch.win") : t("ProfileSearch.loss")}
              </span>
              <span style={{ color: COLORS.muted }}>
                {summary.kills}/{summary.deaths}/{summary.assists} · {summary.goldEarned.toLocaleString()}g ·{" "}
                {t("ProfileSearch.objectives", {
                  dragons: summary.dragonKills,
                  barons: summary.baronKills,
                  towers: summary.towerKills,
                  heralds: summary.riftHeraldKills,
                })}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px", fontSize: 11, color: COLORS.muted }}>
              <div style={{ width: 22, flexShrink: 0 }} />
              <div style={{ width: 14, flexShrink: 0 }} />
              <span style={{ width: 130, flexShrink: 0 }}>{t("ProfileSearch.matchColumns.player")}</span>
              <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>{t("ProfileSearch.matchColumns.kda")}</span>
              <span style={{ width: 70, flexShrink: 0, textAlign: "right" }}>{t("ProfileSearch.matchColumns.cs")}</span>
              <span style={{ width: 40, flexShrink: 0, textAlign: "right" }}>{t("ProfileSearch.matchColumns.kp")}</span>
              <span style={{ width: 56, flexShrink: 0, textAlign: "right" }}>{t("ProfileSearch.matchColumns.gold")}</span>
              <span style={{ minWidth: 90, flex: 1, textAlign: "right" }}>{t("ProfileSearch.matchColumns.damage")}</span>
              <span style={{ width: 144, flexShrink: 0, textAlign: "right" }}>{t("ProfileSearch.matchColumns.items")}</span>
            </div>
            {team.map((p) => {
              const note = summarizeParticipant(p, match.durationSeconds, match.teams, tier);
              const isTracked = p.puuid === puuid;
              const csPerMin = Math.round((p.cs / minutes) * 10) / 10;
              return (
                <button
                  key={p.puuid}
                  onClick={() => !isTracked && onOpenProfile({ platform, gameName: p.gameName, tagLine: p.tagLine })}
                  disabled={isTracked}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 8px",
                    borderRadius: 6,
                    background: isTracked ? `${COLORS.rose}14` : "transparent",
                    border: "none",
                    width: "100%",
                    cursor: isTracked ? "default" : "pointer",
                    color: COLORS.text,
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <div style={{ position: "relative", width: 22, height: 22, flexShrink: 0 }}>
                    <img src={championSquareUrl(ddragonVersion, p.championName)} alt={p.championName} style={{ width: 22, height: 22, borderRadius: 5 }} />
                    <span
                      style={{
                        position: "absolute",
                        bottom: -3,
                        right: -3,
                        borderRadius: 3,
                        background: COLORS.background,
                        padding: "0 2px",
                        fontSize: 8,
                        lineHeight: "10px",
                        color: COLORS.muted,
                      }}
                    >
                      {p.champLevel}
                    </span>
                  </div>
                  <div style={{ width: 14, flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    {p.summonerSpells.map((spellId, i) =>
                      summonerSpellIcons[spellId] ? (
                        <img key={i} src={summonerSpellIcons[spellId]} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} />
                      ) : (
                        <div key={i} style={{ width: 14, height: 14 }} />
                      ),
                    )}
                  </div>
                  <span
                    style={{
                      width: 130,
                      flexShrink: 0,
                      fontSize: 12,
                      fontWeight: isTracked ? 700 : 400,
                      color: isTracked ? COLORS.text : COLORS.muted,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.gameName}
                  </span>
                  <span style={{ width: 64, flexShrink: 0, fontSize: 11, textAlign: "right", color: COLORS.text }}>
                    {p.kills}/{p.deaths}/{p.assists}
                  </span>
                  <span style={{ width: 70, flexShrink: 0, fontSize: 11, textAlign: "right", color: COLORS.muted }}>
                    {p.cs} ({csPerMin})
                  </span>
                  <span style={{ width: 40, flexShrink: 0, fontSize: 11, textAlign: "right", color: COLORS.muted }}>
                    {Math.round(p.killParticipation * 100)}%
                  </span>
                  <span style={{ width: 56, flexShrink: 0, fontSize: 11, textAlign: "right", color: COLORS.muted }}>
                    {p.goldEarned.toLocaleString()}g
                  </span>
                  <div style={{ minWidth: 90, flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 46, flexShrink: 0, textAlign: "right", fontSize: 11, color: COLORS.muted }}>
                      {p.damageDealt.toLocaleString()}
                    </span>
                    <div style={{ flex: 1, height: 5, borderRadius: 999, background: `${COLORS.background}99`, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.round((p.damageDealt / maxDamage) * 100)}%`,
                          borderRadius: 999,
                          background: p.win ? COLORS.goodMild : COLORS.badMild,
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ width: 144, flexShrink: 0, display: "flex", justifyContent: "flex-end", gap: 2 }}>
                    {p.items.map((itemId, i) =>
                      itemId ? (
                        <img key={i} src={itemIconUrl(ddragonVersion, itemId)} alt="" style={{ width: 18, height: 18, borderRadius: 3 }} />
                      ) : (
                        <div key={i} style={{ width: 18, height: 18, borderRadius: 3, background: `${COLORS.card}` }} />
                      ),
                    )}
                  </div>
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                      color: note.scoreSentiment === "good" ? COLORS.goodMild : note.scoreSentiment === "bad" ? COLORS.badMild : COLORS.muted,
                    }}
                  >
                    {note.score.toFixed(1)}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// The "Buscar de nuevo" popover — same minimal shape as the header's own
// HeaderProfileSearch on the Herramientas screen (MainView.tsx), just
// anchored to the button instead of sitting in the page header.
function SearchAgainBlock({ defaultPlatform, onOpen }: { defaultPlatform: string; onOpen: (target: ProfileTarget) => void }) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState(defaultPlatform);
  const [riotId, setRiotId] = useState("");
  const [error, setError] = useState(false);
  const savedProfiles = useSavedProfiles();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseRiotId(riotId);
    if (!parsed) {
      setError(true);
      return;
    }
    onOpen({ platform, gameName: parsed.gameName, tagLine: parsed.tagLine });
  }

  return (
    <div>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <PlatformSelect value={platform} onChange={setPlatform} />
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <input
              value={riotId}
              onChange={(e) => {
                setRiotId(e.target.value);
                setError(false);
              }}
              placeholder={t("ProfileSearch.riotIdPlaceholder")}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingRight: 24, borderColor: error ? COLORS.rose : COLORS.cardBorder }}
            />
            <CompareSavedProfilePicker profiles={savedProfiles} onPick={onOpen} />
          </div>
        </div>
        {error ? <span style={{ fontSize: 11, color: COLORS.rose }}>{t("ProfileSearch.invalidRiotId")}</span> : null}
        <button type="submit" style={secondaryButtonStyle}>
          {t("ProfileSearch.searchButton")}
        </button>
      </form>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: COLORS.rose,
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
