/**
 * The base being watched go up, one building at a time (issue #1418).
 *
 * Held apart from `ScenarioMapScene.tsx` the same way `useMapSelection.ts` and
 * `useMapOverlays.ts` are (issue #2515's third boundary): this hook owns state
 * and an effect, and calls no `onChange`. Starting a playback, stepping it and
 * stopping it are all local UI state about what the map is showing, never a
 * write to the document, so nothing here needs to sit next to an `onChange`
 * call.
 */

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { BlueprintBuilding } from "@/blueprint/model";
import { placementKey } from "@/placement/placements";
import type { Scenario } from "../../model";

/** How long one building of a build order stands on screen before the next
 *  one arrives. Slow enough to read the base going up, brisk enough that a
 *  twenty-building opening is not a coffee break. */
const PLAYBACK_STEP_MS = 700;

type Playback = { base: string; step: number; playing: boolean } | null;

export interface BasePlayback {
  playing: { base: string; step: number; playing: boolean } | null;
  setPlayback: Dispatch<SetStateAction<Playback>>;
  /** How many buildings the watched base's order has, once it is standing. */
  total: number;
  /** The watched base's own buildings, in build order, for the bar that
   *  steps through them. */
  steps: BlueprintBuilding[];
  /** What is not standing yet, which is everything the playback has not
   *  reached. Only the drawing is held back: the document is untouched, so the
   *  footprints still show the whole plan the base is being built into. */
  undrawn: Set<string> | null;
}

export function useBasePlayback(scenario: Scenario): BasePlayback {
  const [playback, setPlayback] = useState<{
    base: string;
    step: number;
    playing: boolean;
  } | null>(null);
  const watched = playback
    ? scenario.bases.find((b) => b.id === playback.base)
    : undefined;
  const watchedLayout = watched
    ? scenario.blueprints.find((b) => b.id === watched.blueprint)
    : undefined;
  const steps = watchedLayout?.ordered ? watchedLayout.buildings : [];
  // A base that has been deleted, or a layout that is no longer a build
  // order, stops the playback rather than stranding it.
  const playing = playback && steps.length > 0 ? playback : null;

  const undrawn = useMemo(() => {
    if (!playing) return null;
    const out = new Set<string>();
    for (let at = playing.step; at < steps.length; at++) {
      out.add(placementKey("base", playing.base, at));
    }
    return out;
  }, [playing, steps.length]);

  // Playing it means one step at a time on its own until the base is up. It
  // stops there rather than looping, because the end of a build order is the
  // base, and a base that keeps vanishing and rebuilding itself is a thing to
  // watch rather than a thing to read.
  const total = steps.length;
  const advancing = playing?.playing === true;
  useEffect(() => {
    if (!advancing) return;
    const timer = setInterval(() => {
      setPlayback((at) => {
        if (!at) return at;
        return at.step >= total
          ? { ...at, playing: false }
          : { ...at, step: at.step + 1 };
      });
    }, PLAYBACK_STEP_MS);
    return () => clearInterval(timer);
  }, [advancing, total]);

  return { playing, setPlayback, total, steps, undrawn };
}
