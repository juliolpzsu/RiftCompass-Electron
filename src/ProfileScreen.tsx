import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  Flame,
  GitCompare,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  ShieldAlert,
  Sparkles,
  Swords,
  Target,
  Wheat,
  X,
  type LucideIcon,
} from "lucide-react";
import { API_BASE_URL } from "./shared/api";
import { COLORS, FONT_HEADING } from "./theme";
import { useI18n } from "./i18n";
import { championSquareUrl, profileIconUrl, itemIconUrl, fetchSummonerSpellIconsById } from "./ddragon";
import { ChampionSplashAccent } from "./ChampionSplashAccent";
import { PLATFORM_LABELS, formatTierRank, tierColor as lpTierColor } from "./lib/rank-lp";
import {
  buildActivityGrid,
  computeChampionOverview,
  computeChampionPool,
  computeHeadToHead,
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
  type HeadToHeadStat,
  type PerformanceBadge,
  type RoadmapMetric,
  type RoadmapNode,
  type RoleStats,
  type SkillAxis,
  type SkillRadarPoint,
} from "./lib/profile-analysis";
import type { ProfileApiResponse, RecentMatchSummary, RiotLeagueEntry } from "./lib/profile-types";
import type { SavedProfileWithRank } from "./riftcompass";

// Riot ID search + profile view + duo compare — same real data as
// riftcompass.com's own profile page (via the public
// GET /api/v1/profile/[platform]/[riotId]). Through 2026-08-27 this
// rendered as its own compact native UI, deliberately not a copy of the
// web page. Julio, 2026-08-28: "quiero que... muestre los datos tal y
// como se ven en la web, no hay necesidad de ese otro estilo diferente" —
// now matches the web profile page's own glass-card look and section set
// (rank, LP trend + skill radar, activity calendar, role breakdown,
// champion pool, roadmap, match history), computed from the same payload
// client-side rather than a copy-pasted DOM.
const PLATFORMS = Object.keys(PLATFORM_LABELS);

export function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
  const trimmed = input.trim();
  const idx = trimmed.lastIndexOf("#");
  if (idx <= 0 || idx === trimmed.length - 1) return null;
  return { gameName: trimmed.slice(0, idx).trim(), tagLine: trimmed.slice(idx + 1).trim() };
}

interface FetchProfileError {
  error: string;
  // The web route's real HTTP status (404/429/502/…), not just its error
  // code — every call site here used to collapse EVERY non-network failure
  // into the same "Riot ID not found, check spelling" copy, including a
  // real 429 from Riot's shared quota. Confirmed live 2026-08-29: with that
  // quota genuinely saturated (see RiftCompass-Web's own rate-limiting
  // work earlier this session), that made a real "try again in a bit"
  // condition read as "you typed the wrong name" — status lets each call
  // site tell the two apart (see errorMessageKey below).
  status?: number;
  // Only set on the force-refresh cooldown response (rateLimited from
  // /api/v1/profile's own checkRateLimit, not a real Riot 429) — the one
  // case a caller can show a real countdown instead of a generic error.
  retryAfterSeconds?: number;
}

async function fetchProfile(
  platform: string,
  gameName: string,
  tagLine: string,
  options: { force?: boolean } = {},
): Promise<ProfileApiResponse | FetchProfileError> {
  const slug = `${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
  const query = options.force ? "?force=true" : "";
  try {
    // A saturated Riot API quota can leave riftcompass.com's own function
    // hanging on an upstream retry instead of returning a real 429 quickly
    // (reproduced live 2026-09-01) — without a client-side cutoff that
    // read as an infinite "Cargando…" with nothing to act on. 15s is
    // generous for a normal response but still short enough that a real
    // hang surfaces as a "network" error with a retry button, not a stuck
    // spinner.
    const res = await fetch(`${API_BASE_URL}/api/v1/profile/${platform}/${slug}${query}`, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? "unknown", status: data.status ?? res.status, retryAfterSeconds: data.retryAfterSeconds };
    return data as ProfileApiResponse;
  } catch {
    return { error: "network" };
  }
}

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

// Which ProfileSearch.errors.* copy actually matches what happened —
// see FetchProfileError's own comment for why this needs `status`, not
// just the bare "riotApiError" code every failure used to share.
function errorMessageKey(error: string, status?: number): string {
  if (error === "network") return "network";
  if (error === "riotApiError") {
    if (status === 404) return "notFound";
    if (status === 429) return "rateLimited";
    return "server";
  }
  return "unknown";
}

export interface ProfileTarget {
  platform: string;
  gameName: string;
  tagLine: string;
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

// The logged-in account's saved profiles, for pickers that fill a search
// slot without retyping the Riot ID (same convenience the web's
// SavedProfilePicker gives). Empty while logged out.
function useSavedProfiles(): SavedProfileWithRank[] {
  const [profiles, setProfiles] = useState<SavedProfileWithRank[]>([]);
  useEffect(() => {
    let cancelled = false;
    window.riftcompass.getSavedProfiles().then((data) => {
      if (!cancelled) setProfiles(data.profiles);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return profiles;
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

// Standalone compare entry point: up to five search slots (a full team),
// compared side by side once at least two are filled.
const MAX_COMPARE_PLAYERS = 5;

// The 3 real sections the results screen renders once you compare
// (head-to-head + skill overview, shared weaknesses, roadmap comparison) —
// surfaced here as a preview so the empty-state screen pitches the tool
// instead of a lone form on an otherwise blank page. Same pattern the web
// app's /duo page moved to on 2026-09-01, Julio: "mejora el diseño antes
// de elegir a los jugadores" — see RiftCompass-Web's duo/page.tsx.
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

  // No more per-slot "Buscar" confirmation step (2026-09-01, Julio: "en
  // vez de existir un boton de buscar debe de buscarlo automaticamente al
  // darle al boton de comparar") — every slot stays a plain text input;
  // "Comparar" parses all of them at once (parseRiotId is local/offline,
  // just splitting "name#tag" — the real existence check already happens
  // in ProfileCompareResult's fetch, which already surfaces "not found"
  // with a retry button per player, exactly what "si alguno... no se ha
  // encontrado" asks for).
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
    // Two columns instead of one centered narrow form (2026-09-01, Julio,
    // porting the web's /duo redesign: "la caja de compara jugadores sigue
    // sin convencerme") — a plain-text pitch on the left doubling as a
    // table of contents for the results screen, the form on the right
    // split off with a border instead of its own boxed card.
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

// Portal-based dropdown panel, shared by ComparePlatformSelect and
// CompareSavedProfilePicker below so both look and behave identically
// (2026-09-01, Julio: "el desplegable de la región no tiene la estética
// del otro"). Rendered into document.body instead of as a normal
// descendant of its trigger — MainView.tsx's <main> wraps every screen's
// content in a `.rc-view-enter` div that plays a mount animation
// (opacity+transform); per spec, an element with a non-"none" animation
// touching those properties creates its own stacking context for as long
// as the animation is attached, which silently caps any z-index painted
// inside it below content elsewhere in the tree — confirmed live
// 2026-09-01, Julio: "el otro no se muestra por encima del resto de cosas
// por lo que no se ve bien". A portal escapes that trap entirely instead
// of chasing ever-higher z-index values against it. Position is computed
// from the trigger's real screen rect (recalculated on every open) since
// portaled content can no longer rely on `position:absolute` against an
// ancestor it's no longer inside.
function DropdownMenu({
  triggerRef,
  open,
  onClose,
  align = "left",
  minWidth,
  maxWidth = 280,
  maxHeight = 260,
  padding = 6,
  children,
}: {
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  minWidth?: number;
  // Both default to the small-option-list sizing every existing caller
  // (CompareSavedProfilePicker, ComparePlatformSelect) relies on — only a
  // caller with real form/table content (CompareBlock) needs to override
  // these to something roomier.
  maxWidth?: number;
  maxHeight?: number;
  padding?: number;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; right: number; width: number } | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setRect(null);
      return;
    }
    const r = triggerRef.current.getBoundingClientRect();
    setRect({ top: r.bottom, left: r.left, right: r.right, width: r.width });
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      // A DropdownMenu opened FROM inside another one (e.g. the saved-
      // profile picker's chevron inside the "Comparar con" popover) portals
      // to document.body too — a sibling in the real DOM, not a descendant
      // of this panel's own subtree, even though it's nested in the React
      // tree. Without this check, picking an option in that inner dropdown
      // read as a click "outside" this outer one and closed it before its
      // own onClick ever ran (Julio, 2026-09-01: "se cierra el desplegable
      // en vez de comparar con ese perfil") — every DropdownMenu panel
      // carries the same marker, so a click anywhere inside any of them
      // never counts as outside any of them.
      if (target instanceof Element && target.closest("[data-rc-dropdown]")) return;
      onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onClose, triggerRef]);

  if (!open || !rect) return null;
  return createPortal(
    <div
      ref={panelRef}
      data-rc-dropdown
      style={{
        position: "fixed",
        top: rect.top + 4,
        ...(align === "right" ? { right: window.innerWidth - rect.right } : { left: rect.left }),
        minWidth: minWidth ?? rect.width,
        maxWidth,
        maxHeight,
        overflowY: "auto",
        background: COLORS.card,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 8,
        padding,
        zIndex: 1000,
        boxShadow: "0 12px 24px -8px rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

const dropdownOptionStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "6px 8px",
  borderRadius: 6,
  border: "none",
  background: "none",
  color: COLORS.text,
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

// Same "just a chevron inside the Riot ID box" trigger as the web app's
// SavedProfilePicker (2026-09-01, Julio: "quiero que este en donde se
// escribe el nombre a mano... con una simple flecha").
function CompareSavedProfilePicker({
  profiles,
  onPick,
}: {
  profiles: SavedProfileWithRank[];
  onPick: (target: ProfileTarget) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (profiles.length === 0) return null;
  return (
    <div style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("ProfileSearch.pickSaved")}
        title={t("ProfileSearch.pickSaved")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          border: "none",
          background: "none",
          color: COLORS.muted,
          cursor: "pointer",
        }}
      >
        <ChevronDown size={14} />
      </button>
      <DropdownMenu triggerRef={triggerRef} open={open} onClose={() => setOpen(false)} align="right" minWidth={220}>
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onPick({ platform: p.platform, gameName: p.gameName, tagLine: p.tagLine });
              setOpen(false);
            }}
            style={dropdownOptionStyle}
          >
            {p.gameName}#{p.tagLine} <span style={{ color: COLORS.muted }}>· {PLATFORM_LABELS[p.platform] ?? p.platform}</span>
          </button>
        ))}
      </DropdownMenu>
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
          // Fixed width used to clip longer labels ("EUNE", "SEA") against
          // the chevron (2026-09-01, Julio flagged the region box size
          // twice) — sized to content instead, so no label can ever crowd
          // the icon regardless of language or which platform is picked.
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
    // No boxed card (2026-09-01, Julio, same "cajas solo donde de verdad
    // hacen falta" rule the web redesign followed) — just the label above
    // the row, same as every other slot in this form. Always a plain text
    // row now, no per-slot "confirmed" state — see ProfileCompareEntry's
    // handleCompare for why.
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
  // needing a real target change (2026-09-01, Julio: "ahora mismo no hay
  // usos de la api disponibles" while testing this screen — a rate-limit
  // failure had no way to try again except leaving and re-entering the
  // whole comparison).
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
          {/* Five players wrap as 3 + 2 (Julio, 2026-08-27) instead of the
              auto-fit's 4 + 1. */}
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

// The web /duo "Resumen de habilidades" benchmark, in this app's bar
// idiom instead of the web's radar chart: one bar per player per axis,
// colored with each player's accent so the same identity carries through.
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
// pattern the web's /duo page moved to on 2026-09-01, Julio: "debido a la
// cantidad de informacion en pantalla se ve poco claro". With two players
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
      {/* Closed by default, same as the web's roadmap-comparison.tsx
          (Julio, 2026-09-01: "los consejos no deben de aparecer desplegados
          por defecto para no cargar tanto visualmente la escena") — a
          native <details> needs no state here. */}
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
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ ...selectStyle, flexShrink: 0, width: 100 }}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
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
  // "Rendered more hooks than during the previous render" (reproduced live
  // 2026-08-29, Julio: "al intentar ver un perfil da pantalla en blanco").
  // Empty string here (state not "ok" yet) is a real, valid version the
  // hook itself now guards against fetching for.
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
        <p style={{ fontSize: 13, color: COLORS.rose }}>{t(`ProfileSearch.errors.${key}`)}</p>
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
          (MainView.tsx's HeaderProfileSearch) — Julio, 2026-09-01: "no
          quiero que abra una nueva ventana... que siga siendo un pequeño
          buscador tal y como hace en el menú". Picking a result calls
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

      {/* Anchored to the Comparar button itself (Julio, 2026-09-01: "que
          la caja de comparar... sea mas pequenia y este justo debajo del
          boton") — was a full-width card sitting inline in the page flow;
          same DropdownMenu portal every other popover in this file already
          uses, just with roomier sizing than the small option-list default
          since this one holds a real form and a result table. */}
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
          full-width alone) instead of ad-hoc pairs — 2026-09-01, Julio:
          the first two attempts either left ragged gaps between rows (a
          flat 8-card grid) or oversized cards with dead space inside
          (stretching a mismatched pair like RankTrend+Calendar to match
          each other). The web's actual pairing already groups cards whose
          natural content height is close (a rank card next to another
          rank card, a compact chart next to another compact chart, a
          taller grid next to a similarly-tall table) — same real content,
          same real height, just wider fractions here since the desktop
          window has more room than a web viewport. Each card's own
          internal layout (see cardStyle usage below) still centers its
          content vertically within row's `stretch`, so any residual
          height difference reads as intentional, not leftover space. */}
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
          this card taller than its own content (Julio, 2026-09-01: "las
          has hecho muy grandes y tienen espacio vacío inútil") re-centers
          the actual rank/role info in the extra height instead of leaving
          it pinned to the top with dead space below. */}
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

const AXIS_LABEL_KEY: Record<string, string> = {
  farm: "farm",
  vision: "vision",
  kda: "kda",
  killParticipation: "killParticipation",
  damage: "damage",
};

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
  // single real LP snapshot can't draw a line, and this app had no
  // fallback at all before — it just showed "not tracked yet" even though
  // real recent-match data was right there (Julio, 2026-08-29: "la
  // tendencia de rango... en la web tiene datos y en la app de escritorio
  // no"). Riot's API has no LP-history endpoint, so absent ≥2 of our own
  // snapshots this plots a running win(+1)/loss(-1) tally from real match
  // results instead — an honest momentum line, not fabricated LP.
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
          card taller than its own natural content (Julio, 2026-09-01:
          oversized cards with dead space) grows the chart itself instead
          of leaving empty space around a fixed-size one; preserveAspectRatio
          "none" already means the viewBox freely rescales to the real
          rendered box. */}
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

// Current-month heatmap grid, real games only — no navigation to past
// months (would need a fresh Riot Match-V5 range query the desktop app
// doesn't make today, see PROGRESS.md).
function ActivityCalendarCard({ matches, puuid, platform }: { matches: RecentMatchSummary[]; puuid: string; platform: string }) {
  const { t, locale } = useI18n();
  const now = new Date();
  // null = the current month, rendered from `matches` the profile fetch
  // already brought back — free, no extra Riot call. Any other month needs
  // a real fetch (/api/v1/activity-calendar), same as the web page's own
  // month navigation (Julio, 2026-09-01, explicit for both apps: "que
  // tambien se puedan navegar meses anteriores" once that endpoint
  // existed — see PROGRESS.md, previously out of scope for exactly this
  // reason).
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
      // window, leaving the grid looking tiny relative to it (Julio,
      // 2026-08-29). Cells stay square (day count fixes the grid's real
      // height), so a taller row just centers this block vertically
      // instead of stretching cells into rectangles.
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
// whole point of a "roadmap" (Julio, 2026-08-29: wanted the same bars the
// web already has).
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
// tracked one. Brought up to the web's own level of detail 2026-08-29
// (Julio: "en la app en partidas recientes cuando se abre el desplegable
// no se ve como en la web... en la web hay mucho más detalle") — team
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

function CompareBlock({
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

// Bigger and more generously spaced than a first pass had it (2026-09-01,
// Julio: comparing two players, this card read as noticeably smaller/less
// substantial than Skill Overview right next to it, even at equal grid
// width — the difference was content density, not column size). A
// border between rows gives each stat real vertical weight instead of
// just a tight list of numbers.
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

// Web's "Glass & Depth" Card (src/components/ui/card.tsx): rounded-xl
// (14px), bg-card/70 (COLORS.card at 70% = rgba(23,18,26,0.7) — same hex
// COLORS.card already mirrors), backdrop-blur-xl (24px), ring-1
// ring-foreground/10 (COLORS.text at 10%), shadow-lg shadow-black/20.
// 2026-08-28, Julio: "quiero que... muestre los datos tal y como se ven
// en la web, no hay necesidad de ese otro estilo diferente" — this
// profile screen used to deliberately diverge from the web's look; it no
// longer does.
// Flat card, no blur/glass — Julio, 2026-08-29: the glass-card look this
// commit's own history briefly introduced (matching riftcompass.com's own
// styling) was a misread of "muestre los datos tal y como se ven en la
// web" as "look like the website" when he meant "look like this app's own
// profile search" — which, being the same shared component, already had
// this flat style before that change. Reverted the shared visual language
// only; the content sections that commit added (rank trend, activity
// calendar, champion pool, SVG radar) stay, since those were never the
// complaint.
const cardStyle: React.CSSProperties = {
  borderRadius: 12,
  border: `1px solid ${COLORS.cardBorder}`,
  background: `${COLORS.card}99`,
  padding: 16,
};

const inputStyle: React.CSSProperties = {
  background: COLORS.background,
  color: COLORS.text,
  border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

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

const secondaryButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: 8,
  border: `1px solid ${COLORS.cardBorder}`,
  background: "none",
  color: COLORS.text,
  fontSize: 12,
  cursor: "pointer",
};
