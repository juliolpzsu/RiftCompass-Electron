import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { API_BASE_URL } from "../shared/api";
import { COLORS, TYPE, cardStyle as makeCardStyle, inputStyle } from "../theme";
import { useI18n } from "../i18n";
import { PLATFORM_LABELS } from "../lib/rank-lp";
import type { ProfileApiResponse } from "../lib/profile-types";
import type { SavedProfileWithRank } from "../riftcompass";

// Pieces genuinely used by both the single-profile view (ProfileDetail.tsx)
// and the compare view (ProfileCompare.tsx) — search/fetch plumbing, the
// portal-based dropdown, and the shared inline-style constants every card
// and form control in both files draws from.

export const PLATFORMS = Object.keys(PLATFORM_LABELS);

export function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
  const trimmed = input.trim();
  const idx = trimmed.lastIndexOf("#");
  if (idx <= 0 || idx === trimmed.length - 1) return null;
  return { gameName: trimmed.slice(0, idx).trim(), tagLine: trimmed.slice(idx + 1).trim() };
}

export interface FetchProfileError {
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

export async function fetchProfile(
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

// Which ProfileSearch.errors.* copy actually matches what happened —
// see FetchProfileError's own comment for why this needs `status`, not
// just the bare "riotApiError" code every failure used to share.
export function errorMessageKey(error: string, status?: number): string {
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

// The logged-in account's saved profiles, for pickers that fill a search
// slot without retyping the Riot ID (same convenience the web's
// SavedProfilePicker gives). Empty while logged out.
export function useSavedProfiles(): SavedProfileWithRank[] {
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

// Portal-based dropdown panel, shared by ComparePlatformSelect and
// CompareSavedProfilePicker below so both look and behave identically.
// Rendered into document.body instead of as a normal descendant of its
// trigger — MainView.tsx's <main> wraps every screen's content in a
// `.rc-view-enter` div that plays a mount animation (opacity+transform);
// per spec, an element with a non-"none" animation touching those
// properties creates its own stacking context for as long as the
// animation is attached, which silently caps any z-index painted inside
// it below content elsewhere in the tree. A portal escapes that trap
// entirely instead of chasing ever-higher z-index values against it.
// Position is computed from the trigger's real screen rect (recalculated
// on every open) since portaled content can no longer rely on
// `position:absolute` against an ancestor it's no longer inside.
export function DropdownMenu({
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
      // own onClick ever ran — every DropdownMenu panel carries the same
      // marker, so a click anywhere inside any of them never counts as
      // outside any of them.
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

// Shared between SkillRadarSvg (single-profile view) and CompareSkillCard
// (compare view) — both label the same 5 skill-radar axes.
export const AXIS_LABEL_KEY: Record<string, string> = {
  farm: "farm",
  vision: "vision",
  kda: "kda",
  killParticipation: "killParticipation",
  damage: "damage",
};

// fontWeight 500 (not the body default 400) and TYPE.body's 13px, not a
// smaller one-off: light-weight small text in near-white on this app's
// near-black card background reads as noticeably weaker/thinner than the
// same color/weight combination would on a light background (the eye's
// halation response to bright-on-dark text), so an unselected dropdown
// option looked washed out next to the bold, colored selected one.
export const dropdownOptionStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "6px 8px",
  borderRadius: 6,
  border: "none",
  background: "none",
  color: COLORS.text,
  fontSize: TYPE.body,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

// Same "just a chevron inside the Riot ID box" trigger as the web app's
// SavedProfilePicker.
export function CompareSavedProfilePicker({
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
            className="rc-dropdown-option"
            style={dropdownOptionStyle}
          >
            {p.gameName}#{p.tagLine} <span style={{ color: COLORS.muted }}>· {PLATFORM_LABELS[p.platform] ?? p.platform}</span>
          </button>
        ))}
      </DropdownMenu>
    </div>
  );
}

// Same color tokens as the web's "Glass & Depth" Card (src/components/ui/
// card.tsx: rounded-xl, bg-card/70, ring-foreground/10, shadow-lg
// shadow-black/20) but flat — no backdrop blur — matching this app's own
// established profile-search style rather than the web's glass look.
export const cardStyle = makeCardStyle();

export const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

// Custom dropdown matching this app's own control aesthetic, instead of a
// native <select> — a real OS-rendered dropdown always looks and behaves
// differently from the rest of this app's custom-styled controls. Was
// built once for the compare view only (2026-09-01); promoted here so
// every platform picker in the app (profile search, profile detail,
// compare) uses the same one instead of a native <select> per call site.
export function PlatformSelect({ value, onChange }: { value: string; onChange: (platform: string) => void }) {
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
          // or which platform is picked. Extra right padding specifically
          // for the chevron (selectStyle's own 12px reads as cramped once
          // an icon, not just text, sits against that edge — Julio,
          // 2026-09-01).
          width: "auto",
          minWidth: 64,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingRight: 16,
          cursor: "pointer",
        }}
      >
        {PLATFORM_LABELS[value] ?? value}
        <ChevronDown size={13} color={COLORS.muted} style={{ marginLeft: "auto", flexShrink: 0 }} />
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
            className="rc-dropdown-option"
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

export const secondaryButtonStyle: React.CSSProperties = {
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
