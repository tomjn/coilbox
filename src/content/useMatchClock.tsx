import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSearchParams } from "react-router";
import { FRAMES_PER_SECOND } from "./chatClock";
import { createReplayClock, type ReplayClock } from "./replayMapView/clock";
import {
  createPlayback,
  type Playback,
  type PlaybackState,
} from "./replayMapView/playback";
import { toFrameParam, urlFrame } from "./replayMapView/timelineMarks";

/** The address's name for the time, in frames of the match. */
export const TIME_PARAM = "frame";

/** The frames the match clock runs over, and how many make a second. */
export interface MatchRange {
  firstFrame: number;
  lastFrame: number;
  framesPerSecond: number;
  /** Whether the range is a recorded track's, or the replay's duration. */
  source: "track" | "duration";
}

/** A frame value that changes only when the time comes to rest. */
interface SettledStore {
  get(): number;
  set(frame: number): void;
  subscribe(listener: () => void): () => void;
}

function createSettledStore(frame: number): SettledStore {
  const listeners = new Set<() => void>();
  let at = frame;
  return {
    get: () => at,
    set(next) {
      if (next === at) return;
      at = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The replay page's one match clock (#5305).
 *
 * `clock` is where the time is. Read it, and move it only through `playback`,
 * which holds it inside `range` and says when it settles. Settling is what the
 * address and {@link useSettledFrame} follow.
 */
export interface MatchClock {
  clock: ReplayClock;
  playback: Playback;
  range: MatchRange;
  /** The frame as {@link useSettledFrame} gives it. */
  settled: Pick<SettledStore, "get" | "subscribe">;
  /** Gives the clock a recorded track's range, until the returned stop. */
  adoptTrack(header: {
    firstFrame: number;
    lastFrame: number;
    framesPerSecond: number;
  }): () => void;
}

const MatchClockContext = createContext<MatchClock | null>(null);

/** A replay's range from its duration, for when no track has been opened. */
export function durationRange(durationSec: number): MatchRange {
  const seconds = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  return {
    firstFrame: 0,
    lastFrame: Math.round(seconds * FRAMES_PER_SECOND),
    framesPerSecond: FRAMES_PER_SECOND,
    source: "duration",
  };
}

const sameRange = (a: MatchRange, b: MatchRange) =>
  a.firstFrame === b.firstFrame &&
  a.lastFrame === b.lastFrame &&
  a.framesPerSecond === b.framesPerSecond &&
  a.source === b.source;

/**
 * Owns the match clock for everything inside it. The range comes from the
 * replay's duration until a recorded track is opened, then from the track's
 * header.
 *
 * The address's `?frame=` is read once, when the page opens, and written each
 * time the clock settles. When a track takes over the range, a clock that has
 * not been moved goes to that `?frame=` again, held inside the track, and one
 * that has been moved is held inside the track where it is.
 */
export function MatchClockProvider({
  durationSec,
  children,
}: {
  durationSec: number;
  children: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  // Read once, when the page opens. The address follows the clock after.
  const [openedParam] = useState(() => params.get(TIME_PARAM));
  const fallback = useMemo(() => durationRange(durationSec), [durationSec]);
  const [track, setTrack] = useState<MatchRange | null>(null);
  const range = track ?? fallback;

  const [clock] = useState(() =>
    createReplayClock(
      urlFrame(openedParam, {
        first: fallback.firstFrame,
        last: fallback.lastFrame,
      }) ?? fallback.firstFrame,
    ),
  );
  // Where the clock was last put for a range, to tell whether anybody has
  // moved it since.
  const placed = useRef(clock.frame);
  const [settled] = useState(() => createSettledStore(clock.frame));

  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;

  const rangeRef = useRef(range);
  // A new range puts the clock inside it before anything draws from it.
  useLayoutEffect(() => {
    const was = rangeRef.current;
    rangeRef.current = range;
    if (sameRange(was, range)) return;
    const bounds = { first: range.firstFrame, last: range.lastFrame };
    const next =
      clock.frame === placed.current
        ? (urlFrame(openedParam, bounds) ?? range.firstFrame)
        : Math.min(range.lastFrame, Math.max(range.firstFrame, clock.frame));
    clock.set(next);
    placed.current = next;
    settled.set(next);
  }, [range, clock, openedParam, settled]);

  // Stable, so a section that adopts in an effect does not adopt again each
  // time the range it set comes back.
  const adoptTrack = useCallback<MatchClock["adoptTrack"]>((header) => {
    const next: MatchRange = {
      firstFrame: header.firstFrame,
      lastFrame: header.lastFrame,
      framesPerSecond: header.framesPerSecond,
      source: "track",
    };
    setTrack((was) => (was && sameRange(was, next) ? was : next));
    return () => setTrack(null);
  }, []);

  const [playback, setPlayback] = useState<Playback | null>(null);
  const speedRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const made = createPlayback({
      clock,
      header: range,
      env: {
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (id) => cancelAnimationFrame(id),
      },
      onSettled: (frame) => {
        settled.set(frame);
        setParamsRef.current(
          (was) => {
            const next = new URLSearchParams(was);
            next.set(TIME_PARAM, toFrameParam(frame));
            return next;
          },
          { replace: true },
        );
      },
    });
    // A range taking over keeps the speed somebody chose.
    if (speedRef.current !== null) made.setSpeed(speedRef.current);
    const keep = made.subscribe(() => {
      speedRef.current = made.getSnapshot().speed;
    });
    setPlayback(made);
    return () => {
      keep();
      made.dispose();
    };
  }, [clock, range, settled]);

  const value = useMemo<MatchClock | null>(
    () =>
      playback
        ? {
            clock,
            playback,
            range,
            settled,
            adoptTrack,
          }
        : null,
    [clock, playback, range, settled, adoptTrack],
  );

  // Nothing inside renders until the playback exists, which is one commit.
  return value ? (
    <MatchClockContext.Provider value={value}>
      {children}
    </MatchClockContext.Provider>
  ) : null;
}

/**
 * The provider, for a section that may be shown without one above it. Inside
 * one it adds nothing, so the section shares the page's clock.
 */
export function EnsureMatchClock({
  durationSec,
  children,
}: {
  durationSec: number;
  children: ReactNode;
}) {
  const outer = useContext(MatchClockContext);
  return outer ? (
    children
  ) : (
    <MatchClockProvider durationSec={durationSec}>
      {children}
    </MatchClockProvider>
  );
}

/** The page's match clock. Throws outside a {@link MatchClockProvider}. */
export function useMatchClock(): MatchClock {
  const value = useContext(MatchClockContext);
  if (!value) throw new Error("useMatchClock needs a MatchClockProvider");
  return value;
}

/** The frame, on every frame of playback. For something that animates. */
export function useMatchFrame(): number {
  const { clock } = useMatchClock();
  return useSyncExternalStore(clock.subscribe, () => clock.frame);
}

/**
 * The frame, changing only when the time settles: a pause, the end of the
 * match, the end of a drag, a step, a jump to a mark, or a range taking over.
 * It stands still while the match plays. For a table or a list.
 */
export function useSettledFrame(): number {
  const { settled } = useMatchClock();
  return useSyncExternalStore(settled.subscribe, settled.get);
}

/**
 * Something worked out from the frame, which re-renders only when `select`
 * answers something different. For a table that follows the match as it plays
 * but changes less often than the frame does: select the second, or the sample
 * a time falls in, and the component renders when that changes.
 *
 * While the match plays this follows the clock. At any other time it follows
 * the settled frame, so a drag on the scrubber changes nothing until it ends.
 * `select` must answer a string, number, boolean or null, which is what is
 * compared.
 */
export function useMatchFrameValue<T extends string | number | boolean | null>(
  select: (frame: number) => T,
): T {
  const { clock, playback, settled } = useMatchClock();
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = [
        clock.subscribe(listener),
        playback.subscribe(listener),
        settled.subscribe(listener),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    [clock, playback, settled],
  );
  return useSyncExternalStore(subscribe, () =>
    select(playback.getSnapshot().playing ? clock.frame : settled.get()),
  );
}

/** Whether it is playing, which way, and at what speed. */
export function usePlaybackState(): PlaybackState {
  const { playback } = useMatchClock();
  return useSyncExternalStore(playback.subscribe, playback.getSnapshot);
}
