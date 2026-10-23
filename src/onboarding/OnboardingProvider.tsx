import { useSetting } from "@picoframe/frame";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type { SuggestedGame } from "@/content/branding";
import { PAGE_IDS, SETTLED_KEY, type SettleId } from "./ids";
import type { GamesDecision } from "./relevance";
import { useOnboardingRerun } from "./rerun";
import { addSettled } from "./settle";
import { useBackgroundDownloads } from "./useBackgroundDownloads";
import { usePickedDownloads } from "./usePickedDownloads";
import { Wizard } from "./Wizard";
import { type DecidedPlan, WizardPlanner } from "./WizardPlanner";
import {
  NO_GAMES,
  WizardDownloadsContext,
  WizardGamesContext,
  WizardProblemsContext,
} from "./wizardContexts";

/**
 * Plans the onboarding run and draws the wizard over the app when it opens.
 *
 * The plan is worked out until every unsettled page has answered, then frozen
 * for the rest of the run, so signing in on one page cannot make another
 * vanish. Pages that answered "not relevant" are settled once, as the plan
 * freezes. A rerun request plans again with the settled list ignored.
 *
 * The planner reads content scans, the catalog and the hub, so it is mounted
 * only while a page is unsettled and no plan is decided yet, while a rerun is
 * pending, or while the background game has no games decision. On an install
 * with everything settled it never mounts.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [settled, setSettled] = useSetting<string[]>(SETTLED_KEY, []);
  const { rerun, clear } = useOnboardingRerun();
  const [plan, setPlan] = useState<DecidedPlan | null>(null);
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<SuggestedGame[]>(NO_GAMES);
  const [gamesDecision, setGamesDecision] = useState<GamesDecision | null>(
    null,
  );

  // Several pages can settle in one event (Skip setup), before the setting
  // has re-rendered, so each write builds on the one before it.
  const latest = useRef(settled);
  latest.current = settled;
  const settle = useCallback(
    (ids: readonly SettleId[]) => {
      if (ids.length === 0) return;
      const next = addSettled(latest.current, ids);
      latest.current = next;
      setSettled(next);
    },
    [setSettled],
  );

  // The engine and game downloads run whether or not the wizard opens.
  const background = useBackgroundDownloads({
    settled,
    games: gamesDecision,
    onSettle: (id) => settle([id]),
  });
  const picked = usePickedDownloads();
  const downloads = useMemo(
    () => [...background.items, ...picked.items],
    [background.items, picked.items],
  );
  const retry = (id: string) => {
    if (!picked.retry(id)) background.retry(id);
  };
  const gamesValue = useMemo(
    () => ({ games, track: picked.track }),
    [games, picked.track],
  );

  // Until the planner reports, the app waits behind a blank frame. A plan that
  // can be made at once arrives in a layout effect, before anything paints.
  const waiting =
    rerun || (plan === null && PAGE_IDS.some((id) => !settled.includes(id)));
  const needGames = gamesDecision === null && !settled.includes("game");
  const showWizard = open && plan?.status === "open";

  const onPlan = useCallback(
    (decided: DecidedPlan, pickGames: SuggestedGame[]) => {
      setPlan(decided);
      setGames(pickGames);
      setRun((n) => n + 1);
      setOpen(decided.status === "open");
      settle(decided.settleNow);
      clear();
    },
    [settle, clear],
  );
  const onGames = useCallback(
    (decision: GamesDecision) => setGamesDecision((d) => d ?? decision),
    [],
  );

  return (
    <WizardDownloadsContext.Provider value={downloads}>
      <WizardProblemsContext.Provider value={background.problems}>
        <WizardGamesContext.Provider value={gamesValue}>
          {/* `contents` adds no box. Radix portals mount on body, so selects
          inside the wizard stay usable while this is inert. */}
          <div className="contents" inert={waiting || showWizard || undefined}>
            {children}
          </div>
          {(waiting || needGames) && (
            <WizardPlanner
              settled={settled}
              rerun={rerun}
              planning={waiting}
              onPlan={onPlan}
              onGames={onGames}
            />
          )}
          {waiting && (
            <div
              data-testid="onboarding-waiting"
              className="fixed inset-0 z-40 bg-background"
            />
          )}
          {showWizard && plan?.status === "open" && (
            <Wizard
              key={run}
              pages={plan.pages}
              onSettle={(id) => settle([id])}
              onClose={() => setOpen(false)}
              downloads={downloads}
              problems={background.problems}
              onCancelDownload={background.cancel}
              onRetryDownload={retry}
            />
          )}
        </WizardGamesContext.Provider>
      </WizardProblemsContext.Provider>
    </WizardDownloadsContext.Provider>
  );
}
