/**
 * Drawing the strategic map at a lower resolution while its frames run long,
 * and at full resolution again once the camera stops (issue #3994).
 *
 * A frame runs long when it is drawn more than halfway from one display
 * interval to two after it was due, so it missed the display's refresh. The
 * display's interval is measured from bare animation frames while the map
 * sits still, never assumed. A machine whose frames keep up never sees a
 * long one, so its resolution never drops.
 */

/**
 * The lowest pixel ratio a moving map is drawn at. Chosen from pictures of a
 * 1920 by 1080 map in #3994: at half resolution the markers, roads, coasts
 * and province borders still read. Below it the roads step and the borders
 * break up.
 */
export const LOWEST_PIXEL_RATIO = 0.5;

/** What the view knows about a frame it is about to draw. */
export interface FrameSample {
  /** Milliseconds between when the frame was due and when it ran. */
  waited: number;
  /** The camera moved since the last frame drawn. */
  moving: boolean;
  /** The frame draws a tile of the ground's bake, which is not the camera. */
  baking: boolean;
  /** The display's own frame interval, once it has been measured. */
  displayInterval: number | undefined;
}

export interface AdaptiveResolution {
  /** The pixel ratio to draw this frame at, given the full one. */
  frame: (sample: FrameSample, full: number) => number;
  /** Drawing below full resolution, so a sharp frame is still to come. */
  reduced: () => boolean;
  /** Back to full resolution, as after a resize. */
  reset: () => void;
}

export function createAdaptiveResolution(
  lowest = LOWEST_PIXEL_RATIO,
): AdaptiveResolution {
  let ratio: number | undefined;
  let full = 1;
  // Long waits in a row since the ratio last changed.
  let longWaits: number[] = [];
  let previousBaked = false;
  // The frame after a change waits on the resize of the drawing buffer.
  let settling = false;

  const reset = () => {
    ratio = undefined;
    longWaits = [];
    settling = false;
  };

  return {
    frame(sample, fullRatio) {
      full = fullRatio;
      const afterBake = previousBaked;
      previousBaked = sample.baking;
      if (!sample.moving) {
        reset();
        return full;
      }
      const current = Math.min(ratio ?? full, full);
      const interval = sample.displayInterval;
      if (sample.baking || afterBake || settling || interval === undefined) {
        longWaits = [];
        settling = false;
        return current;
      }
      // Halfway between hitting the display's refresh and missing it once.
      if (sample.waited > interval * 1.5) longWaits.push(sample.waited);
      else longWaits = [];
      // One long wait can be a hiccup. Two in a row is the least that says
      // the frames themselves are slow.
      if (longWaits.length < 2) return current;
      // The pixels go with the square of the ratio. Counting the whole frame
      // as per pixel cost, the ratio whose frame would fit the display's
      // interval is this one scaled by the root of the time it runs over.
      // Part of the cost is not per pixel, so that is the smallest step that
      // could be enough, and a frame still long after it takes another.
      const wait = Math.min(...longWaits);
      const next = current * Math.sqrt(interval / wait);
      ratio = Math.max(Math.min(lowest, full), next);
      longWaits = [];
      settling = ratio !== current;
      return ratio;
    },
    reduced: () => ratio !== undefined && ratio < full,
    reset,
  };
}

export interface DisplayClock {
  /** Start a measurement, unless one is running. */
  measure: () => void;
  /** Drop a measurement under way. The last finished one stays. */
  cancel: () => void;
  /** The display's frame interval in milliseconds, once measured. */
  interval: () => number | undefined;
}

/**
 * Measure the display's frame interval from animation frames that draw
 * nothing, timed by the frame time each is passed. The first runs straight
 * after the frame that brought the map to rest and can be late, measured in
 * #3994 at under a millisecond before the next, so it only starts the clock.
 * One late frame after that shortens one interval and lengthens the next by
 * as much, so the measurement is the middle of three intervals. Each
 * measurement replaces the last, so moving the window to another display is
 * picked up the next time the map rests.
 */
export function createDisplayClock(
  schedule: (
    callback: (time: number) => void,
  ) => number = requestAnimationFrame,
  unschedule: (handle: number) => void = cancelAnimationFrame,
): DisplayClock {
  let measured: number | undefined;
  let handle: number | undefined;
  let ticks: number[] = [];
  const tick = (time: number) => {
    ticks.push(time);
    // The skipped first frame, then four for three intervals.
    if (ticks.length < 5) {
      handle = schedule(tick);
      return;
    }
    handle = undefined;
    const intervals = ticks
      .slice(2)
      .map((t, i) => t - ticks[i + 1])
      .sort((a, b) => a - b);
    measured = intervals[1];
  };
  return {
    measure() {
      if (handle !== undefined) return;
      ticks = [];
      handle = schedule(tick);
    },
    cancel() {
      if (handle !== undefined) unschedule(handle);
      handle = undefined;
    },
    interval: () => measured,
  };
}
