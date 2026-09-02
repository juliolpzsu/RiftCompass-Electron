import {
  Brain,
  Coins,
  Crown,
  Stack,
  ListNumbers,
  MapTrifold as MapIcon,
  Sword,
  Timer,
  Tree,
  Waves,
  type Icon,
} from "@phosphor-icons/react";

// Same tool set and icon choices as riftcompass.com (src/lib/tool-meta.tsx
// in the main repo) — kept in sync by hand since this is a separate
// codebase. Title/description come from the i18n catalog now (ToolsIndex.*
// in i18n/messages/*.ts), not hardcoded here — `id` doubles as the
// translation key. `native` marks which ones are actually built in this
// app yet; the rest show honestly as "not built yet" instead of a broken/
// fake link.
export type ToolId =
  | "goldCalculator"
  | "waveTimer"
  | "tierList"
  | "cooldowns"
  | "draft"
  | "map"
  | "personalityTest"
  | "jungleXp"
  | "championPool"
  | "metaTierList";

export interface ToolMeta {
  id: ToolId;
  icon: Icon;
  accent: string;
  native: boolean;
}

// Tool order must match the web's: this follows TOOL_ROUTES's own key
// order in the web repo (src/lib/tool-routes.ts), which is what that
// site's /tools grid actually iterates over.
export const TOOLS: ToolMeta[] = [
  { id: "tierList", icon: ListNumbers, accent: "#ffc857", native: true },
  { id: "cooldowns", icon: Timer, accent: "#4d7fe8", native: true },
  { id: "draft", icon: Sword, accent: "#d6394a", native: true },
  { id: "map", icon: MapIcon, accent: "#e63977", native: true },
  { id: "goldCalculator", icon: Coins, accent: "#e0873f", native: true },
  { id: "waveTimer", icon: Waves, accent: "#2bb8ad", native: true },
  { id: "personalityTest", icon: Brain, accent: "#7839ac", native: true },
  { id: "jungleXp", icon: Tree, accent: "#2f9d68", native: true },
  { id: "championPool", icon: Stack, accent: "#6366d4", native: true },
  { id: "metaTierList", icon: Crown, accent: "#9aa5b1", native: true },
];

// The Tools grid's "Compare Profiles" card isn't a ToolId (it opens the
// duo-comparison view, not a tools/* route) — its accent lived as a bare
// string literal in MainView.tsx, invisible to anyone updating the palette
// above. Kept here as a sibling constant instead of forcing it into
// ToolMeta/TOOLS, which are specifically the routes that mirror the web's
// TOOL_ROUTES order.
export const COMPARE_PROFILES_ACCENT = "#34d399";
