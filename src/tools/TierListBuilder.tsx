import { forwardRef, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { Bookmark, MagnifyingGlass } from "@phosphor-icons/react";
import { fetchChampionMap, toDDragonId, type ChampionInfo } from "../ddragon";
import { TIERS, TIER_COLORS, type Tier } from "../lib/tier-colors";
import { ALL_ROLES, rolesOf, primaryRoleOf, type ChampionRole } from "../lib/champion-roles";
import { positionIconUrl } from "../lib/profile-analysis";
import { useI18n } from "../i18n";
import { COLORS } from "../theme";
import { API_BASE_URL } from "../shared/api";
import type { AccountUser, SavedTierList } from "../riftcompass";

// Real percentile tier from RiftCompass's own crawler, same source and same
// tiering math as MetaTierList.tsx's ported groupByRole/tierByWinrate (kept
// local here too rather than shared, matching how MetaTierList already
// duplicates it from the web instead of importing across tool files) —
// shown as a small badge on each chip so a user's own S-D placement can be
// compared at a glance against actual measured winrate.
interface ChampionWinrate {
  championName: string;
  role: string;
  winRate: number;
}

interface TieredWinrate extends ChampionWinrate {
  tier: Tier;
}

function tierByWinrate(entries: ChampionWinrate[]): TieredWinrate[] {
  const sorted = [...entries].sort((a, b) => b.winRate - a.winRate);
  const total = sorted.length;
  return sorted.map((entry, index) => {
    const tierIndex = Math.min(TIERS.length - 1, Math.floor((index / total) * TIERS.length));
    return { ...entry, tier: TIERS[tierIndex] };
  });
}

function groupByRole(winrates: ChampionWinrate[]): Record<string, TieredWinrate[]> {
  const byRole = new Map<string, ChampionWinrate[]>();
  for (const entry of winrates) {
    const list = byRole.get(entry.role) ?? [];
    list.push(entry);
    byRole.set(entry.role, list);
  }
  const result: Record<string, TieredWinrate[]> = {};
  for (const [role, entries] of byRole) result[role] = tierByWinrate(entries);
  return result;
}

// Ported from the web app's src/components/tools/tier-list-builder.tsx —
// same drag-and-drop board (@dnd-kit), same known gotchas already fixed
// there (multi-container collision detection, DragOverlay drift), this
// app's own UI.
const UNRANKED = "unranked";
const STORAGE_KEY = "riftcompass-overlay:tier-list:v1";

type BoardState = Record<string, string[]>;

function buildInitialState(championIds: string[]): BoardState {
  const state: BoardState = { [UNRANKED]: championIds };
  for (const tier of TIERS) state[tier] = [];
  return state;
}

// Drops any champion id no longer in the real roster and files any real
// champion missing from a saved/localStorage board into unranked — shared
// by the localStorage-autosave path and loading a saved tier list.
function reconcileBoard(parsed: BoardState, championIds: string[]): BoardState {
  const known = new Set(championIds);
  const placed = new Set<string>();
  const next: BoardState = { [UNRANKED]: [], ...Object.fromEntries(TIERS.map((tr) => [tr, []])) };
  for (const key of [...TIERS, UNRANKED]) {
    for (const id of parsed[key] ?? []) {
      if (known.has(id) && !placed.has(id)) {
        next[key].push(id);
        placed.add(id);
      }
    }
  }
  for (const id of championIds) {
    if (!placed.has(id)) next[UNRANKED].push(id);
  }
  return next;
}

function findContainer(id: string, state: BoardState): string | undefined {
  if (id in state) return id;
  return Object.keys(state).find((key) => state[key].includes(id));
}

// Plain `closestCenter` compares distance to each droppable's CENTER, which
// is unreliable across containers of very different sizes (a short, empty
// tier row sitting right above the much taller unranked pool) — preferring
// whichever droppable the pointer is physically inside first fixes it.
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

export function TierListBuilder() {
  const { t } = useI18n();
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const championIds = useMemo(() => champions.map((c) => c.internalId), [champions]);
  const championById = useMemo(() => new Map(champions.map((c) => [c.internalId, c])), [champions]);

  const [board, setBoard] = useState<BoardState>({ [UNRANKED]: [] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [roleFilter, setRoleFilter] = useState<ChampionRole | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [saveOpen, setSaveOpen] = useState(false);
  const [tierListName, setTierListName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [savedTierLists, setSavedTierLists] = useState<SavedTierList[] | null>(null);
  const [winrates, setWinrates] = useState<ChampionWinrate[]>([]);

  useEffect(() => {
    fetchChampionMap().then((m) => setChampions(Object.values(m.byInternalId)));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/champion-winrates`)
      .then((r) => r.json())
      .then((data: { winrates: ChampionWinrate[] }) => setWinrates(data.winrates ?? []))
      .catch(() => setWinrates([]));
  }, []);

  const tieredByRole = useMemo(() => groupByRole(winrates), [winrates]);
  const realTierByChampion = useMemo(() => {
    const map = new Map<string, Tier>();
    for (const champ of champions) {
      const role = primaryRoleOf(champ.internalId);
      if (!role) continue;
      const entry = tieredByRole[role]?.find((e) => toDDragonId(e.championName) === champ.internalId);
      if (entry) map.set(champ.internalId, entry.tier);
    }
    return map;
  }, [champions, tieredByRole]);

  useEffect(() => {
    window.riftcompass.getSession().then(setUser);
  }, []);

  useEffect(() => {
    if (championIds.length === 0) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: BoardState = JSON.parse(saved);
        const known = new Set(championIds);
        const placed = new Set<string>();
        const next: BoardState = { [UNRANKED]: [], ...Object.fromEntries(TIERS.map((tr) => [tr, []])) };
        for (const key of [...TIERS, UNRANKED]) {
          for (const id of parsed[key] ?? []) {
            if (known.has(id) && !placed.has(id)) {
              next[key].push(id);
              placed.add(id);
            }
          }
        }
        for (const id of championIds) {
          if (!placed.has(id)) next[UNRANKED].push(id);
        }
        setBoard(next);
      } else {
        setBoard(buildInitialState(championIds));
      }
    } catch {
      setBoard(buildInitialState(championIds));
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [championIds.length]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    } catch {
      // Ignore write failures.
    }
  }, [board, loaded]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const fromContainer = findContainer(activeId, board);
    const toContainer = findContainer(overId, board) ?? overId;
    if (!fromContainer || !toContainer || fromContainer === toContainer) return;

    setBoard((prev) => {
      const fromItems = prev[fromContainer].filter((id) => id !== activeId);
      const overIndex = prev[toContainer].indexOf(overId);
      const toItems = [...prev[toContainer]];
      const insertAt = overIndex >= 0 ? overIndex : toItems.length;
      toItems.splice(insertAt, 0, activeId);
      return { ...prev, [fromContainer]: fromItems, [toContainer]: toItems };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const container = findContainer(activeId, board);
    if (!container) return;

    const items = board[container];
    const oldIndex = items.indexOf(activeId);
    const newIndex = items.indexOf(overId);
    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      setBoard((prev) => ({ ...prev, [container]: arrayMove(items, oldIndex, newIndex) }));
    }
  }

  function handleReset() {
    setBoard(buildInitialState(championIds));
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  }

  function openSaveForm() {
    setSaveOpen(true);
    setSaveError(null);
    setSaved(false);
  }

  async function handleConfirmSave() {
    setSaveError(null);
    setIsSaving(true);
    const result = await window.riftcompass.createTierList(tierListName, board);
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSaved(true);
    setSaveOpen(false);
    setTierListName("");
    setSavedTierLists(result.tierLists);
  }

  async function toggleList() {
    const next = !listOpen;
    setListOpen(next);
    if (next && savedTierLists === null) {
      setSavedTierLists(await window.riftcompass.getSavedTierLists());
    }
  }

  function handleLoadSaved(tierList: SavedTierList) {
    setBoard(reconcileBoard(tierList.board, championIds));
    setListOpen(false);
  }

  async function handleDeleteSaved(id: string) {
    const result = await window.riftcompass.deleteTierList(id);
    if (result.ok) setSavedTierLists(result.tierLists);
  }

  const activeChampion = activeId ? championById.get(activeId) : null;

  const trimmedSearch = search.trim().toLowerCase();
  const filteredUnranked = (board[UNRANKED] ?? []).filter((id) => {
    if (roleFilter !== "ALL" && !rolesOf(id)?.includes(roleFilter)) return false;
    if (trimmedSearch) {
      const champ = championById.get(id);
      if (!champ || !champ.name.toLowerCase().includes(trimmedSearch)) return false;
    }
    return true;
  });

  return (
    <DndContext
      id="tier-list-dnd"
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {user === undefined ? (
            <span />
          ) : user ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              {saveOpen ? (
                <>
                  <input
                    value={tierListName}
                    onChange={(e) => setTierListName(e.target.value)}
                    placeholder={t("TierList.saveTierListPlaceholder")}
                    autoFocus
                    maxLength={60}
                    style={{
                      background: "none",
                      border: "none",
                      borderBottom: `1px solid ${COLORS.cardBorder}`,
                      color: COLORS.text,
                      fontSize: 15,
                      padding: "4px 2px",
                      minWidth: 180,
                    }}
                  />
                  <button
                    onClick={handleConfirmSave}
                    disabled={isSaving || !tierListName.trim()}
                    style={ghostButtonStyle(isSaving || !tierListName.trim())}
                  >
                    {isSaving ? t("TierList.saveTierListSaving") : t("TierList.saveTierListConfirm")}
                  </button>
                  <button
                    onClick={() => {
                      setSaveOpen(false);
                      setSaveError(null);
                    }}
                    style={ghostButtonStyle(false)}
                  >
                    {t("TierList.saveTierListCancel")}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={openSaveForm} style={ghostButtonStyle(false)}>
                    {t("TierList.saveTierList")}
                  </button>
                  <button
                    onClick={toggleList}
                    style={{ ...ghostButtonStyle(false), display: "flex", alignItems: "center", gap: 6, color: COLORS.rose }}
                  >
                    <Bookmark size={16} />
                    {t("TierList.myTierLists")}
                  </button>
                </>
              )}
              {saveError ? (
                <span style={{ fontSize: 13, color: COLORS.rose }}>{t(`TierList.saveTierListErrors.${saveError}`)}</span>
              ) : null}
              {saved ? <span style={{ fontSize: 13, color: "#4ade80" }}>{t("TierList.saveTierListSuccess")}</span> : null}
            </div>
          ) : (
            <span style={{ fontSize: 13, color: COLORS.muted }}>{t("TierList.loginToSave")}</span>
          )}
          <button onClick={handleReset} style={ghostButtonStyle(false)}>
            {t("TierList.reset")}
          </button>
        </div>

        {listOpen ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, borderRadius: 8, border: `1px solid ${COLORS.cardBorder}`, background: `${COLORS.card}66`, padding: 10 }}>
            {savedTierLists === null ? (
              <span style={{ fontSize: 13, color: COLORS.muted }}>{t("Cooldowns.loading")}</span>
            ) : savedTierLists.length === 0 ? (
              <span style={{ fontSize: 13, color: COLORS.muted }}>{t("TierList.myTierListsEmpty")}</span>
            ) : (
              savedTierLists.map((tl) => (
                <div key={tl.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{tl.name}</span>
                  <button onClick={() => handleLoadSaved(tl)} style={ghostButtonStyle(false)}>
                    {t("TierList.load")}
                  </button>
                  <button onClick={() => handleDeleteSaved(tl.id)} style={ghostButtonStyle(false)}>
                    {t("TierList.delete")}
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {TIERS.map((tier) => (
            <TierRow
              key={tier}
              id={tier}
              championIds={board[tier] ?? []}
              championById={championById}
              realTierByChampion={realTierByChampion}
            />
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 13, color: COLORS.muted }}>{t("TierList.unrankedLabel")}</span>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button onClick={() => setRoleFilter("ALL")} style={roleFilterPillStyle(roleFilter === "ALL")}>
                  {t("TierList.filterAll")}
                </button>
                {ALL_ROLES.map((role) => {
                  const iconUrl = positionIconUrl(role);
                  return (
                    <button
                      key={role}
                      onClick={() => setRoleFilter(role)}
                      title={t(`Profile.positions.${role.toLowerCase()}`)}
                      style={roleFilterIconStyle(roleFilter === role)}
                    >
                      {iconUrl ? <img src={iconUrl} alt="" style={{ width: 16, height: 16 }} /> : null}
                    </button>
                  );
                })}
              </div>
              <div style={{ position: "relative", width: 160 }}>
                <MagnifyingGlass size={13} color={COLORS.muted} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("TierList.searchPlaceholder")}
                  style={{
                    width: "100%",
                    background: "none",
                    border: "none",
                    borderBottom: `1px solid ${COLORS.cardBorder}`,
                    color: COLORS.text,
                    fontSize: 13,
                    padding: "4px 4px 4px 22px",
                  }}
                />
              </div>
            </div>
          </div>
          {/* Always rendered, even with zero filtered matches — this is the
              real dnd-kit droppable target for "unrank a champion" (drag out
              of a tier row), so hiding it while a filter/search matches
              nothing would make that impossible until the filter is cleared. */}
          <UnrankedPool
            id={UNRANKED}
            championIds={filteredUnranked}
            championById={championById}
            emptyLabel={t("TierList.noMatches")}
            realTierByChampion={realTierByChampion}
          />
        </div>
      </div>

      <DragOverlay modifiers={[snapCenterToCursor]}>
        {activeChampion ? (
          <ChampionChip
            id={activeChampion.internalId}
            name={activeChampion.name}
            iconUrl={activeChampion.iconUrl}
            realTier={realTierByChampion.get(activeChampion.internalId)}
            dragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// A bordered pill next to text that no longer has a box read as its own
// box, so these are borderless — no `border`, no `background` beyond
// hover, bigger text/padding than this tool's other small utility
// buttons.
function ghostButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 500,
    padding: "6px 4px",
    border: "none",
    background: "none",
    color: disabled ? `${COLORS.text}66` : COLORS.text,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function roleFilterPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? COLORS.rose : COLORS.cardBorder}`,
    background: active ? `${COLORS.rose}26` : "none",
    color: active ? COLORS.rose : COLORS.text,
    fontSize: 12,
    cursor: "pointer",
  };
}

function roleFilterIconStyle(active: boolean): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    border: `1px solid ${active ? COLORS.rose : COLORS.cardBorder}`,
    background: active ? `${COLORS.rose}26` : "none",
    cursor: "pointer",
  };
}

function TierRow({
  id,
  championIds,
  championById,
  realTierByChampion,
}: {
  id: Tier;
  championIds: string[];
  championById: Map<string, ChampionInfo>;
  realTierByChampion: Map<string, Tier>;
}) {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
      <div
        style={{
          width: 52,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          fontSize: 20,
          fontWeight: 700,
          background: TIER_COLORS[id],
          color: COLORS.text,
        }}
      >
        {id}
      </div>
      <SortableContext id={id} items={championIds} strategy={rectSortingStrategy}>
        <div
          ref={setNodeRef}
          style={{
            display: "flex",
            flex: 1,
            flexWrap: "wrap",
            gap: 6,
            minHeight: 64,
            borderRadius: 8,
            border: `1px solid ${COLORS.cardBorder}`,
            background: `${COLORS.card}66`,
            padding: 8,
          }}
        >
          {championIds.map((champId) => {
            const champ = championById.get(champId);
            if (!champ) return null;
            return (
              <SortableChampionChip
                key={champId}
                id={champId}
                name={champ.name}
                iconUrl={champ.iconUrl}
                realTier={realTierByChampion.get(champId)}
              />
            );
          })}
        </div>
      </SortableContext>
    </div>
  );
}

function UnrankedPool({
  id,
  championIds,
  championById,
  emptyLabel,
  realTierByChampion,
}: {
  id: string;
  championIds: string[];
  championById: Map<string, ChampionInfo>;
  emptyLabel?: string;
  realTierByChampion: Map<string, Tier>;
}) {
  const { setNodeRef } = useDroppable({ id });

  return (
    <SortableContext id={id} items={championIds} strategy={rectSortingStrategy}>
      <div
        ref={setNodeRef}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          gap: 6,
          minHeight: 40,
          maxHeight: 320,
          overflowY: "auto",
          borderRadius: 8,
          border: `1px solid ${COLORS.cardBorder}`,
          background: `${COLORS.card}66`,
          padding: 8,
        }}
      >
        {championIds.length === 0 && emptyLabel ? (
          <span style={{ fontSize: 13, color: COLORS.muted, padding: 4 }}>{emptyLabel}</span>
        ) : null}
        {championIds.map((champId) => {
          const champ = championById.get(champId);
          if (!champ) return null;
          return (
            <SortableChampionChip
              key={champId}
              id={champId}
              name={champ.name}
              iconUrl={champ.iconUrl}
              realTier={realTierByChampion.get(champId)}
            />
          );
        })}
      </div>
    </SortableContext>
  );
}

// Wraps the dumb ChampionChip with dnd-kit's sortable behavior — used for
// the real items sitting in a tier row / the unranked pool. The
// DragOverlay's preview copy renders ChampionChip directly instead:
// calling useSortable a second time there (same id) would register a
// duplicate sortable node whose own reordering transform stacks on top of
// the overlay's cursor-tracked position, dragging the chip visibly away
// from the pointer.
function SortableChampionChip({
  id,
  name,
  iconUrl,
  realTier,
}: {
  id: string;
  name: string;
  iconUrl: string;
  realTier?: Tier;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <ChampionChip
      ref={setNodeRef}
      id={id}
      name={name}
      iconUrl={iconUrl}
      style={style}
      attributes={attributes}
      listeners={listeners}
      realTier={realTier}
    />
  );
}

const ChampionChip = forwardRef<
  HTMLDivElement,
  {
    id: string;
    name: string;
    iconUrl: string;
    dragging?: boolean;
    style?: React.CSSProperties;
    attributes?: React.HTMLAttributes<HTMLDivElement>;
    listeners?: Record<string, unknown>;
    realTier?: Tier;
  }
>(function ChampionChip({ name, iconUrl, dragging, style, attributes, listeners, realTier }, ref) {
  const { t } = useI18n();
  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width: 38,
        height: 38,
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: 6,
        border: `1px solid ${COLORS.cardBorder}`,
        cursor: dragging ? "grabbing" : "grab",
        touchAction: "none",
        transform: dragging ? "scale(1.1)" : undefined,
        boxShadow: dragging ? "0 8px 20px -6px rgba(0,0,0,0.6)" : undefined,
        ...style,
      }}
      title={realTier ? `${name} — ${t("TierList.realTierTooltip", { tier: realTier })}` : name}
      {...attributes}
      {...listeners}
    >
      <img src={iconUrl} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
      {realTier ? (
        <span
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 15,
            height: 15,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderTopLeftRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            color: "#fff",
            background: TIER_COLORS[realTier],
          }}
        >
          {realTier}
        </span>
      ) : null}
    </div>
  );
});
