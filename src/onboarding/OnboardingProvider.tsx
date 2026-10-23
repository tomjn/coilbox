import { useSetting } from "@picoframe/frame";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { QueueItem } from "@/downloads/DownloadQueueProvider";
import { SETTLED_KEY, type SettleId } from "./ids";
import { pageRelevance } from "./relevance";
import { useOnboardingRerun } from "./rerun";
import { addSettled, planRun, type RunPlan } from "./settle";
import { useBackgroundDownloads } from "./useBackgroundDownloads";
import { useWizardContext } from "./useWizardContext";
import { Wizard } from "./Wizard";

const NO_DOWNLOADS: QueueItem[] = [];
const WizardDownloadsContext = createContext<QueueItem[]>(NO_DOWNLOADS);

/** The background downloads the wizard started, for its pages to show. */
export function useWizardDownloads(): QueueItem[] {
  return useContext(WizardDownloadsContext);
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
  const {
    items: downloads,
    cancel,
    retry,
  } = useBackgroundDownloads({
    settled,
    games: ctx.games,
    onSettle: (id) => settle([id]),
  });

  const planning = plan === null || rerun;
  const relevance = pageRelevance(ctx);
  const next = planning
    ? planRun({ settled, relevance, rerun })
    : { status: "waiting" as const };
  const decided = next.status === "waiting" ? null : next;
  // Some unsettled page has not answered yet. Never true on an install where
  // everything is settled, because `planRun` only waits on unsettled pages.
  const waiting = planning && next.status === "waiting";
  const showWizard = open && plan?.status === "open";

  // StrictMode runs an effect twice with one render's values, and the settled
  // list is written once per plan. A layout effect, so the wizard replaces the
  // blank frame before the app behind it can paint.
  const applied = useRef<DecidedPlan | null>(null);
  useLayoutEffect(() => {
    if (!decided || applied.current === decided) return;
    applied.current = decided;
    setPlan(decided);
    setRun((n) => n + 1);
    setOpen(decided.status === "open");
    settle(decided.settleNow);
    if (rerun) clear();
  }, [decided, rerun, clear, settle]);

  return (
    <WizardDownloadsContext.Provider value={downloads}>
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
          onCancelDownload={cancel}
          onRetryDownload={retry}
        />
      )}
    </WizardDownloadsContext.Provider>
  );
}
