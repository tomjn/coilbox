import type { SuggestedGame } from "@/content/branding";
import type { AskedPage, Relevance } from "./settle";

export type GamesDecision =
  | { kind: "none" }
  | { kind: "auto"; game: SuggestedGame }
  | { kind: "pick"; games: SuggestedGame[] };

/**
 * `candidates` is the branding candidate list, already scoped to the game
 * filter and empty once any game is installed. `null` means still unknown.
 */
export function decideGames(args: {
  candidates: SuggestedGame[] | null;
  hasGameFilter: boolean;
}): GamesDecision | null {
  const { candidates, hasGameFilter } = args;
  if (candidates === null) return null;
  if (candidates.length === 0) return { kind: "none" };
  if (hasGameFilter && candidates.length === 1) {
    return { kind: "auto", game: candidates[0] };
  }
  return { kind: "pick", games: candidates };
}

export interface WizardContext {
  languageStored: boolean;
  profileMode: boolean;
  profileColours: boolean;
  hubEnabled: boolean;
  hub: { loading: boolean; signedIn: boolean; unknown: boolean };
  lobbyAccountCount: number;
  games: GamesDecision | null;
}

export function pageRelevance(
  ctx: WizardContext,
): Record<AskedPage, Relevance> {
  let hub: Relevance;
  if (!ctx.hubEnabled) hub = false;
  else if (ctx.hub.loading) hub = null;
  else if (ctx.hub.unknown) hub = true;
  else hub = !ctx.hub.signedIn;

  return {
    language: !ctx.languageStored,
    appearance: !(ctx.profileMode && ctx.profileColours),
    games: ctx.games === null ? null : ctx.games.kind === "pick",
    hub,
    server: ctx.lobbyAccountCount === 0,
  };
}
