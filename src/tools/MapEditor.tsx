import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Circle,
  Eraser,
  Minus,
  Cursor,
  PencilSimple,
  Plus,
  TextT as TypeIcon,
  User,
  Warning,
  X,
} from "@phosphor-icons/react";
import { ChampionCombobox } from "../ChampionCombobox";
import { championSquareUrl, fetchChampionMap, fetchLatestVersion, type ChampionInfo } from "../ddragon";
import { useI18n } from "../i18n";
import { COLORS as THEME } from "../theme";
import type { AccountUser, SavedMapSummary } from "../riftcompass";
// The map image is imported as a module, not referenced by absolute path:
// `<img src="/images/...">` works under Vite's dev server but breaks in a
// packaged app (a leading "/" resolves against the filesystem root, so
// the image 404s silently in every real build). Importing makes Vite emit
// a real hashed asset and rewrite the reference to a path that works the
// same way its own bundled JS/CSS already do.
import summonersRiftMapUrl from "../assets/summoners-rift-map.jpg";

// Ported from the web app's src/components/tools/map-editor.tsx — same
// canvas drawing model, same fixed-turret calibration, same known fixes
// already applied there (naturalWidth check before drawImage, degenerate-
// stroke guard, constant on-screen icon size under zoom). Saves to the
// account (createMap/getSavedMaps/deleteMap below), same real parity with
// the web's saved_maps table as every other saveable tool here.
// localStorage (DRAFT_KEY below) only holds the in-progress draft, same
// pattern as Draft Simulator/Personality Test — not a stand-in for account
// save.
type Point = { x: number; y: number };
type Tool =
  | "select"
  | "pen"
  | "arrow"
  | "zone"
  | "ward-normal"
  | "ward-control"
  | "minion"
  | "champion"
  | "text"
  | "eraser";
type Stroke =
  | { type: "pen"; color: string; points: Point[] }
  | { type: "arrow"; color: string; from: Point; to: Point }
  | { type: "zone"; color: string; center: Point; radius: number }
  | { type: "ward"; kind: "normal" | "control"; point: Point }
  | { type: "minion"; point: Point }
  | { type: "champion"; championId: string; point: Point }
  | { type: "text"; color: string; point: Point; text: string; size: number };

// Turrets aren't user-placed — these 22 positions (11 per side: 3 lanes ×
// outer/inner/inhibitor + 2 nexus turrets), in the 876x876 canvas space,
// are calibrated against the 1380x1380 map image's framing (the original
// hand calibration for the old 438x438 image, remapped by
// cross-correlating the two images' framings). Kept identical to the web
// app's copy.
const ORDER_TURRETS: Point[] = [
  { x: 65, y: 265 },
  { x: 96, y: 482 },
  { x: 75, y: 624 },
  { x: 219, y: 656 },
  { x: 258, y: 800 },
  { x: 134, y: 769 },
  { x: 110, y: 738 },
  { x: 410, y: 787 },
  { x: 617, y: 813 },
  { x: 347, y: 503 },
  { x: 302, y: 591 },
];
const CHAOS_TURRETS: Point[] = [
  { x: 259, y: 66 },
  { x: 472, y: 92 },
  { x: 618, y: 78 },
  { x: 655, y: 219 },
  { x: 741, y: 109 },
  { x: 768, y: 136 },
  { x: 800, y: 259 },
  { x: 527, y: 376 },
  { x: 576, y: 286 },
  { x: 786, y: 394 },
  { x: 815, y: 612 },
];
const FIXED_TURRETS: Point[] = [...ORDER_TURRETS, ...CHAOS_TURRETS];

const CANVAS_WIDTH = 876;
const CANVAS_HEIGHT = 876;
const ERASE_RADIUS = 20;
const WARD_ICON_SIZE = 30;
const CHAMPION_ICON_SIZE = 44;
const MINION_ICON_SIZE = 28;
const TURRET_ICON_SIZE = 34;
// 750 real game units of turret attack range, mapped against Summoner's
// Rift's real 16000x16000 game-unit play space: 750 / 16000 x 876 ~= 41px.
const TURRET_RANGE_RADIUS = 41;
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;
const WARD_GLYPH_COLORS: Record<"normal" | "control", string> = {
  normal: "#facc15",
  control: "#e879f9",
};
const MINION_ICON_URL =
  "https://raw.communitydragon.org/latest/game/assets/characters/sru_chaosminionmelee/hud/bluemelee_square.png";
const TURRET_ICON_URL_ORDER =
  "https://raw.communitydragon.org/latest/game/assets/characters/sruap_turret_order5/hud/turret_blue_square.png";
const TURRET_ICON_URL_CHAOS =
  "https://raw.communitydragon.org/latest/game/assets/characters/sruap_turret_chaos5/hud/turret_red_square.png";

const DRAW_COLORS = ["#38bdf8", "#fb7185", "#fbbf24", "#e5e7eb"];
// Curated palette for the text color popover — high-contrast colors that
// stay readable over the map art, plus the hue slider for anything else.
const TEXT_COLOR_SWATCHES = [
  "#f8fafc", "#94a3b8", "#ef4444", "#f97316", "#fbbf24", "#22c55e",
  "#14b8a6", "#38bdf8", "#3b82f6", "#8b5cf6", "#e879f9", "#fb7185",
];

// Text labels are map-anchored (they scale with zoom, like strokes, unlike
// the constant-screen-size icons): a label belongs to a spot on the map.
const TEXT_DEFAULT_SIZE = 22;
const TEXT_MIN_SIZE = 12;
const TEXT_MAX_SIZE = 96;
const TEXT_PADDING = 6;

// Shared measuring context for text hit-boxes — the same font math the
// canvas draw uses, so hit-testing, the selection box and the rendered
// label always agree.
let textMeasureCtx: CanvasRenderingContext2D | null = null;
function textBox(stroke: { text: string; size: number; point: Point }): { x: number; y: number; w: number; h: number } {
  if (!textMeasureCtx) textMeasureCtx = document.createElement("canvas").getContext("2d");
  let width = stroke.text.length * stroke.size * 0.6;
  if (textMeasureCtx) {
    textMeasureCtx.font = `600 ${stroke.size}px sans-serif`;
    width = textMeasureCtx.measureText(stroke.text).width;
  }
  return {
    x: stroke.point.x - TEXT_PADDING,
    y: stroke.point.y - stroke.size * 0.68,
    w: width + TEXT_PADDING * 2,
    h: stroke.size * 1.36,
  };
}
// Accessible name for each swatch above (same order) — the buttons render
// as plain colored circles with no text, so without this a screen reader
// announces them as unlabeled buttons.
const DRAW_COLOR_NAMES = ["blue", "rose", "amber", "white"] as const;

// The app's own color chooser (curated swatches + hue slider) — shared by
// the toolbar's custom draw color and the text selection's recolor, so
// picking a color looks the same everywhere (the native picker isn't
// stylable at all).
function ColorPopover({
  current,
  onPick,
  style,
}: {
  current: string;
  onPick: (value: string, done: boolean) => void;
  style: React.CSSProperties;
}) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: 176,
        padding: 10,
        borderRadius: 10,
        background: "rgba(18,14,20,0.97)",
        border: `1px solid ${THEME.cardBorder}`,
        boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
        zIndex: 20,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
        {TEXT_COLOR_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className="rc-swatch"
            onClick={() => onPick(swatch, true)}
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              background: swatch,
              border: current === swatch ? "2px solid #fff" : "1px solid rgba(255,255,255,0.25)",
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
      </div>
      <input
        type="range"
        className="rc-hue-slider"
        min={0}
        max={360}
        defaultValue={330}
        onChange={(e) => onPick(`hsl(${e.target.value}, 85%, 60%)`, false)}
      />
    </div>
  );
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lengthSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

// Icon markers and the eraser's hit radius stay a constant *screen* size
// regardless of zoom — the canvas's on-screen size grows with zoom while
// its drawing-buffer resolution never changes, so drawing/hit-testing at
// `base / zoom` canvas-pixels keeps their rendered screen size constant.
// Freehand pen/arrow/zone strokes deliberately scale with the map instead.
function eff(base: number, zoom: number): number {
  return base / zoom;
}

function strokeNear(stroke: Stroke, point: Point, zoom: number): boolean {
  if (stroke.type === "arrow") {
    return distanceToSegment(point, stroke.from, stroke.to) < eff(ERASE_RADIUS, zoom);
  }
  if (stroke.type === "zone") {
    return distance(point, stroke.center) < stroke.radius + eff(ERASE_RADIUS, zoom);
  }
  if (stroke.type === "ward") {
    return distance(point, stroke.point) < eff(WARD_ICON_SIZE, zoom) / 2 + eff(ERASE_RADIUS, zoom) / 2;
  }
  if (stroke.type === "minion") {
    return distance(point, stroke.point) < eff(MINION_ICON_SIZE, zoom) / 2 + eff(ERASE_RADIUS, zoom) / 2;
  }
  if (stroke.type === "champion") {
    return distance(point, stroke.point) < eff(CHAMPION_ICON_SIZE, zoom) / 2 + eff(ERASE_RADIUS, zoom) / 2;
  }
  if (stroke.type === "text") {
    const box = textBox(stroke);
    const margin = eff(ERASE_RADIUS, zoom) / 2;
    return (
      point.x >= box.x - margin &&
      point.x <= box.x + box.w + margin &&
      point.y >= box.y - margin &&
      point.y <= box.y + box.h + margin
    );
  }
  return stroke.points.some((p) => distance(p, point) < eff(ERASE_RADIUS, zoom));
}

function drawWardGlyph(ctx: CanvasRenderingContext2D, point: Point, kind: "normal" | "control", size: number) {
  const r = size / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = WARD_GLYPH_COLORS[kind];
  ctx.beginPath();
  ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#0a0a0f";
  ctx.fillStyle = "#0a0a0f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y, r * 0.62, r * 0.36, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(point.x, point.y, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  if (kind === "control") {
    ctx.beginPath();
    ctx.moveTo(point.x - r * 0.7, point.y - r * 0.7);
    ctx.lineTo(point.x + r * 0.7, point.y + r * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

function drawIconImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  point: Point,
  size: number,
  ringColor: string,
) {
  const half = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, half + 2, 0, Math.PI * 2);
  ctx.fillStyle = ringColor;
  ctx.fill();
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, point.x - half, point.y - half, size, size);
  }
  ctx.restore();
}

function movableAnchor(stroke: Stroke): Point | null {
  if (stroke.type === "zone") return stroke.center;
  if (stroke.type === "ward" || stroke.type === "minion" || stroke.type === "champion" || stroke.type === "text") {
    return stroke.point;
  }
  return null;
}

function movableRadius(stroke: Stroke, zoom: number): number {
  if (stroke.type === "zone") return stroke.radius;
  if (stroke.type === "ward") return eff(WARD_ICON_SIZE, zoom) / 2;
  if (stroke.type === "minion") return eff(MINION_ICON_SIZE, zoom) / 2;
  if (stroke.type === "champion") return eff(CHAMPION_ICON_SIZE, zoom) / 2;
  return eff(30, zoom); // text
}

function findMovableAt(strokes: Stroke[], point: Point, zoom: number): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (stroke.type === "text") {
      // Hit the whole label box, not a circle around the (left-edge)
      // anchor — long labels are clickable anywhere on the text.
      const box = textBox(stroke);
      if (point.x >= box.x - 6 && point.x <= box.x + box.w + 6 && point.y >= box.y - 6 && point.y <= box.y + box.h + 6) {
        return i;
      }
      continue;
    }
    const anchor = movableAnchor(stroke);
    if (anchor && distance(point, anchor) <= movableRadius(stroke, zoom) + 6) return i;
  }
  return -1;
}

function withAnchor(stroke: Stroke, point: Point): Stroke {
  if (stroke.type === "zone") return { ...stroke, center: point };
  if (stroke.type === "ward" || stroke.type === "minion" || stroke.type === "champion" || stroke.type === "text") {
    return { ...stroke, point };
  }
  return stroke;
}

// A bigger, sharper triangular head (was a shallow 22px/~26° wedge that
// read as barely more than a thickened line end against the busy map
// art) plus a thin dark outline so it stays legible over any background
// color underneath. `from` is passed in already pulled back by
// shaftPullback() below, so the round-capped shaft line terminates at the
// head's own back edge instead of poking a small round bump through it.
const ARROWHEAD_LENGTH = 30;
const ARROWHEAD_HALF_ANGLE = Math.PI / 6.5; // ~28°, a noticeably sharper wedge

function shaftPullback(from: Point, to: Point): Point {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const pullback = ARROWHEAD_LENGTH * 0.72;
  return { x: to.x - pullback * Math.cos(angle), y: to.y - pullback * Math.sin(angle) };
}

function drawArrowhead(ctx: CanvasRenderingContext2D, from: Point, to: Point) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const leftX = to.x - ARROWHEAD_LENGTH * Math.cos(angle - ARROWHEAD_HALF_ANGLE);
  const leftY = to.y - ARROWHEAD_LENGTH * Math.sin(angle - ARROWHEAD_HALF_ANGLE);
  const rightX = to.x - ARROWHEAD_LENGTH * Math.cos(angle + ARROWHEAD_HALF_ANGLE);
  const rightY = to.y - ARROWHEAD_LENGTH * Math.sin(angle + ARROWHEAD_HALF_ANGLE);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(10, 10, 16, 0.55)";
  ctx.stroke();
  ctx.restore();
}

const TOOLS: Tool[] = ["select", "pen", "arrow", "zone", "ward-normal", "ward-control", "minion", "champion", "text", "eraser"];

const DRAFT_KEY = "riftcompass-overlay:map-editor:draft:v1";

export function MapEditor() {
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef<Stroke | null>(null);
  const eraserPointRef = useRef<Point | null>(null);
  const movingRef = useRef<{ index: number; offset: Point } | null>(null);
  const panningRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const championImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const minionImageRef = useRef<HTMLImageElement | null>(null);
  const turretOrderImageRef = useRef<HTMLImageElement | null>(null);
  const turretChaosImageRef = useRef<HTMLImageElement | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(DRAW_COLORS[0]);
  const [selectedChampion, setSelectedChampion] = useState<ChampionInfo | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [iconImagesReady, setIconImagesReady] = useState(0);
  const [pendingText, setPendingText] = useState("");
  const [pendingTextPoint, setPendingTextPoint] = useState<Point | null>(null);
  const [pendingTextSize, setPendingTextSize] = useState(TEXT_DEFAULT_SIZE);
  const [pendingTextColor, setPendingTextColor] = useState<string | null>(null);
  // Set while re-editing an existing label (it's lifted out of `strokes`
  // into the inline editor) — Escape restores this original.
  const editingOriginalRef = useRef<Extract<Stroke, { type: "text" }> | null>(null);
  const [selectedTextIndex, setSelectedTextIndex] = useState<number | null>(null);
  const [textColorPickerOpen, setTextColorPickerOpen] = useState(false);
  // The toolbar's fifth swatch: a paint-drop that remembers one custom
  // color chosen from the ColorPopover, next to the four defaults.
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [drawColorPickerOpen, setDrawColorPickerOpen] = useState(false);
  const textResizeRef = useRef<{ index: number; startSize: number; cx: number; cy: number; d0: number } | null>(null);

  // The color popover belongs to one selection — changing or clearing the
  // selection closes it.
  useEffect(() => {
    setTextColorPickerOpen(false);
  }, [selectedTextIndex]);
  const [zoom, setZoom] = useState(1);
  const [showTurrets, setShowTurrets] = useState(true);
  const [notes, setNotes] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [mapSaveOpen, setMapSaveOpen] = useState(false);
  const [mapName, setMapName] = useState("");
  const [mapSaveError, setMapSaveError] = useState<string | null>(null);
  const [mapSaveSuccess, setMapSaveSuccess] = useState(false);
  const [isSavingMap, setIsSavingMap] = useState(false);
  const [savedMaps, setSavedMaps] = useState<SavedMapSummary[] | null>(null);
  const [mapListOpen, setMapListOpen] = useState(false);

  useEffect(() => {
    window.riftcompass.getSession().then(setUser);
  }, []);

  async function handleConfirmMapSave() {
    setMapSaveError(null);
    setIsSavingMap(true);
    const result = await window.riftcompass.createMap(mapName, strokes, notes);
    setIsSavingMap(false);
    if (!result.ok) {
      setMapSaveError(result.error);
      return;
    }
    setSavedMaps(result.maps);
    setMapSaveOpen(false);
    setMapName("");
    setMapSaveSuccess(true);
  }

  async function toggleMapList() {
    const next = !mapListOpen;
    setMapListOpen(next);
    if (next && savedMaps === null) {
      setSavedMaps(await window.riftcompass.getSavedMaps());
    }
  }

  async function handleLoadMap(id: string) {
    const result = await window.riftcompass.getSavedMap(id);
    if (!result.ok) return;
    setSelectedTextIndex(null);
    setStrokes(
      (result.strokes as Stroke[]).map((s) => (s.type === "text" && !s.size ? { ...s, size: TEXT_DEFAULT_SIZE } : s)),
    );
    setNotes(result.notes);
    setRedoStack([]);
    setMapListOpen(false);
  }

  async function handleDeleteMap(id: string) {
    const result = await window.riftcompass.deleteMap(id);
    if (result.ok) setSavedMaps(result.maps);
  }

  // `autoFocus` alone isn't reliable here: this input mounts inside a
  // component that redraws its canvas on frequent state changes, and a
  // focus() call issued synchronously during that render can lose to a
  // focus-stealing paint on some Chromium/Electron builds. An explicit
  // effect that reruns whenever a new text point opens focuses it for real
  // once the DOM node actually exists.
  // Focus on the NEXT tick, not synchronously: the click that opens the
  // editor is still in flight when the input mounts, and its trailing
  // compatibility mousedown (dispatched after pointerdown) lands on the
  // canvas — natively blurring whatever just got focused, which fired
  // onBlur -> commit(empty) and closed the editor in the same instant.
  // Deferring the focus until the click sequence has fully finished means
  // there's nothing focused yet for that mousedown to blur.
  useEffect(() => {
    if (!pendingTextPoint) return;
    const id = window.setTimeout(() => textInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [pendingTextPoint]);

  // The text selection belongs to the move tool — switching tools clears it.
  useEffect(() => {
    if (tool !== "select") setSelectedTextIndex(null);
  }, [tool]);

  useEffect(() => {
    fetchLatestVersion().then(setVersion);
    fetchChampionMap().then((m) => setChampions(Object.values(m.byInternalId)));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as { strokes?: Stroke[]; notes?: string };
        if ((draft.strokes && draft.strokes.length > 0) || draft.notes) {
          // Drafts saved before text labels had a per-label size.
          setStrokes((draft.strokes ?? []).map((s) => (s.type === "text" && !s.size ? { ...s, size: TEXT_DEFAULT_SIZE } : s)));
          setNotes(draft.notes ?? "");
        }
      }
    } catch {
      // Corrupt/unavailable storage — start fresh.
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      if (strokes.length > 0 || notes.trim()) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ strokes, notes }));
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // Ignore write failures.
    }
  }, [strokes, notes, draftLoaded]);

  function ensureChampionImage(championId: string) {
    if (championImagesRef.current.has(championId) || !version) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setIconImagesReady((n) => n + 1);
    img.src = championSquareUrl(version, championId);
    championImagesRef.current.set(championId, img);
  }

  useEffect(() => {
    const minionImg = new Image();
    minionImg.crossOrigin = "anonymous";
    minionImg.onload = () => setIconImagesReady((n) => n + 1);
    minionImg.src = MINION_ICON_URL;
    minionImageRef.current = minionImg;

    const turretOrderImg = new Image();
    turretOrderImg.crossOrigin = "anonymous";
    turretOrderImg.onload = () => setIconImagesReady((n) => n + 1);
    turretOrderImg.src = TURRET_ICON_URL_ORDER;
    turretOrderImageRef.current = turretOrderImg;

    const turretChaosImg = new Image();
    turretChaosImg.crossOrigin = "anonymous";
    turretChaosImg.onload = () => setIconImagesReady((n) => n + 1);
    turretChaosImg.src = TURRET_ICON_URL_CHAOS;
    turretChaosImageRef.current = turretChaosImg;
  }, []);

  useEffect(() => {
    if (!version) return;
    for (const stroke of strokes) {
      if (stroke.type === "champion") ensureChampionImage(stroke.championId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, version]);

  function render(previewStroke?: Stroke | null) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const all = previewStroke ? [...strokes, previewStroke] : strokes;

    if (showTurrets) {
      for (const point of FIXED_TURRETS) {
        ctx.save();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = "#f87171";
        ctx.beginPath();
        ctx.arc(point.x, point.y, TURRET_RANGE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#f87171";
        ctx.stroke();
        ctx.restore();
      }
      for (const point of ORDER_TURRETS) {
        drawIconImage(ctx, turretOrderImageRef.current ?? undefined, point, eff(TURRET_ICON_SIZE, zoom), "#0a0a0f");
      }
      for (const point of CHAOS_TURRETS) {
        drawIconImage(ctx, turretChaosImageRef.current ?? undefined, point, eff(TURRET_ICON_SIZE, zoom), "#0a0a0f");
      }
    }

    for (const stroke of all) {
      if (stroke.type === "ward") {
        drawWardGlyph(ctx, stroke.point, stroke.kind, eff(WARD_ICON_SIZE, zoom));
        continue;
      }
      if (stroke.type === "minion") {
        drawIconImage(ctx, minionImageRef.current ?? undefined, stroke.point, eff(MINION_ICON_SIZE, zoom), "#0a0a0f");
        continue;
      }
      if (stroke.type === "champion") {
        const img = championImagesRef.current.get(stroke.championId);
        drawIconImage(ctx, img, stroke.point, eff(CHAMPION_ICON_SIZE, zoom), "#e5e7eb");
        continue;
      }
      if (stroke.type === "text") {
        ctx.save();
        ctx.font = `600 ${stroke.size}px sans-serif`;
        ctx.textBaseline = "middle";
        const box = textBox(stroke);
        ctx.fillStyle = "rgba(10, 10, 16, 0.72)";
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = stroke.color;
        ctx.fillText(stroke.text, stroke.point.x, stroke.point.y);
        ctx.restore();
        continue;
      }

      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (stroke.type === "pen") {
        if (stroke.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (stroke.type === "arrow") {
        const shaftEnd = shaftPullback(stroke.from, stroke.to);
        ctx.beginPath();
        ctx.moveTo(stroke.from.x, stroke.from.y);
        ctx.lineTo(shaftEnd.x, shaftEnd.y);
        ctx.stroke();
        drawArrowhead(ctx, stroke.from, stroke.to);
      } else {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(stroke.center.x, stroke.center.y, stroke.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }
    }

    if (tool === "eraser" && eraserPointRef.current) {
      const p = eraserPointRef.current;
      const r = eff(ERASE_RADIUS, zoom);
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(248, 113, 113, 0.95)";
      ctx.fillStyle = "rgba(248, 113, 113, 0.18)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, tool, iconImagesReady, zoom, showTurrets]);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function pushStroke(stroke: Stroke) {
    setStrokes((prev) => [...prev, stroke]);
    setRedoStack([]);
  }

  function removeNear(point: Point) {
    // Indices shift on removal — drop the text selection rather than let
    // it silently point at a different stroke.
    setSelectedTextIndex(null);
    setStrokes((prev) => prev.filter((s) => !strokeNear(s, point, zoom)));
    setRedoStack([]);
  }

  function commitPendingText() {
    const text = pendingText.trim();
    if (pendingTextPoint && text) {
      pushStroke({
        type: "text",
        color: pendingTextColor ?? color,
        point: pendingTextPoint,
        text,
        size: pendingTextSize,
      });
    }
    // Committing empty while re-editing deletes the label (the original
    // was lifted out of `strokes` when the editor opened).
    editingOriginalRef.current = null;
    setPendingTextPoint(null);
    setPendingText("");
    setPendingTextSize(TEXT_DEFAULT_SIZE);
    setPendingTextColor(null);
  }

  function cancelPendingText() {
    if (editingOriginalRef.current) {
      pushStroke(editingOriginalRef.current);
      editingOriginalRef.current = null;
    }
    setPendingTextPoint(null);
    setPendingText("");
    setPendingTextSize(TEXT_DEFAULT_SIZE);
    setPendingTextColor(null);
  }

  // Lifts an existing label into the inline editor (click it again with
  // the text tool) — same editor as creation, prefilled.
  function openTextEditorFor(index: number) {
    const stroke = strokes[index];
    if (stroke.type !== "text") return;
    editingOriginalRef.current = stroke;
    setStrokes((prev) => prev.filter((_, i) => i !== index));
    setSelectedTextIndex(null);
    setPendingTextPoint(stroke.point);
    setPendingText(stroke.text);
    setPendingTextSize(stroke.size);
    setPendingTextColor(stroke.color);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointFromEvent(e);
    if (pendingTextPoint) commitPendingText();
    if (tool === "select") {
      const index = findMovableAt(strokes, point, zoom);
      if (index === -1) {
        // Empty space with the move tool: drag pans the viewport (the
        // classic hand-tool behavior) instead of doing nothing.
        setSelectedTextIndex(null);
        const el = mapScrollRef.current;
        if (el) {
          panningRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
          canvasRef.current?.setPointerCapture(e.pointerId);
        }
        return;
      }
      // Text labels get a selection (resize handles + color picker) on
      // top of the shared drag-to-move behavior.
      setSelectedTextIndex(strokes[index].type === "text" ? index : null);
      const anchor = movableAnchor(strokes[index])!;
      movingRef.current = { index, offset: { x: anchor.x - point.x, y: anchor.y - point.y } };
      canvasRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "eraser") {
      eraserPointRef.current = point;
      removeNear(point);
      return;
    }
    if (tool === "ward-normal" || tool === "ward-control") {
      pushStroke({ type: "ward", kind: tool === "ward-control" ? "control" : "normal", point });
      return;
    }
    if (tool === "minion") {
      pushStroke({ type: "minion", point });
      return;
    }
    if (tool === "champion") {
      if (!selectedChampion) return;
      ensureChampionImage(selectedChampion.internalId);
      pushStroke({ type: "champion", championId: selectedChampion.internalId, point });
      return;
    }
    if (tool === "text") {
      const index = findMovableAt(strokes, point, zoom);
      if (index !== -1 && strokes[index].type === "text") {
        openTextEditorFor(index);
        return;
      }
      setPendingTextPoint(point);
      setPendingText("");
      setPendingTextSize(TEXT_DEFAULT_SIZE);
      setPendingTextColor(null);
      return;
    }
    drawingRef.current =
      tool === "pen"
        ? { type: "pen", color, points: [point] }
        : tool === "arrow"
          ? { type: "arrow", color, from: point, to: point }
          : { type: "zone", color, center: point, radius: 0 };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointFromEvent(e);
    if (panningRef.current) {
      const el = mapScrollRef.current;
      if (el) {
        el.scrollLeft = panningRef.current.scrollLeft - (e.clientX - panningRef.current.startX);
        el.scrollTop = panningRef.current.scrollTop - (e.clientY - panningRef.current.startY);
      }
      return;
    }
    if (tool === "select" && movingRef.current) {
      const { index, offset } = movingRef.current;
      const newAnchor = { x: point.x + offset.x, y: point.y + offset.y };
      setStrokes((prev) => {
        const next = [...prev];
        next[index] = withAnchor(next[index], newAnchor);
        return next;
      });
      return;
    }
    if (tool === "eraser") {
      eraserPointRef.current = point;
      if (e.buttons === 1) {
        removeNear(point);
      } else {
        render();
      }
      return;
    }
    if (!drawingRef.current) return;
    if (drawingRef.current.type === "pen") {
      drawingRef.current.points.push(point);
    } else if (drawingRef.current.type === "arrow") {
      drawingRef.current.to = point;
    } else if (drawingRef.current.type === "zone") {
      drawingRef.current.radius = distance(drawingRef.current.center, point);
    }
    render(drawingRef.current);
  }

  function handlePointerUp() {
    if (panningRef.current) {
      panningRef.current = null;
      return;
    }
    if (movingRef.current) {
      movingRef.current = null;
      return;
    }
    const finished = drawingRef.current;
    const isDegenerate =
      finished?.type === "pen"
        ? finished.points.length < 2
        : finished?.type === "zone"
          ? finished.radius < 1
          : finished?.type === "arrow"
            ? finished.from.x === finished.to.x && finished.from.y === finished.to.y
            : false;
    if (finished) {
      if (!isDegenerate) pushStroke(finished);
      drawingRef.current = null;
    }
  }

  function handlePointerLeave() {
    eraserPointRef.current = null;
    handlePointerUp();
    render();
  }

  function handleUndo() {
    setSelectedTextIndex(null);
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      setRedoStack((r) => [...r, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  function handleRedo() {
    setSelectedTextIndex(null);
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setStrokes((s) => [...s, last]);
      return prev.slice(0, -1);
    });
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // The only genuinely destructive action on this toolbar — it empties
  // both the strokes AND the undo/redo stacks in the same call, so unlike
  // every other tool here there's no way back once it runs. A native
  // confirm() is the cheapest real guard against a stray click losing a
  // map full of notes.
  function handleClear() {
    if (!window.confirm(t("MapEditor.clearConfirm"))) return;
    setSelectedTextIndex(null);
    setStrokes([]);
    setRedoStack([]);
  }

  function handleZoomIn() {
    setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 100) / 100));
  }
  function handleZoomOut() {
    setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 100) / 100));
  }
  function handleZoomReset() {
    setZoom(1);
  }
  // Plain wheel over the map zooms — no modifier key — anchored on the
  // cursor: the content point under the mouse must stay under the mouse,
  // so the scroll position is corrected right after the zoom re-layout
  // (content size scales linearly with zoom, hence the next/prev factor).
  // Attached as a native non-passive listener because React's synthetic
  // onWheel can't reliably preventDefault the container's own scrolling.
  const mapScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = mapScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setZoom((z) => {
        const stepped = e.deltaY < 0 ? z + ZOOM_STEP : z - ZOOM_STEP;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(stepped * 100) / 100));
        if (next !== z) {
          const factor = next / z;
          pendingScrollRef.current = {
            left: (el.scrollLeft + mx) * factor - mx,
            top: (el.scrollTop + my) * factor - my,
          };
        }
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  useLayoutEffect(() => {
    const el = mapScrollRef.current;
    const pending = pendingScrollRef.current;
    if (!el || !pending) return;
    pendingScrollRef.current = null;
    el.scrollLeft = pending.left;
    el.scrollTop = pending.top;
  }, [zoom]);

  function handleExport() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bgImg = new Image();
    bgImg.crossOrigin = "anonymous";
    bgImg.onload = () => {
      const out = document.createElement("canvas");
      out.width = CANVAS_WIDTH;
      out.height = CANVAS_HEIGHT;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bgImg, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.drawImage(canvas, 0, 0);
      const link = document.createElement("a");
      link.href = out.toDataURL("image/png");
      link.download = "riftcompass-strategy.png";
      link.click();
    };
    bgImg.src = summonersRiftMapUrl;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderRadius: 8,
          border: `1px solid ${THEME.cardBorder}`,
          background: `${THEME.card}99`,
          padding: "10px 14px",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {TOOLS.map((toolOption) => {
            const active = tool === toolOption;
            return (
              <button
                key={toolOption}
                onClick={() => setTool(toolOption)}
                title={t(`MapEditor.tools.${toolOption}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: `1px solid ${active ? (toolOption === "eraser" ? THEME.badMild : THEME.rose) : THEME.cardBorder}`,
                  background: active ? `${THEME.rose}26` : "none",
                  color: active ? THEME.rose : THEME.text,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <ToolIcon tool={toolOption} selectedChampion={selectedChampion} />
                {t(`MapEditor.tools.${toolOption}`)}
              </button>
            );
          })}
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            {DRAW_COLORS.map((swatch, i) => (
              <button
                key={swatch}
                onClick={() => setColor(swatch)}
                title={t(`MapEditor.colors.${DRAW_COLOR_NAMES[i]}`)}
                aria-label={t(`MapEditor.colors.${DRAW_COLOR_NAMES[i]}`)}
                aria-pressed={color === swatch}
                style={{
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  borderRadius: 999,
                  border: `2px solid ${color === swatch ? THEME.text : "transparent"}`,
                  background: swatch,
                  cursor: "pointer",
                  transform: color === swatch ? "scale(1.1)" : undefined,
                }}
              />
            ))}
            {/* Fifth swatch: paint-drop custom color. Shows the chosen
                custom color (or a neutral "+" drop before one is picked)
                and opens the shared ColorPopover. */}
            <button
              type="button"
              onClick={() => setDrawColorPickerOpen((open) => !open)}
              title={t("MapEditor.customColor")}
              aria-label={t("MapEditor.customColor")}
              aria-pressed={customColor !== null && color === customColor}
              style={{
                position: "relative",
                width: 22,
                height: 22,
                flexShrink: 0,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                transform: customColor !== null && color === customColor ? "scale(1.1)" : undefined,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: 1,
                  borderRadius: "0 50% 50% 50%",
                  transform: "rotate(45deg)",
                  background: customColor ?? "rgba(255,255,255,0.1)",
                  border: `2px solid ${customColor !== null && color === customColor ? THEME.text : "rgba(255,255,255,0.45)"}`,
                  transition: "background 160ms ease",
                }}
              />
              {customColor === null ? (
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: THEME.text, lineHeight: 1 }}>
                  +
                </span>
              ) : null}
            </button>
            {drawColorPickerOpen ? (
              <ColorPopover
                current={color}
                onPick={(value, done) => {
                  setCustomColor(value);
                  setColor(value);
                  if (done) setDrawColorPickerOpen(false);
                }}
                style={{ position: "absolute", top: "calc(100% + 8px)", right: 0 }}
              />
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button onClick={() => setShowTurrets((v) => !v)} style={pillButtonStyle(showTurrets)}>
            <img src={TURRET_ICON_URL_ORDER} alt="" style={{ width: 16, height: 16, borderRadius: 3, marginRight: 6 }} />
            {showTurrets ? t("MapEditor.hideTurrets") : t("MapEditor.showTurrets")}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 2, border: `1px solid ${THEME.cardBorder}`, borderRadius: 6, padding: 2 }}>
            <IconButton onClick={handleZoomOut} disabled={zoom <= MIN_ZOOM} label={t("MapEditor.zoomOut")}>
              <Minus size={13} />
            </IconButton>
            <button onClick={handleZoomReset} style={{ minWidth: 46, background: "none", border: "none", color: THEME.muted, fontSize: 11, cursor: "pointer", padding: "0 4px" }}>
              {Math.round(zoom * 100)}%
            </button>
            <IconButton onClick={handleZoomIn} disabled={zoom >= MAX_ZOOM} label={t("MapEditor.zoomIn")}>
              <Plus size={13} />
            </IconButton>
          </div>
          <button onClick={handleUndo} disabled={strokes.length === 0} style={pillButtonStyle(false, strokes.length === 0)}>
            {t("MapEditor.undo")}
          </button>
          <button onClick={handleRedo} disabled={redoStack.length === 0} style={pillButtonStyle(false, redoStack.length === 0)}>
            {t("MapEditor.redo")}
          </button>
          <button onClick={handleClear} disabled={strokes.length === 0} style={dangerPillButtonStyle(strokes.length === 0)}>
            <Warning size={13} /> {t("MapEditor.clear")}
          </button>
          <button onClick={handleExport} disabled={strokes.length === 0} style={pillButtonStyle(false, strokes.length === 0)}>
            {t("MapEditor.export")}
          </button>
        </div>
      </div>

      {tool === "champion" ? (
        <div style={{ maxWidth: 280 }}>
          <ChampionCombobox champions={champions} value={selectedChampion} onChange={setSelectedChampion} placeholder={t("Common.searchChampion")} />
        </div>
      ) : null}

      {user === undefined ? null : user ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            {mapSaveOpen ? (
              <>
                <input
                  value={mapName}
                  onChange={(e) => setMapName(e.target.value)}
                  placeholder={t("MapEditor.saveMapPlaceholder")}
                  autoFocus
                  maxLength={60}
                  style={{
                    maxWidth: 260,
                    background: THEME.card,
                    color: THEME.text,
                    border: `1px solid ${THEME.cardBorder}`,
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 13,
                  }}
                />
                <button
                  onClick={handleConfirmMapSave}
                  disabled={isSavingMap || !mapName.trim() || (strokes.length === 0 && !notes.trim())}
                  style={pillButtonStyle(false, isSavingMap || !mapName.trim() || (strokes.length === 0 && !notes.trim()))}
                >
                  {isSavingMap ? t("MapEditor.saveMapSaving") : t("MapEditor.saveMapConfirm")}
                </button>
                <button
                  onClick={() => {
                    setMapSaveOpen(false);
                    setMapSaveError(null);
                  }}
                  style={pillButtonStyle(false, false)}
                >
                  {t("MapEditor.saveMapCancel")}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setMapSaveOpen(true);
                    setMapSaveSuccess(false);
                  }}
                  disabled={strokes.length === 0 && !notes.trim()}
                  style={pillButtonStyle(false, strokes.length === 0 && !notes.trim())}
                >
                  {t("MapEditor.saveMap")}
                </button>
                <button onClick={toggleMapList} style={pillButtonStyle(false, false)}>
                  {t("MapEditor.myMaps")}
                </button>
              </>
            )}
            {mapSaveError ? <span style={{ fontSize: 13, color: THEME.rose }}>{t(`MapEditor.saveMapErrors.${mapSaveError}`)}</span> : null}
            {mapSaveSuccess && !mapSaveOpen ? <span style={{ fontSize: 13, color: THEME.goodMild }}>{t("MapEditor.saveMapSuccess")}</span> : null}
          </div>
          {mapListOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, borderRadius: 8, border: `1px solid ${THEME.cardBorder}`, background: `${THEME.card}66`, padding: 10 }}>
              {savedMaps === null ? (
                <span style={{ fontSize: 13, color: THEME.muted }}>{t("Cooldowns.loading")}</span>
              ) : savedMaps.length === 0 ? (
                <span style={{ fontSize: 13, color: THEME.muted }}>{t("MapEditor.myMapsEmpty")}</span>
              ) : (
                savedMaps.map((map) => (
                  <div key={map.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {map.name}
                    </span>
                    <span style={{ fontSize: 12, color: THEME.muted }}>{new Date(map.createdAt).toLocaleDateString()}</span>
                    <button onClick={() => handleLoadMap(map.id)} style={pillButtonStyle(false, false)}>
                      {t("MapEditor.load")}
                    </button>
                    <button onClick={() => handleDeleteMap(map.id)} title={t("MapEditor.delete")} style={pillButtonStyle(false, false)}>
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <span style={{ fontSize: 13, color: THEME.muted }}>{t("MapEditor.loginToSave")}</span>
      )}

      <div style={{ display: "flex", gap: 20, width: "100%", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div
          ref={mapScrollRef}
          style={{
            position: "relative",
            flex: "2 1 520px",
            maxWidth: 780,
            // Same square shape as the canvas: with a fixed viewport the
            // zoomed content overflows on BOTH axes, so vertical panning
            // has scroll range too (without this the container just grew
            // taller and only scrollLeft had anywhere to go).
            aspectRatio: "1 / 1",
            overflow: "auto",
            borderRadius: 10,
            border: `1px solid ${THEME.cardBorder}`,
          }}
        >
          <div style={{ position: "relative", width: `${zoom * 100}%`, minWidth: "100%", aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}>
            <img
              src={summonersRiftMapUrl}
              alt="Summoner's Rift"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
              draggable={false}
            />
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                touchAction: "none",
                cursor: tool === "eraser" ? "none" : tool === "select" ? "move" : "crosshair",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerLeave}
            />
            {pendingTextPoint ? (
              <input
                ref={textInputRef}
                value={pendingText}
                placeholder={t("MapEditor.textPlaceholder")}
                onChange={(e) => setPendingText(e.target.value)}
                onBlur={commitPendingText}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commitPendingText();
                  if (e.key === "Escape") cancelPendingText();
                }}
                style={{
                  position: "absolute",
                  left: `${(pendingTextPoint.x / CANVAS_WIDTH) * 100}%`,
                  top: `${(pendingTextPoint.y / CANVAS_HEIGHT) * 100}%`,
                  transform: "translateY(-50%)",
                  minWidth: 140,
                  color: pendingTextColor ?? color,
                  zIndex: 10,
                  borderRadius: 4,
                  background: "rgba(12,10,13,0.92)",
                  border: `2px solid ${THEME.rose}`,
                  padding: "4px 8px",
                  fontSize: 13,
                  fontWeight: 600,
                  outline: "none",
                }}
              />
            ) : null}
            {(() => {
              if (selectedTextIndex === null) return null;
              const candidate = strokes[selectedTextIndex];
              if (!candidate || candidate.type !== "text") return null;
              const selected: Extract<Stroke, { type: "text" }> = candidate;
              const box = textBox(selected);
              const pctX = (v: number) => `${(v / CANVAS_WIDTH) * 100}%`;
              const pctY = (v: number) => `${(v / CANVAS_HEIGHT) * 100}%`;
              const handleStyle = (cursor: string): React.CSSProperties => ({
                position: "absolute",
                width: 11,
                height: 11,
                background: THEME.rose,
                border: "1.5px solid #fff",
                borderRadius: 3,
                pointerEvents: "auto",
                cursor,
                touchAction: "none",
              });
              function startResize(e: React.PointerEvent<HTMLDivElement>) {
                e.stopPropagation();
                e.preventDefault();
                const canvas = canvasRef.current;
                if (!canvas || selectedTextIndex === null) return;
                const rect = canvas.getBoundingClientRect();
                const cx = rect.left + ((box.x + box.w / 2) / CANVAS_WIDTH) * rect.width;
                const cy = rect.top + ((box.y + box.h / 2) / CANVAS_HEIGHT) * rect.height;
                const d0 = Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy));
                textResizeRef.current = { index: selectedTextIndex, startSize: selected.size, cx, cy, d0 };
                e.currentTarget.setPointerCapture(e.pointerId);
              }
              function moveResize(e: React.PointerEvent<HTMLDivElement>) {
                const resize = textResizeRef.current;
                if (!resize) return;
                const d = Math.hypot(e.clientX - resize.cx, e.clientY - resize.cy);
                const next = Math.min(TEXT_MAX_SIZE, Math.max(TEXT_MIN_SIZE, Math.round(resize.startSize * (d / resize.d0))));
                setStrokes((prev) => prev.map((s, i) => (i === resize.index && s.type === "text" ? { ...s, size: next } : s)));
              }
              function endResize() {
                textResizeRef.current = null;
              }
              return (
                <div
                  style={{
                    position: "absolute",
                    left: pctX(box.x),
                    top: pctY(box.y),
                    width: pctX(box.w),
                    height: pctY(box.h),
                    border: `1.5px dashed ${THEME.rose}`,
                    borderRadius: 4,
                    pointerEvents: "none",
                    zIndex: 9,
                  }}
                >
                  <div style={{ ...handleStyle("nwse-resize"), left: -6, top: -6 }} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} />
                  <div style={{ ...handleStyle("nesw-resize"), right: -6, top: -6 }} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} />
                  <div style={{ ...handleStyle("nesw-resize"), left: -6, bottom: -6 }} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} />
                  <div style={{ ...handleStyle("nwse-resize"), right: -6, bottom: -6 }} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} />
                  {/* Paint-drop color trigger — opens the app's own color
                      popover (swatches + hue slider) instead of the
                      unstylable native picker. */}
                  <button
                    type="button"
                    title={t("MapEditor.textColor")}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setTextColorPickerOpen((open) => !open)}
                    style={{ position: "absolute", top: -38, right: -2, width: 26, height: 26, pointerEvents: "auto", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 2,
                        borderRadius: "0 50% 50% 50%",
                        transform: "rotate(45deg)",
                        background: selected.color,
                        border: "2px solid rgba(255,255,255,0.85)",
                        boxShadow: "0 2px 10px rgba(0,0,0,0.55)",
                        transition: "background 160ms ease",
                      }}
                    />
                  </button>
                  {textColorPickerOpen ? (
                    <ColorPopover
                      current={selected.color}
                      onPick={(value) => {
                        setStrokes((prev) => prev.map((s, i) => (i === selectedTextIndex && s.type === "text" ? { ...s, color: value } : s)));
                      }}
                      style={{ position: "absolute", bottom: "100%", right: -2, marginBottom: 44 }}
                    />
                  ) : null}
                </div>
              );
            })()}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 260px", maxWidth: 340 }}>
          <label style={{ fontSize: 13, color: THEME.muted }}>{t("MapEditor.notesTitle")}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("MapEditor.notesPlaceholder")}
            maxLength={4000}
            rows={16}
            style={{
              width: "100%",
              resize: "none",
              borderRadius: 8,
              border: `1px solid ${THEME.cardBorder}`,
              background: `${THEME.card}99`,
              padding: "8px 12px",
              fontSize: 13,
              lineHeight: 1.6,
              color: THEME.text,
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        width: 22,
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 5,
        border: "none",
        background: "none",
        color: disabled ? `${THEME.muted}66` : THEME.muted,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function pillButtonStyle(active: boolean, disabled?: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    border: `1px solid ${active ? THEME.rose : THEME.cardBorder}`,
    background: active ? `${THEME.rose}26` : "none",
    color: disabled ? THEME.muted : active ? THEME.rose : THEME.text,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

// The one genuinely destructive action on this toolbar (see handleClear) —
// same shape as pillButtonStyle but always rose-bordered so it doesn't
// blend in with Undo/Redo/Export.
function dangerPillButtonStyle(disabled?: boolean): React.CSSProperties {
  return {
    ...pillButtonStyle(false, disabled),
    border: `1px solid ${THEME.rose}`,
    color: disabled ? THEME.muted : THEME.rose,
  };
}

function ToolIcon({ tool, selectedChampion }: { tool: Tool; selectedChampion: ChampionInfo | null }) {
  if (tool === "ward-normal" || tool === "ward-control") {
    const glyphColor = WARD_GLYPH_COLORS[tool === "ward-control" ? "control" : "normal"];
    return (
      <svg viewBox="0 0 24 24" width={14} height={14}>
        <ellipse cx="12" cy="12" rx="9" ry="5.5" fill={glyphColor} />
        <circle cx="12" cy="12" r="2.4" fill="#0a0a0f" />
        {tool === "ward-control" ? <line x1="6" y1="6" x2="18" y2="18" stroke="#0a0a0f" strokeWidth="1.5" /> : null}
      </svg>
    );
  }
  if (tool === "minion") {
    return <img src={MINION_ICON_URL} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} />;
  }
  if (tool === "champion") {
    if (selectedChampion) {
      return <img src={selectedChampion.iconUrl} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} />;
    }
    return <User size={14} />;
  }
  const icons: Record<Exclude<Tool, "ward-normal" | "ward-control" | "minion" | "champion">, React.ReactNode> = {
    select: <Cursor size={14} />,
    pen: <PencilSimple size={14} />,
    arrow: <ArrowRight size={14} />,
    zone: <Circle size={14} />,
    text: <TypeIcon size={14} />,
    eraser: <Eraser size={14} />,
  };
  return <>{icons[tool as Exclude<Tool, "ward-normal" | "ward-control" | "minion" | "champion">]}</>;
}
