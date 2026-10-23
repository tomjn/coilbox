import { useSetting } from "@picoframe/frame";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SuggestedGame } from "@/content/branding";
import type {
  EnqueueInput,
  QueueItem,
} from "@/downloads/DownloadQueueProvider";
import { SETTLED_KEY, type SettleId } from "./ids";
import { pageRelevance } from "./relevance";
import { useOnboardingRerun } from "./rerun";
import { addSettled, planRun, type RunPlan } from "./settle";
import { useBackgroundDownloads } from "./useBackgroundDownloads";
import { usePickedDownloads } from "./usePickedDownloads";
import { useWizardContext } from "./useWizardContext";
import { Wizard } from "./Wizard";

const NO_DOWNLOADS: QueueItem[] = [];
const WizardDownloadsContext = createContext<QueueItem[]>(NO_DOWNLOADS);

/**
 * The downloads the wizard follows, for its pages to show: the background
 * engine and game, then any game the player started on the games page.
 */
export function useWizardDownloads(): QueueItem[] {
  return useContext(WizardDownloadsContext);
}

const NO_GAMES: SuggestedGame[] = [];
const WizardGamesContext = createContext<{
  games: SuggestedGame[];
  track(input: EnqueueInput): void;
}>({ games: NO_GAMES, track: () => {} });

/**
 * The games the games page offers: the `pick` decision's games as the plan
 * froze, and empty otherwise. Frozen with the plan, because a download started
 * from the page installs a game, which turns the live decision to `none` and
 * would empty the page under the player.
 */
export function useWizardGames(): SuggestedGame[] {
  return useContext(WizardGamesContext).games;
}

/** Adds a download the player started to the ones the wizard follows. */
export function useTrackWizardDownload(): (input: EnqueueInput) => void {
  return useContext(WizardGamesContext).track;
}

type DecidedPlan = Exclude<RunPlan, { status: "waiting" }>;

/**
 * Plans the onboarding run and draws the wizard over the app when it opens.
 *
 * The plan is worked out until every unsettled page has answered, then frozen
 * for the rest of the run, so signing in on one page cannot make another
 * vanish. Pages that answered "not relevant" are settled once, as the plan
 * freezes. A rerun request plans again with the settled list ignored.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [settled, setSettled] = useSetting<string[]>(SETTLED_KEY, []);
  const { rerun, clear } = useOnboardingRerun();
  const { ctx } = useWizardContext();
  const [plan, setPlan] = useState<DecidedPlan | null>(null);
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<SuggestedGame[]>(NO_GAMES);

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
    games: ctx.games,
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

  const planning = plan === null || rerun;
  const relevance = pageRelevance(ctx);
  const next = planning
    ? planRun({ settled, relevance, rerun })
    : { status: "waiting" as const };
  const decided = next.status === "waiting" ? null : next;
  // Some unsettled page has not answered yet. Never true on an install where
  // everything is settled, because `planRun` only waits on unsettled pages.
  const waiting = planning && next.status === "waiting";
  const pickGames = ctx.games?.kind === "pick" ? ctx.games.games : NO_GAMES;
  const showWizard = open && plan?.status === "open";

  // StrictMode runs an effect twice with one render's values, and the settled
  // list is written once per plan. A layout effect, so the wizard replaces the
  // blank frame before the app behind it can paint.
  const applied = useRef<DecidedPlan | null>(null);
  useLayoutEffect(() => {
    if (!decided || applied.current === decided) return;
    applied.current = decided;
    setPlan(decided);
    setGames(pickGames);
    setRun((n) => n + 1);
    setOpen(decided.status === "open");
    settle(decided.settleNow);
    if (rerun) clear();
  }, [decided, pickGames, rerun, clear, settle]);

  return (
    <WizardDownloadsContext.Provider value={downloads}>
      <WizardGamesContext.Provider value={gamesValue}>
        {/* `contents` adds no box. Radix portals mount on body, so selects
          inside the wizard stay usable while this is inert. */}
        <div className="contents" inert={waiting || showWizard || undefined}>
          {children}
        </div>
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
            newPagesRun={plan.newPagesRun}
            onSettle={(id) => settle([id])}
            onClose={() => setOpen(false)}
            downloads={downloads}
            onCancelDownload={background.cancel}
            onRetryDownload={retry}
          />
        )}
      </WizardGamesContext.Provider>
    </WizardDownloadsContext.Provider>
  );
}
