import { useLayoutEffect, useRef } from "react";
import type { SuggestedGame } from "@/content/branding";
import { isHubEnabled } from "@/profile/profile";
import { type GamesDecision, pageRelevance } from "./relevance";
import { planRun, type RunPlan } from "./settle";
import {
  type HubAnswer,
  useHubAnswer,
  useWizardContext,
} from "./useWizardContext";
import { NO_GAMES } from "./wizardContexts";

export type DecidedPlan = Exclude<RunPlan, { status: "waiting" }>;

interface PlannerProps {
  settled: readonly string[];
  rerun: boolean;
  /** Plan the run. When false the planner only decides the games. */
  planning: boolean;
  /** The plan, and the games the games page offers, once every page answered. */
  onPlan(plan: DecidedPlan, games: SuggestedGame[]): void;
  /** The first games decision, for the background game download. */
  onGames(games: GamesDecision): void;
}

const NO_HUB: HubAnswer = { loading: false, signedIn: false, unknown: false };

/**
 * Reads what the relevance rules need and reports the plan. The provider
 * mounts it only while there is something to decide, because what it reads
 * scans content and asks the hub. A profile with the hub off never asks it.
 */
export function WizardPlanner(props: PlannerProps) {
  return isHubEnabled() ? (
    <PlannerAskingHub {...props} />
  ) : (
    <Planner {...props} hub={NO_HUB} />
  );
}

function PlannerAskingHub(props: PlannerProps) {
  return <Planner {...props} hub={useHubAnswer()} />;
}

function Planner({
  hub,
  settled,
  rerun,
  planning,
  onPlan,
  onGames,
}: PlannerProps & { hub: HubAnswer }) {
  const { ctx } = useWizardContext(hub);
  const next = planning
    ? planRun({ settled, relevance: pageRelevance(ctx), rerun })
    : null;
  const decided = next === null || next.status === "waiting" ? null : next;
  const pickGames = ctx.games?.kind === "pick" ? ctx.games.games : NO_GAMES;

  // StrictMode runs an effect twice with one render's values, and a plan is
  // reported once. A layout effect, so the wizard replaces the blank frame
  // before the app behind it can paint.
  const applied = useRef<DecidedPlan | null>(null);
  useLayoutEffect(() => {
    if (!decided || applied.current === decided) return;
    applied.current = decided;
    onPlan(decided, pickGames);
  }, [decided, pickGames, onPlan]);

  const games = ctx.games;
  const gamesSent = useRef(false);
  useLayoutEffect(() => {
    if (!games || gamesSent.current) return;
    gamesSent.current = true;
    onGames(games);
  }, [games, onGames]);

  return null;
}
