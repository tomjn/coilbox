import type { Direction } from "../replayTrack";
import type { ReplayClock } from "./clock";

/**
 * The speeds the timeline offers, as multiples of the match's own speed. A
 * product choice: 1 is real time, and the larger ones cross a long match in
 * minutes.
 */
export const SPEEDS: readonly number[] = [0.5, 1, 2, 4, 8, 16, 32];
const REAL_TIME = 1;

export interface PlaybackState {
  playing: boolean;
  direction: Direction;
  speed: number;
}

/**
 * Moves a {@link ReplayClock} for the timeline (#3808): plays it forward or
 * backward, seeks it and steps it. It owns the animation frame loop, and the
 * loop runs only while the match is playing.
 */
export interface Playback {
  getSnapshot(): PlaybackState;
  /** For the controls. Called when playing, the direction or the speed change,
   *  and never as the time moves. */
  subscribe(listener: () => void): () => void;
  /** Plays in `direction`, or the way it last played. From the other end when
   *  the match is already at the end it would play into. */
  play(direction?: Direction): void;
  pause(): void;
  /** Plays the other way, starting if the match was paused. */
  reverse(): void;
  /**
   * Moves the clock to `frame`, held inside the match, before it returns.
   * Settling, which is what the page's URL follows, is on unless `settle` is
   * false. `pause` stops playing first, as a drag on the knob does.
   */
  seek(frame: number, options?: { settle?: boolean; pause?: boolean }): void;
  step(frames: number): void;
  /** Says a seek has ended. */
  settle(): void;
  setSpeed(speed: number): void;
  faster(): void;
  slower(): void;
  dispose(): void;
}

export function createPlayback({
  clock,
  header,
  env,
  onSettled,
}: {
  clock: ReplayClock;
  header: { firstFrame: number; lastFrame: number; framesPerSecond: number };
  env: {
    requestFrame(callback: (stamp: number) => void): number;
    cancelFrame(id: number): void;
  };
  /** Called when playing stops, at either end or on a pause, and when a seek
   *  ends. Not on every tick. */
  onSettled(frame: number): void;
}): Playback {
  const { firstFrame, lastFrame, framesPerSecond } = header;
  let state: PlaybackState = { playing: false, direction: 1, speed: REAL_TIME };
  let pending: number | null = null;
  // The stamp of the last animation frame, so the next one measures real time.
  let lastStamp: number | null = null;
  const listeners = new Set<() => void>();

  const hold = (frame: number) =>
    Math.min(lastFrame, Math.max(firstFrame, frame));
  const change = (next: Partial<PlaybackState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    if (pending !== null) env.cancelFrame(pending);
    pending = null;
  };
  const schedule = () => {
    if (pending === null) pending = env.requestFrame(tick);
  };

  const stop = (settle = true) => {
    if (!state.playing) return;
    cancel();
    lastStamp = null;
    change({ playing: false });
    if (settle) onSettled(clock.frame);
  };

  function tick(stamp: number) {
    pending = null;
    if (!state.playing) return;
    const { direction, speed } = state;
    let frame = clock.frame;
    if (lastStamp !== null) {
      // Real time between animation frames, so a dropped one costs nothing.
      const seconds = Math.max(0, stamp - lastStamp) / 1000;
      frame += direction * speed * framesPerSecond * seconds;
    }
    lastStamp = stamp;
    if (direction === 1 ? frame >= lastFrame : frame <= firstFrame) {
      clock.set(direction === 1 ? lastFrame : firstFrame, direction);
      stop();
      return;
    }
    clock.set(frame, direction);
    schedule();
  }

  // Frames do not run for a document nobody can see, and the clock would stand
  // still then. Stopping means the match is where it was when it comes back.
  const onVisibility = () => {
    if (document.hidden) stop();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const playback: Playback = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    play(direction = state.direction) {
      if (document.hidden) return;
      if (direction === 1 && clock.frame >= lastFrame) {
        clock.set(firstFrame, 1);
      } else if (direction === -1 && clock.frame <= firstFrame) {
        clock.set(lastFrame, -1);
      }
      if (!state.playing) lastStamp = null;
      change({ playing: true, direction });
      schedule();
    },
    pause: () => stop(),
    reverse() {
      playback.play(state.direction === 1 ? -1 : 1);
    },
    seek(frame, { settle = true, pause = false } = {}) {
      if (pause) stop(false);
      const target = hold(frame);
      const way =
        target === clock.frame
          ? clock.direction
          : target < clock.frame
            ? -1
            : 1;
      clock.set(target, way);
      if (settle) onSettled(clock.frame);
    },
    step(frames) {
      playback.seek(clock.frame + frames);
    },
    settle() {
      onSettled(clock.frame);
    },
    setSpeed(speed) {
      if (SPEEDS.includes(speed)) change({ speed });
    },
    faster() {
      const at = SPEEDS.indexOf(state.speed);
      playback.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, at + 1)]);
    },
    slower() {
      const at = SPEEDS.indexOf(state.speed);
      playback.setSpeed(SPEEDS[Math.max(0, at - 1)]);
    },
    dispose() {
      cancel();
      document.removeEventListener("visibilitychange", onVisibility);
      listeners.clear();
    },
  };
  return playback;
}
