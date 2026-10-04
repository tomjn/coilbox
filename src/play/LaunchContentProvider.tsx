import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ResolveContentGate } from "@/content/pages/components/ResolveContentDrawer";
import type { ContentRequirement } from "@/content/resolveContent";
import { useDownloadComplete } from "@/downloads/DownloadQueueProvider";
import { type PlayTarget, usePreferredTarget } from "./config";
import { type LaunchContentResult, launchTargets } from "./launchContent";

/** One launch asking whether it has what it needs. */
export interface LaunchContentRequest {
  /** What the launch needs, usually from `launchRequirements`. */
  requirements: ContentRequirement[];
  /**
   * The engine this launch runs on, for a page that picked one itself. Left
   * out, it is the preferred engine. Ignored when `requirements` names an
   * engine, because then the launch runs the installed engine that satisfies
   * that requirement and no other.
   */
  target?: PlayTarget | null;
  /** The drawer's heading, when there is something to download. */
  title?: string;
}

interface LaunchContentValue {
  /**
   * Check a launch's content, and open the download drawer when some of it is
   * missing. Resolves once everything is installed or the player gives up, so
   * a launch path awaits it and then starts the engine with the target it
   * hands back.
   *
   * Nothing is drawn when everything is already installed.
   */
  ensureContent: (
    request: LaunchContentRequest,
  ) => Promise<LaunchContentResult>;
}

const LaunchContentContext = createContext<LaunchContentValue | null>(null);

/** The shared pre-launch content check. Must be used within `PlayProvider`. */
export function useLaunchContent(): LaunchContentValue {
  const ctx = useContext(LaunchContentContext);
  if (!ctx) {
    throw new Error("useLaunchContent must be used within PlayProvider");
  }
  return ctx;
}

interface Pending {
  id: number;
  request: LaunchContentRequest;
  resolve: (result: LaunchContentResult) => void;
}

/**
 * The check itself, mounted for as long as one launch is waiting on it.
 *
 * It reads the installed engines for itself and again after an engine
 * download, because the target a caller captured before the check cannot name
 * an engine that did not exist yet.
 */
function LaunchContentGate({
  request,
  onSettle,
}: {
  request: LaunchContentRequest;
  onSettle: (result: LaunchContentResult) => void;
}) {
  const { target: preferred, targets, loading, refresh } = usePreferredTarget();
  const { scan, run } = launchTargets(
    request.requirements,
    targets,
    request.target ?? preferred,
  );
  const namesEngine = request.requirements.some((r) => r.kind === "engine");
  const [proceed, setProceed] = useState(false);
  // An engine arrived since the engines were last read.
  const staleRef = useRef(false);

  useDownloadComplete((done) => {
    if (done.kind === "engineRecoil" || done.kind === "engineSpring") {
      staleRef.current = true;
      void refresh();
    }
  });

  // No engine here and none asked for, so there is nothing to download that
  // would let this start. The drawer would list the game and never clear it,
  // because without an engine nothing can read what is installed.
  const noEngine = !loading && !scan && !namesEngine;
  useEffect(() => {
    if (noEngine) onSettle({ ready: false, reason: "no-engine" });
  }, [noEngine, onSettle]);

  // Settled from an effect and not from `onContinue`, so the engine it hands
  // back comes from the render that followed the last read of the engines.
  useEffect(() => {
    if (!proceed) return;
    onSettle(
      run
        ? { ready: true, target: run }
        : { ready: false, reason: "no-engine" },
    );
  }, [proceed, run, onSettle]);

  if (noEngine) return null;
  return (
    <ResolveContentGate
      quiet
      title={request.title ?? "Download what this game needs"}
      description="This cannot start until the content below is installed. Download it and the game starts when it is ready."
      requirements={request.requirements}
      target={scan ?? undefined}
      targetLoading={loading}
      onContinue={async () => {
        // Read the engines again whenever this render cannot name one to run.
        // The check can learn an engine is installed before this read does.
        if (staleRef.current || !run) {
          staleRef.current = false;
          await refresh();
        }
        setProceed(true);
      }}
      onCancel={() => onSettle({ ready: false, reason: "cancelled" })}
    />
  );
}

/**
 * Holds the one pre-launch content check every launch path shares (issue
 * #3364), and the drawer it opens.
 *
 * It sits beside the launch and not inside `PlayProvider.launch`, for three
 * reasons the launch code gives. A scenario or a workshop test starts a game
 * archive coilbox generated a moment earlier, so the game named in the start
 * script is not one anybody can download. `launchReplay` is handed a file and
 * knows neither the game nor the map. And every caller does work between
 * deciding to launch and calling `launch` (compiling a mission, listing the
 * replays already on disk) that should not run for a game that then waits on a
 * download. So the check comes first, in the caller, through this.
 */
export function LaunchContentProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const nextId = useRef(0);

  const ensureContent = useCallback(
    (request: LaunchContentRequest) =>
      new Promise<LaunchContentResult>((resolve) => {
        // One check at a time. A second launch asking while the first is still
        // waiting takes its place, and the first ends as cancelled.
        pendingRef.current?.resolve({ ready: false, reason: "cancelled" });
        const next = { id: nextId.current++, request, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  const settle = useCallback((id: number, result: LaunchContentResult) => {
    const current = pendingRef.current;
    if (!current || current.id !== id) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(result);
  }, []);

  const value = useMemo(() => ({ ensureContent }), [ensureContent]);
  const pendingId = pending?.id;
  const onSettle = useCallback(
    (result: LaunchContentResult) => {
      if (pendingId !== undefined) settle(pendingId, result);
    },
    [pendingId, settle],
  );

  return (
    <LaunchContentContext.Provider value={value}>
      {children}
      {pending && (
        <LaunchContentGate
          key={pending.id}
          request={pending.request}
          onSettle={onSettle}
        />
      )}
    </LaunchContentContext.Provider>
  );
}
