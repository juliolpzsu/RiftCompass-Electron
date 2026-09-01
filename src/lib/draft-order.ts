export type DraftTeam = "blue" | "red";
export type DraftAction = "ban" | "pick";

export interface DraftStep {
  team: DraftTeam;
  action: DraftAction;
}

// Ported verbatim from the web app's src/lib/draft-order.ts — standard
// competitive draft order (LCS/LEC-style tournament draft): 6 bans, 6
// picks, 4 bans, 4 picks, alternating blue/red with the well-known
// "double pick" pattern in the middle of each pick phase.
export const DRAFT_STEPS: DraftStep[] = [
  { team: "blue", action: "ban" },
  { team: "red", action: "ban" },
  { team: "blue", action: "ban" },
  { team: "red", action: "ban" },
  { team: "blue", action: "ban" },
  { team: "red", action: "ban" },
  { team: "blue", action: "pick" },
  { team: "red", action: "pick" },
  { team: "red", action: "pick" },
  { team: "blue", action: "pick" },
  { team: "blue", action: "pick" },
  { team: "red", action: "pick" },
  { team: "red", action: "ban" },
  { team: "blue", action: "ban" },
  { team: "red", action: "ban" },
  { team: "blue", action: "ban" },
  { team: "red", action: "pick" },
  { team: "blue", action: "pick" },
  { team: "blue", action: "pick" },
  { team: "red", action: "pick" },
];
