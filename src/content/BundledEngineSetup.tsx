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
import { useWriteRoot } from "../downloads/config";
import { useDownloadQueue } from "../downloads/DownloadQueueProvider";
import { getProfileRoot } from "../profile/profile";
import { type BundledEngine, contentBundleInspect } from "./bindings";
import { bundledEngineInput, enginesToInstall } from "./bundle";

/**
 * Where the first run's engine copy has got to (issue #3668).
 *
 * `none` covers every install with nothing to copy: not portable, no bundle, a
 * bundle with no engine for this platform, or an engine the player already
 * has. The setup card treats it exactly as it did before bundles existed.
 */
export type BundledEngineState =
  | { status: "checking" }
  | { status: "none" }
  | { status: "copying"; engine: BundledEngine; id: string }
  | { status: "failed"; engine: BundledEngine; error: string }
  | { status: "cancelled"; engine: BundledEngine }
  | { status: "done"; engine: BundledEngine };

interface BundledEngineValue {
  state: BundledEngineState;
  /** Copy again after a failure or a cancel. Does nothing at any other time. */
  retry: () => void;
}

const NONE: BundledEngineValue = { state: { status: "none" }, retry: () => {} };

const BundledEngineContext = createContext<BundledEngineValue>(NONE);

/**
 * The first run's engine copy, as the setup card shows it. Outside
 * {@link BundledEngineSetup} it reads `none`, so a card rendered anywhere else
 * offers the download it always did.
 */
export function useBundledEngine(): BundledEngineValue {
  return useContext(BundledEngineContext);
}

/**
 * Copy the distribution's bundled engine into the download destination at app
 * launch, before anything asks the player to download one.
 *
 * Driven from here rather than from Rust at startup because the destination is
 * the frontend's download setting (`useWriteRoot`), and because the copy then
 * runs through the download queue like any engine install: the topbar shows
 * it, it can be cancelled, and `installEngine` rescans the content folders and
 * warms the new engine's unitsync cache after it. That rescan is what lets the
 * games and maps in the bundle show up with no further step.
 *
 * Mounted by the content plugin's startup provider, not by the setup card, so
 * the copy still runs for a distribution that turns the onboarding cards off.
 *
 * Runs once per launch. A copy that was interrupted left nothing behind that
 * looks like an engine, so the next launch finds the engine missing and copies
 * it again.
 */
export function BundledEngineSetup({ children }: { children: ReactNode }) {
  // Only a portable install can have a bundle, so a plain coilbox never even
  // asks.
  const portable = getProfileRoot() !== "";
  const writeRoot = useWriteRoot();
  const { enqueue, waitFor } = useDownloadQueue();
  const [state, setState] = useState<BundledEngineState>(
    portable ? { status: "checking" } : { status: "none" },
  );
  const started = useRef(false);

  const run = useCallback(
    async (writePath: string) => {
      setState({ status: "checking" });
      let engines: BundledEngine[];
      try {
        const { bundle } = await contentBundleInspect({ writePath });
        engines = enginesToInstall(bundle);
      } catch {
        // The bundle could not be read. The normal download path is still
        // there, and the health checklist is where the author finds out why.
        setState({ status: "none" });
        return;
      }
      for (const engine of engines) {
        const id = enqueue(bundledEngineInput(engine, writePath));
        setState({ status: "copying", engine, id });
        const settled = await waitFor(id);
        if (!settled || settled.status === "canceled") {
          setState({ status: "cancelled", engine });
          return;
        }
        if (settled.status === "error") {
          setState({
            status: "failed",
            engine,
            error: settled.error ?? "The copy stopped.",
          });
          return;
        }
      }
      const last = engines.at(-1);
      setState(last ? { status: "done", engine: last } : { status: "none" });
    },
    [enqueue, waitFor],
  );

  useEffect(() => {
    if (!portable || started.current || writeRoot.loading) return;
    started.current = true;
    if (!writeRoot.path) {
      // Nowhere to copy to. The setup card offers what it always has.
      setState({ status: "none" });
      return;
    }
    void run(writeRoot.path);
  }, [portable, writeRoot.loading, writeRoot.path, run]);

  const retry = useCallback(() => {
    if (state.status !== "failed" && state.status !== "cancelled") return;
    if (writeRoot.path) void run(writeRoot.path);
  }, [state.status, writeRoot.path, run]);

  const value = useMemo(() => ({ state, retry }), [state, retry]);
  return (
    <BundledEngineContext.Provider value={value}>
      {children}
    </BundledEngineContext.Provider>
  );
}
