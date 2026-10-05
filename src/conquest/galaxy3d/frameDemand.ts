/**
 * Drawing the strategic map only when something on it would change.
 *
 * A land map that sits still costs the GPU a full draw every frame for
 * nothing (issue #3653). So the view draws a frame when asked, and a frame
 * asks for the next one only while something is still moving. Every one-off
 * change asks for a single frame through `request`: a camera move, a hover, a
 * prop change, a picture or model that arrives. Every animation keeps the
 * frames coming through {@link needsAnotherFrame} while it runs.
 */

/** What is still moving after a frame was drawn. */
export interface FrameActivity {
  /**
   * A Galaxy or Theatre map. Its stars twinkle, its binaries orbit and its
   * lanes pulse all the time, so it never stops drawing.
   */
  alwaysMoving: boolean;
  /** The camera's warp in on a fresh map. */
  intro: boolean;
  /** The camera easing in on a location, or recentring after a rebuild. */
  focusEase: boolean;
  /** The heading easing back to north after a rotate. */
  headingEase: boolean;
  /** The orbit controls moved the camera this frame, so damping may still. */
  cameraMoved: boolean;
  /** A win burst is playing. */
  burst: boolean;
  /** The selected location has a marker or ring that pulses. */
  selectionPulse: boolean;
  /** Some location shows ambient combat flashes. */
  combatFlashes: boolean;
  /** Effects are on. The selection pulse and the flashes only run with them. */
  effects: boolean;
}

/** Whether the frame just drawn has to be followed by another. */
export function needsAnotherFrame(a: FrameActivity): boolean {
  if (a.alwaysMoving || a.intro || a.focusEase || a.headingEase) return true;
  if (a.cameraMoved || a.burst) return true;
  return a.effects && (a.selectionPulse || a.combatFlashes);
}

export interface FrameScheduler {
  /** Draw one frame soon. Several requests before it is drawn draw it once. */
  request: () => void;
  /** Drop a frame that was asked for and not yet drawn. */
  cancel: () => void;
}

/**
 * Run `frame` once per animation frame while it is asked for. `frame` draws
 * and answers whether it needs the next frame too. A request made while a
 * frame runs, such as the orbit controls' change event, also gets the next.
 */
export function createFrameScheduler(
  frame: () => boolean,
  schedule: (callback: () => void) => number = requestAnimationFrame,
  unschedule: (handle: number) => void = cancelAnimationFrame,
): FrameScheduler {
  let pending: number | undefined;
  const request = () => {
    if (pending === undefined) pending = schedule(run);
  };
  const run = () => {
    pending = undefined;
    if (frame()) request();
  };
  return {
    request,
    cancel: () => {
      if (pending !== undefined) unschedule(pending);
      pending = undefined;
    },
  };
}
