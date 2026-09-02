import { useEffect, useMemo, useState } from "react";
import { Bookmark, X } from "@phosphor-icons/react";
import { fetchChampionMap, type ChampionInfo } from "../ddragon";
import { DRAFT_STEPS, type DraftTeam } from "../lib/draft-order";
import { ALL_ROLES, rolesOf, type ChampionRole } from "../lib/champion-roles";
import { positionIconUrl } from "../lib/profile-analysis";
import { useI18n } from "../i18n";
import { COLORS } from "../theme";
import type { AccountUser, SavedDraft } from "../riftcompass";

// Same draft flow and champion grid as the web's draft-simulator.tsx, with
// the same account-backed save: drafts go through /api/v1/saved-drafts to
// the same saved_drafts rows the web reads and writes, so a draft saved on
// either side shows up on the other.
const TEAM_COLORS: Record<DraftTeam, { border: string; bg: string; text: string }> = {
  blue: { border: "#0ea5e966", bg: "#0ea5e91a", text: "#7dd3fc" },
  red: { border: "#f43f5e66", bg: "#f43f5e1a", text: "#fda4af" },
};

// Same draft-survives-a-remount pattern as this app's Map Editor/Champion
// Pool Builder/Tier List Builder/Personality Test — leaving this screen
// and coming back used to reset selections to empty, losing all picks and
// bans. No "was this explicitly loaded from a save" guard, same as Map
// Editor's own DRAFT_KEY: loading a saved draft just becomes the new
// scratch too, which the persist effect below picks up on its own.
const DRAFT_KEY = "riftcompass-overlay:draft-simulator:draft:v1";

export function DraftSimulator() {
  const { t, locale } = useI18n();
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const [selections, setSelections] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<ChampionRole | "ALL">("ALL");
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [saveOpen, setSaveOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    fetchChampionMap().then((m) => setChampions(Object.values(m.byInternalId)));
    window.riftcompass.getSession().then(setUser);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const stored: string[] = JSON.parse(raw);
        if (Array.isArray(stored) && stored.length > 0) setSelections(stored);
      }
    } catch {
      // Corrupt/unavailable storage — start fresh.
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      if (selections.length > 0) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(selections));
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // Ignore write failures.
    }
  }, [selections, draftLoaded]);

  const championById = useMemo(() => new Map(champions.map((c) => [c.internalId, c])), [champions]);

  const stepIndex = selections.length;
  const currentStep = DRAFT_STEPS[stepIndex] ?? null;
  const isComplete = stepIndex >= DRAFT_STEPS.length;
  const usedIds = useMemo(() => new Set(selections), [selections]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return champions.filter((c) => {
      if (roleFilter !== "ALL" && !rolesOf(c.internalId)?.includes(roleFilter)) return false;
      if (query && !c.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [champions, search, roleFilter]);

  async function handleConfirmSave() {
    setSaveError(null);
    setIsSaving(true);
    const result = await window.riftcompass.createDraft(draftName, selections);
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSavedDrafts(result.drafts);
    setSaveOpen(false);
    setDraftName("");
    setSaveSuccess(true);
  }

  async function toggleList() {
    const next = !listOpen;
    setListOpen(next);
    if (next && savedDrafts === null) {
      setSavedDrafts(await window.riftcompass.getSavedDrafts());
    }
  }

  async function handleDeleteDraft(id: string) {
    const result = await window.riftcompass.deleteDraft(id);
    if (result.ok) setSavedDrafts(result.drafts);
  }

  function slotsFor(team: DraftTeam, action: "ban" | "pick"): (string | null)[] {
    const ids: string[] = [];
    DRAFT_STEPS.forEach((step, index) => {
      if (step.team === team && step.action === action) {
        ids.push(selections[index] ?? "");
      }
    });
    const total = DRAFT_STEPS.filter((s) => s.team === team && s.action === action).length;
    while (ids.length < total) ids.push("");
    return ids.map((id) => (id ? id : null));
  }

  function handlePick(championId: string) {
    if (!currentStep || usedIds.has(championId)) return;
    setSelections((prev) => [...prev, championId]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(260px, 1fr))", gap: 14 }}>
        <TeamBoard team="blue" bans={slotsFor("blue", "ban")} picks={slotsFor("blue", "pick")} championById={championById} />
        <TeamBoard team="red" bans={slotsFor("red", "ban")} picks={slotsFor("red", "pick")} championById={championById} />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderRadius: 8,
          border: `1px solid ${COLORS.cardBorder}`,
          background: `${COLORS.card}99`,
          padding: "10px 14px",
        }}
      >
        {isComplete ? (
          <span style={{ fontSize: 14, fontWeight: 500 }}>{t("Draft.complete")}</span>
        ) : currentStep ? (
          <span style={{ fontSize: 14, fontWeight: 500, color: TEAM_COLORS[currentStep.team].text }}>
            {t(currentStep.action === "ban" ? "Draft.turnBan" : "Draft.turnPick", {
              team: t(currentStep.team === "blue" ? "Draft.blueTeam" : "Draft.redTeam"),
            })}
          </span>
        ) : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setSelections((prev) => prev.slice(0, -1))}
            disabled={selections.length === 0}
            style={buttonStyle(selections.length === 0)}
          >
            {t("Draft.undo")}
          </button>
          <button
            onClick={() => {
              setSelections([]);
              setSearch("");
            }}
            style={buttonStyle(false)}
          >
            {t("Draft.reset")}
          </button>
        </div>
      </div>

      {user === undefined ? null : user ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            {saveOpen ? (
              <>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder={t("Draft.saveDraftPlaceholder")}
                  autoFocus
                  maxLength={60}
                  style={{
                    maxWidth: 260,
                    background: COLORS.card,
                    color: COLORS.text,
                    border: `1px solid ${COLORS.cardBorder}`,
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 13,
                  }}
                />
                <button
                  onClick={handleConfirmSave}
                  disabled={isSaving || !draftName.trim() || selections.length === 0}
                  style={buttonStyle(isSaving || !draftName.trim() || selections.length === 0)}
                >
                  {isSaving ? t("Draft.saveDraftSaving") : t("Draft.saveDraftConfirm")}
                </button>
                <button
                  onClick={() => {
                    setSaveOpen(false);
                    setSaveError(null);
                  }}
                  style={buttonStyle(false)}
                >
                  {t("Draft.saveDraftCancel")}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setSaveOpen(true);
                    setSaveSuccess(false);
                  }}
                  disabled={selections.length === 0}
                  style={buttonStyle(selections.length === 0)}
                >
                  {t("Draft.saveDraft")}
                </button>
                <button onClick={toggleList} style={{ ...buttonStyle(false), display: "flex", alignItems: "center", gap: 6 }}>
                  <Bookmark size={14} />
                  {t("Draft.myDrafts")}
                </button>
              </>
            )}
            {saveError ? <span style={{ fontSize: 13, color: COLORS.destructive }}>{t(`Draft.saveDraftErrors.${saveError}`)}</span> : null}
            {saveSuccess && !saveOpen ? <span style={{ fontSize: 13, color: COLORS.rose }}>{t("Draft.saveDraftSuccess")}</span> : null}
          </div>
          {listOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, borderRadius: 8, border: `1px solid ${COLORS.cardBorder}`, background: `${COLORS.card}66`, padding: 10 }}>
              {savedDrafts === null ? (
                <span style={{ fontSize: 13, color: COLORS.muted }}>{t("Cooldowns.loading")}</span>
              ) : savedDrafts.length === 0 ? (
                <span style={{ fontSize: 13, color: COLORS.muted }}>{t("Draft.myDraftsEmpty")}</span>
              ) : (
                savedDrafts.map((draft) => (
                  <div key={draft.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {draft.name}
                    </span>
                    <span style={{ fontSize: 12, color: COLORS.muted }}>{new Date(draft.createdAt).toLocaleDateString(locale)}</span>
                    <button
                      onClick={() => {
                        setSelections(draft.selections);
                        setListOpen(false);
                      }}
                      style={buttonStyle(false)}
                    >
                      {t("Draft.load")}
                    </button>
                    <button onClick={() => handleDeleteDraft(draft.id)} title={t("Draft.delete")} style={{ ...buttonStyle(false), padding: "6px 8px" }}>
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <span style={{ fontSize: 13, color: COLORS.muted }}>{t("Draft.loginToSave")}</span>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Draft.searchPlaceholder")}
            style={{
              maxWidth: 260,
              background: COLORS.card,
              color: COLORS.text,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 13,
            }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <button onClick={() => setRoleFilter("ALL")} style={rolePillStyle(roleFilter === "ALL")}>
              {t("Draft.filterAll")}
            </button>
            {ALL_ROLES.map((role) => {
              const iconUrl = positionIconUrl(role);
              return (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  title={t(`Profile.positions.${role.toLowerCase()}`)}
                  style={roleIconStyle(roleFilter === role)}
                >
                  {iconUrl ? <img src={iconUrl} alt="" style={{ width: 16, height: 16 }} /> : null}
                </button>
              );
            })}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            maxHeight: 320,
            overflowY: "auto",
            borderRadius: 8,
            border: `1px solid ${COLORS.cardBorder}`,
            background: `${COLORS.card}99`,
            padding: 8,
          }}
        >
          {filtered.map((champ) => {
            const used = usedIds.has(champ.internalId);
            return (
              <button
                key={champ.internalId}
                title={champ.name}
                disabled={used || isComplete}
                onClick={() => handlePick(champ.internalId)}
                style={{
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  overflow: "hidden",
                  borderRadius: 6,
                  border: `1px solid ${COLORS.cardBorder}`,
                  padding: 0,
                  background: "none",
                  cursor: used || isComplete ? "not-allowed" : "pointer",
                  opacity: used ? 0.2 : 1,
                }}
              >
                <img src={champ.iconUrl} alt={champ.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    border: `1px solid ${COLORS.cardBorder}`,
    background: "none",
    color: disabled ? COLORS.muted : COLORS.text,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function rolePillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? COLORS.rose : COLORS.cardBorder}`,
    background: active ? `${COLORS.rose}1a` : "none",
    color: active ? COLORS.rose : COLORS.muted,
    fontSize: 12,
    cursor: "pointer",
  };
}

function roleIconStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: 999,
    border: `1px solid ${active ? COLORS.rose : COLORS.cardBorder}`,
    background: active ? `${COLORS.rose}1a` : "none",
    cursor: "pointer",
    padding: 0,
  };
}

function TeamBoard({
  team,
  bans,
  picks,
  championById,
}: {
  team: DraftTeam;
  bans: (string | null)[];
  picks: (string | null)[];
  championById: Map<string, ChampionInfo>;
}) {
  const { t } = useI18n();
  const style = TEAM_COLORS[team];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        borderRadius: 10,
        border: `1px solid ${style.border}`,
        background: style.bg,
        padding: 14,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: style.text }}>{t(team === "blue" ? "Draft.blueTeam" : "Draft.redTeam")}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>{t("Draft.bans")}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {bans.map((id, i) => (
            <ChampionSlot key={i} championId={id} championById={championById} muted />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>{t("Draft.picks")}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {picks.map((id, i) => (
            <ChampionSlot key={i} championId={id} championById={championById} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChampionSlot({
  championId,
  championById,
  muted,
}: {
  championId: string | null;
  championById: Map<string, ChampionInfo>;
  muted?: boolean;
}) {
  const champ = championId ? championById.get(championId) : null;
  return (
    <div
      title={champ?.name}
      style={{
        width: 34,
        height: 34,
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: 6,
        border: `1px solid ${COLORS.cardBorder}`,
        background: `${COLORS.background}66`,
        filter: muted ? "grayscale(1)" : undefined,
        opacity: muted ? 0.7 : 1,
      }}
    >
      {champ ? (
        <img src={champ.iconUrl} alt={champ.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
    </div>
  );
}
