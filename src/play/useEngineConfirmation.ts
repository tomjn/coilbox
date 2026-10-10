import { useEffect, useMemo, useRef, useState } from "react";
import { contentVerifyEngine } from "@/content/bindings";
import { refreshContentState } from "@/content/contentState";
import type {
  ContentRequirement,
  EngineReading,
} from "@/content/resolveContent";
import type { PlayTarget } from "./config";
import {
  concludeEngine,
  type EngineConclusion,
  type Verification,
} from "./engineConfirmation";

/**
 * Settle which installed engine satisfies the engine a launch names, asking an
 * engine for its version only when `concludeEngine` says that is the way to find
 * out (issue #3405).
 *
 * This runs the engine binary, once per engine, and only from a launch's own
 * content check: nothing mounts it on page open. A launch that names no engine
 * version never asks anything. The answer is stored by the backend with the
 * engine, so the same engine is not asked again by the next launch or the next
 * battle room.
 *
 * `targets` is the installed engines as the caller read them. Returned
 * `targets` are the same engines with any version learned here filled in, so a
 * caller does not wait for its own read to catch up.
 */
export function useEngineConfirmation(
  requirements: readonly ContentRequirement[],
  targets: PlayTarget[],
  targetsLoading: boolean,
): {
  /** Null while the engines are still being read. */
  conclusion: EngineConclusion | null;
  /** An engine is being asked for its version. */
  confirming: boolean;
  targets: PlayTarget[];
  /** What the resolve drawer should read instead of folder names. Undefined for
   *  a launch that names no engine version. */
  reading: EngineReading | undefined;
} {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const asked = useRef(new Set<string>());

  const confirmed = useMemo(
    () =>
      targets.map((t) => {
        const reported = verifications.find(
          (v) => v.executable === t.executable,
        )?.reported;
        return !t.syncVersion && reported
          ? { ...t, syncVersion: reported, engineVersion: reported }
          : t;
      }),
    [targets, verifications],
  );

  const conclusion = useMemo(
    () =>
      targetsLoading
        ? null
        : concludeEngine(
            requirements,
            // The folder name is `engineVersion` until the engine has reported.
            targets.map((t) => ({
              executable: t.executable,
              folder: t.engineVersion,
              verified: t.syncVersion,
            })),
            verifications,
          ),
    [requirements, targets, targetsLoading, verifications],
  );

  const toAsk = conclusion?.kind === "verify" ? conclusion.executable : null;
  useEffect(() => {
    if (!toAsk || asked.current.has(toAsk)) return;
    asked.current.add(toAsk);
    (async () => {
      let answer: Verification;
      try {
        const { engine } = await contentVerifyEngine({ path: toAsk });
        // The verified version is now stored, so screens holding the state see it.
        refreshContentState().catch(() => {});
        answer = engine.syncVersion?.trim()
          ? { executable: toAsk, reported: engine.syncVersion.trim() }
          : { executable: toAsk, reported: null };
      } catch (err) {
        answer = {
          executable: toAsk,
          reported: null,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
      // No cancel on cleanup. The engine is marked as asked, so an answer
      // dropped here would never be fetched again.
      setVerifications((prev) => [...prev, answer]);
    })();
  }, [toAsk]);

  const named = requirements.some((r) => r.kind === "engine");
  const unconfirmed =
    conclusion?.kind === "unconfirmed" ? conclusion.reason : null;
  const reading = useMemo(
    () =>
      named
        ? {
            versions: confirmed.flatMap((t) =>
              t.syncVersion ? [t.syncVersion] : [],
            ),
            unconfirmed,
          }
        : undefined,
    [named, confirmed, unconfirmed],
  );

  return {
    conclusion,
    confirming: conclusion?.kind === "verify",
    targets: confirmed,
    reading,
  };
}
