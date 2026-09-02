import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowsDownUp,
  Check,
  CaretDown,
  CaretRight,
  ArrowSquareOut,
  Funnel,
  Folder,
  FolderPlus,
  ArrowsLeftRight,
  PencilSimple,
  MagnifyingGlass,
  Gear as SettingsIcon,
  TrashSimple,
  User,
  type Icon,
} from "@phosphor-icons/react";
import { API_BASE_URL } from "./shared/api";
import { ProfileScreen } from "./profile/ProfileDetail";
import { ProfileCompareEntry } from "./profile/ProfileCompare";
import { parseRiotId, PlatformSelect, type ProfileTarget } from "./profile/ProfileShared";
import { COMPARE_PROFILES_ACCENT, TOOLS, type ToolId, type ToolMeta } from "./tool-meta";
import { GoldCalculator } from "./tools/GoldCalculator";
import { WaveTimer } from "./tools/WaveTimer";
import { JungleXpCalculator } from "./tools/JungleXpCalculator";
import { CooldownComparator } from "./tools/CooldownComparator";
import { DraftSimulator } from "./tools/DraftSimulator";
import { PersonalityTest } from "./tools/PersonalityTest";
import { ChampionPoolBuilder } from "./tools/ChampionPoolBuilder";
import { TierListBuilder } from "./tools/TierListBuilder";
import { MapEditor } from "./tools/MapEditor";
import { MetaTierList } from "./tools/MetaTierList";
import { COLORS, FONT_HEADING, TYPE, inputStyle, pillStyle } from "./theme";
import { WindowControls } from "./WindowControls";
import { useI18n, SUPPORTED_LOCALES, LOCALE_LABEL, type Locale } from "./i18n";
import { ChampionSplashAccent } from "./ChampionSplashAccent";
import { formatTierRank, rankToLpValue, PLATFORM_LABELS } from "./lib/rank-lp";
import { fetchLatestVersion, profileIconUrl } from "./ddragon";
import type { AccountUser, FlashSide, LcuIdentity, OverlayModules, SavedProfileFolder, SavedProfileWithRank } from "./riftcompass";

const NATIVE_VIEWS: Record<ToolId, React.ComponentType> = {
  goldCalculator: GoldCalculator,
  waveTimer: WaveTimer,
  jungleXp: JungleXpCalculator,
  cooldowns: CooldownComparator,
  draft: DraftSimulator,
  personalityTest: PersonalityTest,
  championPool: ChampionPoolBuilder,
  tierList: TierListBuilder,
  map: MapEditor,
  metaTierList: MetaTierList,
};

// The app's real shell — this project's own React UI, not riftcompass.com
// loaded into a window. A right-edge icon rail plus a content pane; the
// content pane is a small hand-rolled router (just React state — this app
// doesn't need a routing library yet) between the tools index, whichever
// tool is open, and settings.
// The window is frameless (frame: false, see electron/windows.ts), so
// this page's own 40px header strip IS the title bar — draggable via the
// WebkitAppRegion: "drag" style below, with our own min/max/close buttons
// (WindowControls.tsx). The strip also carries a small League-client
// connection indicator — the app talks directly to the LCU, so whether
// it's actually connected is real state worth surfacing, not something
// to bury in a settings page.
const TITLEBAR_HEIGHT = 40;

type Panel = "tools" | "settings" | "profile" | "compare";

// Three splash-art accents per tool detail screen — same champions and same
// top/bottom-same-side + mid-height-opposite-side zigzag riftcompass.com's
// tool pages use, so the two apps read as the same product. Sizes are
// scaled down from web's (which bleeds into a centered column's wide
// side gutters) since this panel has no such gutter — it's the full
// window width minus the icon rail, so an accent this size already reads
// as a real background presence without a wide margin to escape into.
type SplashAccent = { championId: string; opacity: number; style: React.CSSProperties };

const TOOL_SPLASH_ACCENTS: Record<ToolId, SplashAccent[]> = {
  goldCalculator: [
    { championId: "MissFortune", opacity: 28, style: { top: -40, right: -60, width: 560, height: 360, transform: "rotate(1deg)" } },
    { championId: "TwistedFate", opacity: 20, style: { bottom: -30, right: -90, width: 480, height: 320, transform: "rotate(-2deg)" } },
    { championId: "Vayne", opacity: 15, style: { top: "45%", left: -70, width: 360, height: 260, transform: "translateY(-50%) rotate(2deg)" } },
  ],
  waveTimer: [
    { championId: "Azir", opacity: 28, style: { top: -40, right: -50, width: 560, height: 360, transform: "rotate(-1deg)" } },
    { championId: "Corki", opacity: 20, style: { bottom: -40, right: -80, width: 480, height: 320, transform: "rotate(2deg)" } },
    { championId: "Twitch", opacity: 15, style: { top: "48%", left: -60, width: 340, height: 240, transform: "translateY(-50%) rotate(-2deg)" } },
  ],
  jungleXp: [
    { championId: "LeeSin", opacity: 28, style: { top: -40, left: -60, width: 560, height: 360, transform: "rotate(1deg)" } },
    { championId: "Kindred", opacity: 20, style: { bottom: -30, left: -90, width: 480, height: 320, transform: "rotate(-2deg)" } },
    { championId: "Zac", opacity: 15, style: { top: "50%", right: -70, width: 360, height: 260, transform: "translateY(-50%) rotate(2deg)" } },
  ],
  cooldowns: [
    { championId: "Zilean", opacity: 26, style: { top: -30, right: -60, width: 540, height: 340, transform: "rotate(2deg)" } },
    { championId: "Nasus", opacity: 20, style: { bottom: -30, right: -80, width: 460, height: 300, transform: "rotate(-1deg)" } },
    { championId: "Ryze", opacity: 15, style: { top: "46%", left: -60, width: 340, height: 240, transform: "translateY(-50%) rotate(1deg)" } },
  ],
  draft: [
    { championId: "Swain", opacity: 26, style: { top: -30, left: -50, width: 520, height: 340, transform: "rotate(-1deg)" } },
    { championId: "Viktor", opacity: 18, style: { bottom: -30, left: -80, width: 460, height: 300, transform: "rotate(2deg)" } },
    { championId: "Renata", opacity: 14, style: { top: "50%", right: -60, width: 340, height: 240, transform: "translateY(-50%) rotate(-2deg)" } },
  ],
  personalityTest: [
    { championId: "Teemo", opacity: 28, style: { top: -30, right: -70, width: 480, height: 320, transform: "rotate(1deg)" } },
    { championId: "Yasuo", opacity: 20, style: { bottom: -20, right: -100, width: 420, height: 280, transform: "rotate(-2deg)" } },
    { championId: "Riven", opacity: 15, style: { top: "48%", left: -70, width: 320, height: 220, transform: "translateY(-50%) rotate(2deg)" } },
  ],
  championPool: [
    { championId: "Neeko", opacity: 28, style: { top: -40, left: -60, width: 560, height: 360, transform: "rotate(1deg)" } },
    { championId: "Senna", opacity: 20, style: { bottom: -30, left: -90, width: 480, height: 320, transform: "rotate(-2deg)" } },
    { championId: "Karma", opacity: 14, style: { top: "48%", right: -60, width: 350, height: 250, transform: "translateY(-50%) rotate(-3deg)" } },
  ],
  tierList: [
    { championId: "Sett", opacity: 26, style: { top: -30, right: -60, width: 520, height: 340, transform: "rotate(-1deg)" } },
    { championId: "Draven", opacity: 20, style: { bottom: -30, right: -90, width: 460, height: 300, transform: "rotate(2deg)" } },
    { championId: "Zed", opacity: 15, style: { top: "50%", left: -60, width: 340, height: 240, transform: "translateY(-50%) rotate(1deg)" } },
  ],
  map: [
    { championId: "Shen", opacity: 24, style: { top: -30, left: -50, width: 520, height: 340, transform: "rotate(1deg)" } },
    { championId: "Bard", opacity: 18, style: { bottom: -30, left: -80, width: 460, height: 300, transform: "rotate(-2deg)" } },
    { championId: "Rakan", opacity: 14, style: { top: "52%", right: -60, width: 340, height: 240, transform: "translateY(-50%) rotate(2deg)" } },
  ],
  metaTierList: [
    { championId: "Orianna", opacity: 26, style: { top: -30, left: -60, width: 540, height: 340, transform: "rotate(1deg)" } },
    { championId: "Camille", opacity: 20, style: { bottom: -30, left: -90, width: 480, height: 320, transform: "rotate(2deg)" } },
    { championId: "Aatrox", opacity: 16, style: { top: "50%", right: -70, width: 360, height: 250, transform: "translateY(-50%) rotate(-2deg)" } },
  ],
};

export function MainView() {
  const { t } = useI18n();
  const [panel, setPanel] = useState<Panel>("tools");
  const [openToolId, setOpenToolId] = useState<ToolId | null>(null);
  const [lcuStatus, setLcuStatus] = useState<"connected" | "disconnected">("disconnected");
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const [profileFilter, setProfileFilter] = useState("");
  // The detected local player's identity, kept around (not just consumed
  // once for the auto-navigate below) so the tools-home header can show a
  // "back to your profile" chip after the user has navigated away from it.
  const [localIdentity, setLocalIdentity] = useState<LcuIdentity | null>(null);
  const openTool = TOOLS.find((tool) => tool.id === openToolId);

  function goHome() {
    setPanel("tools");
    setOpenToolId(null);
  }

  function openProfile(profileT: ProfileTarget | null) {
    setProfileTarget(profileT);
    setPanel("profile");
  }

  useEffect(() => {
    window.riftcompass.onLcuConnection(setLcuStatus);
    window.riftcompass.getSession().then(setUser);
  }, []);

  // Once the client connects and the logged-in player's identity is
  // known, jump straight to their own profile (which already shows their
  // last matches, roadmap, etc. — no separate "current account" view
  // needed). Refs instead of effect deps: onLcuIdentity has no
  // unsubscribe, so this subscribes once ([] deps) and reads the LATEST
  // panel/openTool/profileTarget through refs rather than stale
  // closures. Only fires once per connection and only from the idle
  // tools home — it should land the player on their own data on connect,
  // not yank them away from whatever they're actively doing.
  const panelRef = useRef(panel);
  const openToolIdRef = useRef(openToolId);
  const profileTargetRef = useRef(profileTarget);
  useEffect(() => {
    panelRef.current = panel;
  }, [panel]);
  useEffect(() => {
    openToolIdRef.current = openToolId;
  }, [openToolId]);
  useEffect(() => {
    profileTargetRef.current = profileTarget;
  }, [profileTarget]);

  const autoCenteredRef = useRef(false);
  useEffect(() => {
    window.riftcompass.onLcuIdentity((identity) => {
      setLocalIdentity(identity);
      if (!identity) {
        autoCenteredRef.current = false;
        return;
      }
      if (autoCenteredRef.current) return;
      if (panelRef.current === "tools" && !openToolIdRef.current && !profileTargetRef.current) {
        autoCenteredRef.current = true;
        openProfile({ platform: identity.platform, gameName: identity.gameName, tagLine: identity.tagLine });
      }
    });
  }, []);

  // Post-game summary: shows on the profile screen from the end of a
  // match until the next one starts or the window changes. Reuses the
  // exact same auto-navigate-to-own-profile call the connect-time
  // auto-center above uses, rather than a separate summary screen: it
  // already renders identically to a searched profile (same component,
  // same target shape) and its freshly-refetched match history naturally
  // puts the just-finished game at the top — no new backend endpoint or
  // data shape to trust. Edge-triggered on leaving "InProgress" (not a
  // ref/flag to reset), so it only fires once per
  // match end and re-arms itself for the next one automatically. Only
  // auto-navigates while idle at the tools home, same as the connect-time
  // guard — never yanks the user out of a tool/settings they're using.
  const localIdentityRef = useRef(localIdentity);
  useEffect(() => {
    localIdentityRef.current = localIdentity;
  }, [localIdentity]);
  const prevPhaseRef = useRef<string>("None");
  useEffect(() => {
    window.riftcompass.onPhase((phase) => {
      const wasInProgress = prevPhaseRef.current === "InProgress";
      prevPhaseRef.current = phase;
      if (!wasInProgress || phase === "InProgress") return;
      const identity = localIdentityRef.current;
      if (!identity) return;
      if (panelRef.current === "tools" && !openToolIdRef.current && !profileTargetRef.current) {
        openProfile({ platform: identity.platform, gameName: identity.gameName, tagLine: identity.tagLine });
      }
    });
  }, []);

  // Mouse back/forward side buttons close the open tool — button 3/4 are
  // the XButton1/XButton2 side buttons most mice map to back/forward.
  // There's no real forward destination here (a couple of flat panels,
  // not a history stack), so both side buttons do the same "back to the
  // tools menu" action rather than only one of them working.
  useEffect(() => {
    function handleMouseUp(e: MouseEvent) {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        goHome();
      }
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: COLORS.background,
        color: COLORS.text,
      }}
    >
      <div
        style={{
          height: TITLEBAR_HEIGHT,
          flexShrink: 0,
          background: COLORS.card,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 16,
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      >
        {/* pointerEvents none so clicks fall through to the drag region —
            the indicator is display-only, same as under Electron. */}
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLORS.muted, pointerEvents: "none" }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: lcuStatus === "connected" ? "#2f9d68" : COLORS.muted,
            }}
          />
          {lcuStatus === "connected" ? t("Common.leagueConnected") : t("Common.leagueNotDetected")}
        </span>
        <WindowControls />
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <main style={{ position: "relative", zIndex: 0, flex: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden", padding: "20px clamp(16px, 3vw, 48px)" }}>
          {/* No synthetic ambient glow here, on purpose (a blurred blob
              or ray motif reads as the generic AI-hero background no
              matter its color). Real per-tool splash art
              (TOOL_SPLASH_ACCENTS) and profile screens' real top-mastery
              champion carry the depth job instead. */}
          {/* key changes on every real view switch (not on data reloading
              within the same view), so React remounts this div and its
              rc-view-enter animation replays — see global.css for why. */}
          <div key={panel === "tools" ? (openTool ? `tool-${openTool.id}` : "tools") : panel} className="rc-view-enter">
          {panel === "settings" ? (
            <Settings user={user} onUserChange={setUser} onExit={goHome} />
          ) : panel === "profile" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Same back-to-menu control every tool screen has; also
                  clears the profile target so the connect auto-center
                  guard doesn't stay blocked by a stale one. */}
              <button
                onClick={() => {
                  setProfileTarget(null);
                  goHome();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  alignSelf: "flex-start",
                  background: "none",
                  border: "none",
                  color: COLORS.muted,
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <ArrowLeft size={15} /> {t("Common.backToTools")}
              </button>
              <ProfileScreen
                key={profileTarget ? `${profileTarget.platform}-${profileTarget.gameName}-${profileTarget.tagLine}` : "search"}
                initialTarget={profileTarget}
                canSave={Boolean(user)}
              />
            </div>
          ) : panel === "compare" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Same back-to-menu control every other screen has (profile,
                  every tool). */}
              <button
                onClick={goHome}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  alignSelf: "flex-start",
                  background: "none",
                  border: "none",
                  color: COLORS.muted,
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <ArrowLeft size={15} /> {t("Common.backToTools")}
              </button>
              <ProfileCompareEntry />
            </div>
          ) : openTool ? (
            // No outer cap: a fixed maxWidth here just leaves dead margins
            // on a wide window without actually rearranging anything
            // inside it. Each tool's own layout (Gold Calculator's 3-col
            // grid, Draft
            // Simulator's two team boards, Tier List's chip rows, Meta Tier
            // List's role cards...) now decides how it fills the real
            // width; a tool that genuinely wants to stay narrow (the
            // personality quiz card, the reference tables) still caps
            // itself internally.
            // minHeight (not just a shrink-wrapped column): a short tool
            // (Cooldown Comparator, Personality Test) has little enough
            // content that this wrapper used to end right after it, so the
            // bottom/mid-anchored splash accents below all landed clustered
            // near the top and left the rest of the panel bare. A plain
            // "100%" wouldn't reliably resolve up an auto-height ancestor
            // chain, so a floor in px is the direct fix — tools already
            // taller than this aren't affected.
            <div style={{ position: "relative", zIndex: 0, display: "flex", flexDirection: "column", gap: 20, minHeight: 640 }}>
              {TOOL_SPLASH_ACCENTS[openTool.id].map((accent) => (
                <ChampionSplashAccent
                  key={accent.championId}
                  championId={accent.championId}
                  opacity={accent.opacity}
                  style={accent.style}
                />
              ))}
              <button
                onClick={() => setOpenToolId(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  alignSelf: "flex-start",
                  background: "none",
                  border: "none",
                  color: COLORS.muted,
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <ArrowLeft size={15} /> {t("Common.backToTools")}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <openTool.icon size={22} color={openTool.accent} />
                <h1 style={{ fontFamily: FONT_HEADING, fontSize: TYPE.heading, fontWeight: 400, margin: 0 }}>
                  {t(`ToolsIndex.${openTool.id}.title`)}
                </h1>
              </div>
              <p style={{ color: COLORS.muted, fontSize: 14, margin: 0, maxWidth: 560 }}>
                {t(`ToolsIndex.${openTool.id}.description`)}
              </p>
              {(() => {
                const NativeView = NATIVE_VIEWS[openTool.id];
                return <NativeView />;
              })()}
            </div>
          ) : (
            <ToolsIndex
              onOpen={setOpenToolId}
              onGoHome={goHome}
              onSearchProfile={openProfile}
              onOpenCompare={() => setPanel("compare")}
              localIdentity={localIdentity}
              onOpenMyProfile={() =>
                localIdentity &&
                openProfile({ platform: localIdentity.platform, gameName: localIdentity.gameName, tagLine: localIdentity.tagLine })
              }
            />
          )}
          </div>
        </main>

        {/* Right sidebar: profile at top, saved profiles (not the tool
            list) filling the middle, settings pinned at the bottom.
            Getting back to the tools grid from an open tool/Settings is
            the "Herramientas" row plus the mouse back button (see the
            window-level mouseup handler above), not a per-tool list here. */}
        <nav
          style={{
            width: 260,
            flexShrink: 0,
            background: COLORS.card,
            borderLeft: `1px solid ${COLORS.cardBorder}`,
            display: "flex",
            flexDirection: "column",
            padding: "14px 10px",
            gap: 4,
          }}
        >
          {user ? (
            <button onClick={() => setPanel("settings")} style={navProfileRowStyle}>
              <Avatar user={user} size={30} />
              <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user.username ?? user.email}
              </span>
            </button>
          ) : user === null ? (
            <button onClick={() => setPanel("settings")} style={navProfileRowStyle}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: `${COLORS.rose}26`,
                  color: COLORS.rose,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <User size={14} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{t("Auth.loginButton")}</span>
            </button>
          ) : null}

          <div style={{ height: 1, background: COLORS.cardBorder, margin: "6px 8px" }} />

          {/* This used to be a nav button that navigated away to the
              profile-search screen; that job moved to its own "Buscar
              perfiles" card in the Herramientas grid (see ToolsIndex), so
              this is now a real filter input over the saved-profiles list
              below it, nothing else. */}
          {user ? (
            <div style={{ position: "relative", margin: "0 2px" }}>
              <MagnifyingGlass size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: COLORS.muted, pointerEvents: "none" }} />
              <input
                value={profileFilter}
                onChange={(e) => setProfileFilter(e.target.value)}
                placeholder={t("SavedProfiles.filterPlaceholder")}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: COLORS.background,
                  color: COLORS.text,
                  border: `1px solid ${COLORS.cardBorder}`,
                  borderRadius: 8,
                  padding: "7px 10px 7px 28px",
                  fontSize: 12,
                }}
              />
            </div>
          ) : null}

          <div style={{ height: 1, background: COLORS.cardBorder, margin: "6px 8px" }} />

          {user ? (
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginTop: 2, padding: "0 2px" }}>
              <SavedProfilesPanel onOpenProfile={openProfile} textFilter={profileFilter} />
            </div>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          <div style={{ height: 1, background: COLORS.cardBorder, margin: "6px 8px" }} />

          <button onClick={() => setPanel("settings")} title={t("Common.settings")} style={navRowStyle(panel === "settings")}>
            <SettingsIcon size={16} />
            <span>{t("Common.settings")}</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

function navRowStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "none",
    background: active ? `${COLORS.rose}26` : "transparent",
    color: active ? COLORS.rose : COLORS.muted,
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

const navProfileRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: COLORS.text,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};

// A small circular avatar — the account's own real avatarUrl when set,
// otherwise a plain initial-letter placeholder (never a generic person
// icon; matches this project's own "no fabricated/placeholder-as-if-real"
// instinct even for a UI-only fallback).
function Avatar({ user, size = 34 }: { user: AccountUser; size?: number }) {
  const initial = (user.username ?? user.email).charAt(0).toUpperCase();
  return user.avatarUrl ? (
    <img
      src={user.avatarUrl}
      alt=""
      style={{ width: size, height: size, borderRadius: 999, objectFit: "cover", flexShrink: 0 }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        flexShrink: 0,
        background: `${COLORS.rose}26`,
        color: COLORS.rose,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_HEADING,
        fontSize: size * 0.42,
      }}
    >
      {initial}
    </div>
  );
}

// Brand presence on the home screen — same mark as the web app's HomeMark
// (src/components/home-mark.tsx): a rose "RC" badge with a soft glow plus
// the wordmark, sized close to the web version's own 36px badge.
// Clickable like the web's — it's the way back to the tools home (the
// sidebar has no "Herramientas" row).
function BrandMark({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: 11,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.rose,
          color: "#fff",
          fontFamily: FONT_HEADING,
          fontSize: 17,
          boxShadow: `0 0 20px -4px ${COLORS.rose}`,
        }}
      >
        RC
      </div>
      <span style={{ fontFamily: FONT_HEADING, fontSize: 21, fontWeight: 400, letterSpacing: -0.2, color: COLORS.text }}>
        RiftCompass
      </span>
    </button>
  );
}

function lpValueOf(profile: SavedProfileWithRank): number {
  return profile.rank ? rankToLpValue(profile.rank.tier, profile.rank.rank, profile.rank.leaguePoints) : -Infinity;
}

function winrateOf(profile: SavedProfileWithRank): number {
  if (!profile.rank || profile.rank.wins + profile.rank.losses === 0) return -Infinity;
  return profile.rank.wins / (profile.rank.wins + profile.rank.losses);
}

type SortMode = "elo" | "winrate";

// Saved-profiles model: every profile is in exactly one folder, never
// zero — there's no separate "ungrouped" state, and the default folder is
// renameable but never deletable.
//
// Folders are backend-synced (riftcompass.com's saved_profile_folders),
// the same real data as the web's own ProfilePanel — a folder created/
// renamed/assigned on either side shows up on the other. The default
// folder is identified by its real `isDefault` flag from the server, not
// a hardcoded id (its actual id is a per-account UUID). This component
// owns the whole feature: fetching folders+profiles, the filter/sort icon
// buttons next to the section title, and the grouped/flat list itself.
function SavedProfilesPanel({ onOpenProfile, textFilter }: { onOpenProfile: (target: ProfileTarget) => void; textFilter: string }) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SavedProfileWithRank[] | null>(null);
  const [folders, setFolders] = useState<SavedProfileFolder[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("elo");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      window.riftcompass.getSavedProfiles().then((data) => {
        if (cancelled) return;
        setProfiles(data.profiles);
        setFolders(data.folders);
      });
    };
    load();
    // The profile screen's save button dispatches this after a toggle —
    // same event name the web's SaveProfileButton uses for its panel.
    window.addEventListener("riftcompass:profile-panel-refresh", load);
    return () => {
      cancelled = true;
      window.removeEventListener("riftcompass:profile-panel-refresh", load);
    };
  }, []);

  async function handleCreateGroup(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const r = await window.riftcompass.createProfileFolder(trimmed);
    if (r.ok) setFolders(r.folders);
  }
  async function handleRenameGroup(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const r = await window.riftcompass.renameProfileFolder(id, trimmed);
    if (r.ok) setFolders(r.folders);
  }
  async function handleDeleteGroup(id: string) {
    const r = await window.riftcompass.deleteProfileFolder(id);
    if (r.ok) {
      setFolders(r.folders);
      setProfiles(r.profiles);
      setGroupFilter((cur) => (cur === id ? "all" : cur));
    }
  }
  function handleAssign(profileId: string, folderId: string) {
    // Optimistic — same responsiveness as the old local-storage version had,
    // reconciled with the server's own copy once the request lands.
    setProfiles((prev) => prev?.map((p) => (p.id === profileId ? { ...p, folderId } : p)) ?? prev);
    void window.riftcompass.setSavedProfileFolder(profileId, folderId).then((r) => {
      if (r.ok) {
        setFolders(r.folders);
        setProfiles(r.profiles);
      }
    });
  }

  const sortKey = sortMode === "elo" ? lpValueOf : winrateOf;
  const sorted = useMemo(() => (profiles ? [...profiles].sort((a, b) => sortKey(b) - sortKey(a)) : []), [profiles, sortKey]);
  const rankedCount = sorted.filter((p) => sortKey(p) > -Infinity).length;
  // Positions (#1, #2…) reflect standing across ALL saved profiles by the
  // active sort criterion, computed once against the unfiltered list —
  // recalculating them against a filtered/grouped subset would silently
  // relabel a real #3 as "#1" the moment a folder or search hides #1/#2.
  const positions = useMemo(() => {
    const map = new Map<string, number>();
    if (rankedCount >= 2) sorted.forEach((p, i) => sortKey(p) > -Infinity && map.set(p.id, i + 1));
    return map;
  }, [sorted, rankedCount, sortKey]);

  const query = textFilter.trim().toLowerCase();
  const textFiltered = query ? sorted.filter((p) => `${p.gameName}#${p.tagLine}`.toLowerCase().includes(query)) : sorted;

  if (profiles === null) return null;

  const header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: COLORS.muted }}>
        {t("SavedProfiles.title")}
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        <IconPopoverButton icon={Funnel} label={t("SavedProfiles.filterLabel")} active={groupFilter !== "all"}>
          {(close) => (
            <>
              <PopoverOption
                active={groupFilter === "all"}
                onClick={() => {
                  setGroupFilter("all");
                  close();
                }}
              >
                {t("SavedProfiles.filterAll")}
              </PopoverOption>
              {folders.map((g) => (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <PopoverOption
                    style={{ flex: 1, minWidth: 0 }}
                    active={groupFilter === g.id}
                    onClick={() => {
                      setGroupFilter(g.id);
                      close();
                    }}
                  >
                    {g.name}
                  </PopoverOption>
                  <FolderEditControls group={g} onRename={handleRenameGroup} onDelete={handleDeleteGroup} />
                </div>
              ))}
              <div style={{ height: 1, background: COLORS.cardBorder, margin: "4px 0" }} />
              <NewFolderControl onCreate={handleCreateGroup} />
            </>
          )}
        </IconPopoverButton>
        <IconPopoverButton icon={ArrowsDownUp} label={t("SavedProfiles.sortLabel")}>
          {(close) => (
            <>
              <PopoverOption
                active={sortMode === "elo"}
                onClick={() => {
                  setSortMode("elo");
                  close();
                }}
              >
                {t("SavedProfiles.sortElo")}
              </PopoverOption>
              <PopoverOption
                active={sortMode === "winrate"}
                onClick={() => {
                  setSortMode("winrate");
                  close();
                }}
              >
                {t("SavedProfiles.sortWinrate")}
              </PopoverOption>
            </>
          )}
        </IconPopoverButton>
      </div>
    </div>
  );

  if (sorted.length === 0) {
    return (
      <>
        {header}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "24px 20px" }}>
          <MagnifyingGlass size={28} color={COLORS.muted} style={{ opacity: 0.7 }} />
          <p style={{ fontSize: TYPE.body, fontWeight: 600, color: COLORS.text, margin: 0 }}>{t("SavedProfiles.noSavedProfiles")}</p>
          <p style={{ fontSize: TYPE.label, color: COLORS.muted, margin: 0, lineHeight: 1.5 }}>{t("SavedProfiles.noSavedProfilesHint")}</p>
        </div>
      </>
    );
  }

  function rowFor(p: SavedProfileWithRank) {
    return (
      <SavedProfileRow
        key={p.id}
        profile={p}
        position={positions.get(p.id) ?? null}
        onOpenProfile={onOpenProfile}
        groups={folders}
        currentGroupId={p.folderId}
        onAssign={handleAssign}
      />
    );
  }

  // Flat view: one specific folder is selected — no point showing every
  // other folder's (empty, from this view's perspective) section header.
  if (groupFilter !== "all") {
    const visible = textFiltered.filter((p) => p.folderId === groupFilter);
    return (
      <>
        {header}
        {visible.length === 0 ? (
          <p style={{ fontSize: 13, color: COLORS.muted, margin: 0 }}>{t("SavedProfiles.noFilterMatches")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{visible.map(rowFor)}</div>
        )}
      </>
    );
  }

  // Grouped view (default): one collapsible section per folder, in
  // creation order (General first — it's always seeded first on the main
  // side). Drag a row onto a section to move it there, same as the League
  // client's own friends list.
  return (
    <>
      {header}
      {textFiltered.length === 0 ? (
        <p style={{ fontSize: 13, color: COLORS.muted, margin: 0 }}>{t("SavedProfiles.noFilterMatches")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {folders.map((g) => {
            const members = textFiltered.filter((p) => p.folderId === g.id);
            return (
              <FolderSection
                key={g.id}
                name={g.name}
                count={members.length}
                collapsed={collapsedFolders.has(g.id)}
                onToggle={() =>
                  setCollapsedFolders((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.id)) next.delete(g.id);
                    else next.add(g.id);
                    return next;
                  })
                }
                onDropProfile={(profileId) => handleAssign(profileId, g.id)}
              >
                {members.length > 0 ? (
                  members.map(rowFor)
                ) : (
                  <p style={{ fontSize: 12, color: COLORS.muted, margin: 0 }}>{t("SavedProfiles.emptyFolder")}</p>
                )}
              </FolderSection>
            );
          })}
        </div>
      )}
    </>
  );
}

function FolderSection({
  name,
  count,
  collapsed,
  onToggle,
  onDropProfile,
  children,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onDropProfile: (profileId: string) => void;
  children: React.ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const profileId = e.dataTransfer.getData("text/plain");
        if (profileId) onDropProfile(profileId);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        borderRadius: 8,
        padding: 4,
        margin: -4,
        border: `1px dashed ${dragOver ? COLORS.rose : "transparent"}`,
        background: dragOver ? `${COLORS.rose}14` : "none",
      }}
    >
      <button
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, cursor: "pointer", color: COLORS.text, fontFamily: "inherit" }}
      >
        {collapsed ? <CaretRight size={12} color={COLORS.muted} /> : <CaretDown size={12} color={COLORS.muted} />}
        <Folder size={12} color={COLORS.muted} />
        <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <span style={{ fontSize: 11, color: COLORS.muted, flexShrink: 0 }}>({count})</span>
      </button>
      {!collapsed ? <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 4 }}>{children}</div> : null}
    </div>
  );
}

function NewFolderControl({ onCreate }: { onCreate: (name: string) => void }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderRadius: 6,
          border: "none",
          background: "none",
          color: COLORS.rose,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <FolderPlus size={13} /> {t("SavedProfiles.newFolder")}
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) {
          onCreate(name);
          setName("");
          setAdding(false);
        }
      }}
      style={{ display: "flex", gap: 4, padding: "2px 4px" }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name.trim() && setAdding(false)}
        placeholder={t("SavedProfiles.folderNamePlaceholder")}
        style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "5px 7px", borderRadius: 5, border: `1px solid ${COLORS.cardBorder}`, background: COLORS.background, color: COLORS.text }}
      />
    </form>
  );
}

function FolderEditControls({
  group,
  onRename,
  onDelete,
}: {
  group: SavedProfileFolder;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  // Default folder: rename yes, delete no — it's the fallback every
  // profile lands in, so there always has to be one. Same server-enforced
  // rule as the web's own FolderEditControls.
  const isGeneral = group.isDefault;

  if (renaming) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onRename(group.id, name);
          setRenaming(false);
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setRenaming(false)}
          style={{ width: 90, fontSize: 11, padding: "3px 5px", borderRadius: 5, border: `1px solid ${COLORS.cardBorder}`, background: COLORS.background, color: COLORS.text }}
        />
      </form>
    );
  }
  return (
    <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
      <button
        onClick={() => {
          setName(group.name);
          setRenaming(true);
        }}
        title={t("SavedProfiles.renameFolderHint")}
        style={iconMiniButtonStyle}
      >
        <PencilSimple size={11} />
      </button>
      {isGeneral ? null : (
        <button onClick={() => onDelete(group.id)} title={t("SavedProfiles.deleteFolderHint")} style={iconMiniButtonStyle}>
          <TrashSimple size={11} />
        </button>
      )}
    </span>
  );
}

const iconMiniButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  borderRadius: 4,
  border: "none",
  background: "none",
  color: COLORS.muted,
  cursor: "pointer",
  flexShrink: 0,
};

// Small reusable "icon button that opens a floating menu" — backs the
// filter/sort buttons next to "Perfiles guardados" and each row's own
// folder-assign button. Closes on click-outside; content is a render-prop
// so each caller supplies its own option list and controls when it closes.
function IconPopoverButton({
  icon: Icon,
  label,
  active,
  children,
}: {
  icon: Icon;
  label: string;
  active?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: 7,
          border: `1px solid ${active ? COLORS.rose : "transparent"}`,
          background: active ? `${COLORS.rose}1f` : "none",
          color: active ? COLORS.rose : COLORS.muted,
          cursor: "pointer",
        }}
      >
        <Icon size={17} />
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 180,
            maxWidth: 220,
            background: COLORS.card,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 8,
            padding: 6,
            zIndex: 30,
            boxShadow: "0 12px 24px -8px rgba(0,0,0,0.6)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function PopoverOption({
  active,
  onClick,
  children,
  style,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        textAlign: "left",
        padding: "6px 8px",
        borderRadius: 6,
        border: "none",
        background: active ? `${COLORS.rose}1f` : "none",
        color: active ? COLORS.rose : COLORS.text,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        ...style,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
      {active ? <Check size={12} style={{ flexShrink: 0 }} /> : null}
    </button>
  );
}

// Compact profile row: this used to stack a name line, a win/loss bar
// AND a ~30px sparkline (~110px tall per profile); collapsed to two
// lines — identity+result on top, rank + winrate on the bottom.
//
// Draggable into folders — FolderSection above is the drop target; the
// click-based folder-assign button stays too, as a precise/discoverable
// alternative to dragging rather than a replacement for it.
function SavedProfileRow({
  profile,
  position,
  onOpenProfile,
  groups,
  currentGroupId,
  onAssign,
}: {
  profile: SavedProfileWithRank;
  position: number | null;
  onOpenProfile: (target: ProfileTarget) => void;
  groups: SavedProfileFolder[];
  currentGroupId: string;
  onAssign: (profileId: string, groupId: string) => void;
}) {
  const { t } = useI18n();
  const rank = profile.rank;
  const winrate = rank && rank.wins + rank.losses > 0 ? Math.round((rank.wins / (rank.wins + rank.losses)) * 100) : null;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", profile.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 8,
        border: `1px solid ${COLORS.cardBorder}`,
        background: `${COLORS.card}66`,
        padding: "7px 10px",
        cursor: "grab",
      }}
    >
      <button
        onClick={() => onOpenProfile({ platform: profile.platform, gameName: profile.gameName, tagLine: profile.tagLine })}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          cursor: "pointer",
          background: "none",
          border: "none",
          padding: 0,
          color: COLORS.text,
          fontFamily: "inherit",
        }}
      >
        <span style={{ flexShrink: 0, width: 18, fontSize: 11, fontWeight: 700, color: COLORS.muted }}>{position ? `#${position}` : ""}</span>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {profile.gameName}
            <span style={{ color: COLORS.muted }}>#{profile.tagLine}</span>
          </span>
          {/* LP trend as a 30x12 inline sparkline sitting after the
              winrate text on this same line — small enough not to fight
              the compact row height. */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: COLORS.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              {PLATFORM_LABELS[profile.platform] ?? profile.platform.toUpperCase()}
              {rank ? ` · ${formatTierRank(rank.tier, rank.rank)}` : ` · ${t("SavedProfiles.noRankYet")}`}
              {winrate !== null ? ` · ${t("SavedProfiles.winrateShort", { rate: winrate })}` : ""}
            </span>
            {rank && rank.lpTrend.length >= 2 ? <InlineLpSparkline values={rank.lpTrend} /> : null}
          </div>
        </div>
      </button>
      {rank?.recentResult ? (
        // The single-letter win/loss badge (kept for a compact row)
        // carries a real tooltip explaining what it means instead of
        // relying on the letter alone.
        <span
          title={t("SavedProfiles.recentResultHint")}
          style={{
            flexShrink: 0,
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 10,
            fontWeight: 700,
            background: rank.recentResult === "win" ? `${COLORS.goodMild}26` : `${COLORS.badMild}26`,
            color: rank.recentResult === "win" ? COLORS.goodMild : COLORS.badMild,
          }}
        >
          {rank.recentResult === "win" ? t("SavedProfiles.recentWin") : t("SavedProfiles.recentLoss")}
        </span>
      ) : null}
      {groups.length > 1 ? (
        <IconPopoverButton
          icon={Folder}
          label={t("SavedProfiles.assignToFolder")}
          active={!groups.find((g) => g.id === currentGroupId)?.isDefault}
        >
          {(close) => (
            <>
              {groups.map((g) => (
                <PopoverOption
                  key={g.id}
                  active={currentGroupId === g.id}
                  onClick={() => {
                    onAssign(profile.id, g.id);
                    close();
                  }}
                >
                  {g.name}
                </PopoverOption>
              ))}
            </>
          )}
        </IconPopoverButton>
      ) : null}
    </div>
  );
}

// Small hand-rolled sparkline (a charting library would be overkill at
// 30x12px) — same gradient-area-under-a-polyline shape as the web's
// ProfilePanel LpSparkline, just shrunk down to sit inline next to the
// winrate text instead of on its own row.
function InlineLpSparkline({ values }: { values: number[] }) {
  const gradientId = useId();
  const width = 30;
  const height = 12;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const trendingUp = values[values.length - 1] >= values[0];
  const color = trendingUp ? COLORS.goodMild : COLORS.badMild;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width, height, flexShrink: 0 }} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.4} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Profile search/compare aren't real ToolIds (they route through
// MainView's own `panel` state, not the openTool/NATIVE_VIEWS switch), so
// compare is spliced into the grid as its own entry kind rather than
// forced into the ToolMeta/TOOLS shape.
type GridEntry = { kind: "tool"; tool: ToolMeta } | { kind: "compareProfiles" };

// Tool order must match the web's grid (TOOL_ROUTES), which ends with
// "duo" — its equivalent of this card — so "Comparar perfiles" goes last.
function buildGridEntries(): GridEntry[] {
  return [...TOOLS.map((tool): GridEntry => ({ kind: "tool", tool })), { kind: "compareProfiles" }];
}

function ToolsIndex({
  onOpen,
  onGoHome,
  onSearchProfile,
  onOpenCompare,
  localIdentity,
  onOpenMyProfile,
}: {
  onOpen: (id: ToolId) => void;
  onGoHome: () => void;
  onSearchProfile: (target: ProfileTarget) => void;
  onOpenCompare: () => void;
  localIdentity: LcuIdentity | null;
  onOpenMyProfile: () => void;
}) {
  const { t } = useI18n();
  const entries = useMemo(buildGridEntries, []);
  return (
    // The tools grid grows into the full window width: this used to cap
    // at maxWidth:1320, so a maximized/ultrawide window just left the
    // extra space empty instead of growing into it. No cap now; the grid
    // below (auto-fill + clamp()-scaled column/card sizing) grows with
    // whatever width main actually has.
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <BrandMark onClick={onGoHome} />
      {/* Profile search is not a tile inside the grid but a real,
          prominent Riot ID search sitting in the same row as the title,
          on its opposite (right) end. */}
      <div
        style={{ position: "relative", zIndex: 0, paddingBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}
      >
        <ChampionSplashAccent championId="Ahri" style={{ top: -40, right: -20, width: 480, height: 320 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1 style={{ fontFamily: FONT_HEADING, fontSize: TYPE.heading, fontWeight: 400, margin: 0 }}>{t("ToolsIndex.title")}</h1>
          {localIdentity ? <DetectedPlayerChip identity={localIdentity} onClick={onOpenMyProfile} /> : null}
        </div>
        <HeaderProfileSearch onSearch={onSearchProfile} />
      </div>
      <div
        style={{
          position: "relative",
          zIndex: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(clamp(130px, 10vw, 180px), 1fr))",
          gap: "clamp(12px, 1vw, 20px)",
        }}
      >
        {entries.map((entry) => {
          if (entry.kind === "compareProfiles") {
            return <GridCard key="compareProfiles" icon={ArrowsLeftRight} accent={COMPARE_PROFILES_ACCENT} label={t("ToolsIndex.compareProfiles")} onClick={onOpenCompare} />;
          }
          const tool = entry.tool;
          return (
            <GridCard
              key={tool.id}
              icon={tool.icon}
              accent={tool.accent}
              label={t(`ToolsIndex.${tool.id}.title`)}
              onClick={() => onOpen(tool.id)}
              disabled={!tool.native}
            />
          );
        })}
      </div>
    </div>
  );
}

function HeaderProfileSearch({ onSearch }: { onSearch: (target: ProfileTarget) => void }) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState("euw1");
  const [riotId, setRiotId] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseRiotId(riotId);
    if (!parsed) {
      setError(true);
      return;
    }
    setError(false);
    onSearch({ platform, gameName: parsed.gameName, tagLine: parsed.tagLine });
  }

  return (
    <form onSubmit={handleSubmit} style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: COLORS.muted }}>
        {t("ToolsIndex.profileSearch")}
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <PlatformSelect value={platform} onChange={setPlatform} />
        <div style={{ position: "relative" }}>
          <MagnifyingGlass size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: COLORS.muted, pointerEvents: "none" }} />
          <input
            value={riotId}
            onChange={(e) => {
              setRiotId(e.target.value);
              setError(false);
            }}
            placeholder={t("ProfileSearch.riotIdPlaceholder")}
            style={{ ...headerSearchFieldStyle(error), width: 190, padding: "8px 10px 8px 28px" }}
          />
        </div>
      </div>
    </form>
  );
}

function headerSearchFieldStyle(error: boolean): React.CSSProperties {
  return {
    boxSizing: "border-box",
    background: COLORS.card,
    color: COLORS.text,
    border: `1px solid ${error ? COLORS.destructive : COLORS.cardBorder}`,
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13,
  };
}

// The detected local player, next to the "Herramientas" title. Clicking it
// re-opens that same auto-detected profile (openProfile in MainView), so
// navigating away from it (e.g. to browse a tool) doesn't lose the way
// back.
function DetectedPlayerChip({ identity, onClick }: { identity: LcuIdentity; onClick: () => void }) {
  const [ddragonVersion, setDdragonVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLatestVersion().then((v) => {
      if (!cancelled) setDdragonVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 999,
        padding: "4px 12px 4px 4px",
        background: `${COLORS.card}99`,
        color: COLORS.text,
        cursor: "pointer",
      }}
    >
      {ddragonVersion ? (
        <img
          src={profileIconUrl(ddragonVersion, identity.profileIconId)}
          alt=""
          style={{ width: 26, height: 26, borderRadius: 999 }}
        />
      ) : (
        <div style={{ width: 26, height: 26, borderRadius: 999, background: COLORS.cardBorder }} />
      )}
      <span style={{ fontSize: 13 }}>
        {identity.gameName}
        <span style={{ color: COLORS.muted }}>#{identity.tagLine}</span>
      </span>
    </button>
  );
}

// Grid tile: big centered icon with its name underneath, no description.
// Shared by real tools and the compare pseudo-entry above so every tile
// in the grid looks and behaves the same.
function GridCard({
  icon: Icon,
  accent,
  label,
  onClick,
  disabled,
}: {
  icon: Icon;
  accent: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      className="rc-tool-card"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "clamp(8px, 0.8vw, 12px)",
        borderRadius: 12,
        border: `1px solid ${COLORS.cardBorder}`,
        background: `${COLORS.card}99`,
        padding: "clamp(16px, 1.4vw, 24px) 10px",
        minHeight: "clamp(96px, 7.5vw, 132px)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        color: COLORS.text,
        fontFamily: "inherit",
        textAlign: "center",
      }}
    >
      {/* Matches the web's own ToolCard (src/components/tool-card.tsx in
          the web repo): the icon renders bare at its accent color, no
          colored square behind it. */}
      <Icon
        size={40}
        color={accent}
        className="rc-tool-card-icon"
        style={{ width: "clamp(30px, 2.6vw, 40px)", height: "clamp(30px, 2.6vw, 40px)", flexShrink: 0 }}
      />
      <span style={{ fontSize: "clamp(12px, 0.95vw, 14px)", fontWeight: 600, lineHeight: 1.3 }}>{label}</span>
      {/* Still honest about a placeholder tool rather than a broken/fake
          link if `native:false` ever comes back — just a caption instead
          of the old description paragraph, since the card itself is
          compact now. */}
      {disabled ? <span style={{ fontSize: 10, color: COLORS.muted }}>{t("Common.notBuiltYet")}</span> : null}
    </button>
  );
}

function Settings({
  user,
  onUserChange,
  onExit,
}: {
  user: AccountUser | null | undefined;
  onUserChange: (user: AccountUser | null) => void;
  onExit: () => void;
}) {
  const { t, locale, setLocale } = useI18n();
  const [autoLaunch, setAutoLaunchState] = useState<boolean | null>(null);
  const [overlayModules, setOverlayModulesState] = useState<OverlayModules | null>(null);
  const [flashSide, setFlashSideState] = useState<FlashSide | null>(null);
  const [abilityCalibrated, setAbilityCalibrated] = useState(false);

  useEffect(() => {
    window.riftcompass.getSettings().then((s) => {
      setAutoLaunchState(s.autoLaunch);
      setOverlayModulesState(s.overlayModules);
      setFlashSideState(s.flashSide);
      setAbilityCalibrated(s.abilityBarCalibration !== null);
    });
  }, []);

  async function toggleAutoLaunch() {
    if (autoLaunch === null) return;
    const next = !autoLaunch;
    setAutoLaunchState(next);
    const settings = await window.riftcompass.setAutoLaunch(next);
    setAutoLaunchState(settings.autoLaunch);
  }

  async function toggleOverlayModule(key: keyof OverlayModules) {
    if (!overlayModules) return;
    const next = { ...overlayModules, [key]: !overlayModules[key] };
    setOverlayModulesState(next);
    const settings = await window.riftcompass.setOverlayModules(next);
    setOverlayModulesState(settings.overlayModules);
  }

  async function handleSetFlashSide(side: FlashSide) {
    setFlashSideState(side);
    const settings = await window.riftcompass.setFlashSide(side);
    setFlashSideState(settings.flashSide);
  }

  async function handleLogout() {
    await window.riftcompass.logout();
    onUserChange(null);
  }

  // Opens League's real HUD is what the overlay window shows once it's
  // force-shown here — the user clicks their real Q/W/E icons there (see
  // OverlayView.tsx's handleCalibrationClick), not in this settings window.
  async function handleCalibrateAbilityBar() {
    await window.riftcompass.enterCalibration();
  }

  return (
    <div style={{ position: "relative", zIndex: 0, display: "flex", flexDirection: "column", gap: 24, maxWidth: 620, margin: "0 auto" }}>
      <ChampionSplashAccent championId="Lux" opacity={22} style={{ top: -60, left: -260, width: 420, height: 420 }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontFamily: FONT_HEADING, fontSize: TYPE.heading, fontWeight: 400, margin: 0 }}>{t("Settings.title")}</h1>
        {/* Explicit exit control inside the Settings screen itself —
            otherwise the only way out is the nav rail. */}
        <button
          onClick={onExit}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: COLORS.muted, fontSize: 13, cursor: "pointer", padding: 0 }}
        >
          <ArrowLeft size={15} /> {t("Settings.exit")}
        </button>
      </div>

      {/* Profile settings mirror the web's /account page: same username
          field, real PATCH against riftcompass.com's /api/v1/username.
          Avatar upload isn't reimplemented here (multipart upload + image
          resizing is a whole separate pipeline the web already has via
          Vercel Blob) — "manage on riftcompass.com" opens that real flow
          in the default browser instead of faking one. */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>{t("Settings.accountSection")}</h2>
        {user === undefined ? null : user ? (
          <ProfileSection user={user} onUserChange={onUserChange} onLogout={handleLogout} />
        ) : (
          <LoginForm onLoggedIn={onUserChange} />
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>{t("Settings.overlaySection")}</h2>
        <p style={{ fontSize: 12, color: COLORS.muted, margin: 0 }}>{t("Settings.overlayHotkeyHint")}</p>
        <OverlayToggle
          label={t("Settings.overlayCsPerMinute")}
          hint={t("Settings.overlayCsPerMinuteHint")}
          checked={overlayModules?.csPerMinute ?? false}
          disabled={!overlayModules}
          onChange={() => toggleOverlayModule("csPerMinute")}
        />
        <OverlayToggle
          label={t("Settings.overlayGoldDiff")}
          hint={t("Settings.overlayGoldDiffHint")}
          checked={overlayModules?.goldDiff ?? false}
          disabled={!overlayModules}
          onChange={() => toggleOverlayModule("goldDiff")}
        />
        <OverlayToggle
          label={t("Settings.overlaySkillOrder")}
          hint={t("Settings.overlaySkillOrderHint")}
          checked={overlayModules?.skillOrder ?? false}
          disabled={!overlayModules}
          onChange={() => toggleOverlayModule("skillOrder")}
        />
        <OverlayToggle
          label={t("Settings.overlayAutoBuild")}
          hint={t("Settings.overlayAutoBuildHint")}
          checked={overlayModules?.autoBuild ?? false}
          disabled={!overlayModules}
          onChange={() => toggleOverlayModule("autoBuild")}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{t("Settings.flashSideLabel")}</span>
            <span style={{ fontSize: 11, color: COLORS.muted }}>{t("Settings.flashSideHint")}</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["left", "right"] as const).map((side) => (
              <button key={side} onClick={() => handleSetFlashSide(side)} style={pillStyle(flashSide === side)}>
                {t(side === "left" ? "Settings.flashSideLeft" : "Settings.flashSideRight")}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{t("Settings.calibrateAbilityBar")}</span>
            <span style={{ fontSize: 11, color: COLORS.muted }}>{t("Settings.calibrateAbilityBarHint")}</span>
          </div>
          <button onClick={handleCalibrateAbilityBar} style={smallButtonStyle}>
            {abilityCalibrated ? t("Settings.calibrateAbilityBarDone") : t("Settings.calibrateAbilityBarButton")}
          </button>
        </div>
      </section>

      <section style={sectionStyle}>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: autoLaunch === null ? "default" : "pointer" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: TYPE.body, fontWeight: 500 }}>{t("Settings.autoLaunchLabel")}</span>
            <span style={{ fontSize: TYPE.label, color: COLORS.muted }}>{t("Settings.autoLaunchDescription")}</span>
          </div>
          <Switch checked={autoLaunch ?? false} disabled={autoLaunch === null} onChange={toggleAutoLaunch} />
        </label>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>{t("Settings.languageSection")}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SUPPORTED_LOCALES.map((l) => (
            <button key={l} onClick={() => setLocale(l as Locale)} style={pillStyle(locale === l)}>
              {LOCALE_LABEL[l]}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function OverlayToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: disabled ? "default" : "pointer" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, color: COLORS.muted }}>{hint}</span>
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

function Switch({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <span className="rc-switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="rc-switch-track" />
      <span className="rc-switch-thumb" />
    </span>
  );
}

function ProfileSection({
  user,
  onUserChange,
  onLogout,
}: {
  user: AccountUser;
  onUserChange: (user: AccountUser) => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState(user.username ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "saved"; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const result = await window.riftcompass.updateUsername(username);
    setBusy(false);
    if (result.ok) {
      onUserChange(result.user);
      setStatus({ kind: "saved", message: t("Settings.usernameSaved") });
      return;
    }
    const known = ["invalidUsername", "usernameTaken", "network"];
    const key = known.includes(result.error) ? result.error : "unknown";
    setStatus({ kind: "error", message: t(`Settings.usernameErrors.${key}`) });
  }

  return (
    <>
      {/* Single account block (avatar + username edit + logout) — the
          identity used to render again in a separate "Cuenta" section,
          duplicating it. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <Avatar user={user} size={48} />
        <form onSubmit={handleSubmit} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, color: COLORS.muted }}>{t("Settings.usernameLabel")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("Settings.usernamePlaceholder")}
              maxLength={24}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="submit" disabled={busy} style={{ ...smallButtonStyle, flexShrink: 0, opacity: busy ? 0.6 : 1 }}>
              {busy ? t("Settings.usernameSaving") : t("Settings.usernameSave")}
            </button>
          </div>
          {status ? (
            <span style={{ fontSize: 12, color: status.kind === "error" ? COLORS.destructive : COLORS.rose }}>{status.message}</span>
          ) : (
            <span style={{ fontSize: 11, color: COLORS.muted }}>{t("Settings.usernameHint")}</span>
          )}
        </form>
        <button onClick={onLogout} style={{ ...smallButtonStyle, flexShrink: 0 }}>
          {t("Settings.accountLogout")}
        </button>
      </div>
      <button
        onClick={() => window.riftcompass.openExternal(`${API_BASE_URL}/account`)}
        style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", background: "none", border: "none", color: COLORS.rose, fontSize: 12, cursor: "pointer", padding: 0 }}
      >
        {t("Settings.manageOnWeb")} <ArrowSquareOut size={12} />
      </button>
    </>
  );
}

function LoginForm({ onLoggedIn }: { onLoggedIn: (user: AccountUser) => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await window.riftcompass.login(email, password);
    setBusy(false);
    if (result.ok) {
      onLoggedIn(result.user);
      return;
    }
    setError(t(errorKey(result.error)));
  }

  function errorKey(code: string): string {
    const known = ["invalidCredentials", "emailNotVerified", "tooManyAttempts", "network"];
    return `Auth.errors.${known.includes(code) ? code : "unknown"}`;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 12, color: COLORS.muted, margin: 0 }}>{t("Settings.accountLoginIntro")}</p>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("Auth.emailLabel")}
        style={inputStyle}
      />
      <input
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("Auth.passwordLabel")}
        style={inputStyle}
      />
      {error ? <span style={{ fontSize: 12, color: COLORS.destructive }}>{error}</span> : null}
      <button type="submit" disabled={busy} style={{ ...smallButtonStyle, alignSelf: "flex-start", opacity: busy ? 0.6 : 1 }}>
        {busy ? t("Auth.loggingIn") : t("Auth.loginButton")}
      </button>
    </form>
  );
}

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  borderRadius: 10,
  border: `1px solid ${COLORS.cardBorder}`,
  background: `${COLORS.card}99`,
  padding: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: FONT_HEADING,
  fontSize: 15,
  fontWeight: 400,
  margin: 0,
};

const smallButtonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "7px 14px",
  borderRadius: 6,
  border: `1px solid ${COLORS.cardBorder}`,
  background: "none",
  color: COLORS.text,
  cursor: "pointer",
};

