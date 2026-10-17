import { useCallback, useState } from "react";

import { mutedSourcesFrom, type ProblemSource } from "./problems";

const KEY = "coilbox.lego.mutedProblems";

/**
 * Which checks the person has muted in the problems list, remembered between
 * runs. A preference about how they work, so it is not saved in the unit.
 */
export function useMutedProblemSources(): [
  ReadonlySet<ProblemSource>,
  (source: ProblemSource, muted: boolean) => void,
] {
  const [muted, setMuted] = useState<ReadonlySet<ProblemSource>>(() => {
    try {
      return mutedSourcesFrom(localStorage.getItem(KEY));
    } catch {
      return new Set();
    }
  });

  const mute = useCallback((source: ProblemSource, on: boolean) => {
    setMuted((current) => {
      const next = new Set(current);
      if (on) next.add(source);
      else next.delete(source);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }, []);

  return [muted, mute];
}
