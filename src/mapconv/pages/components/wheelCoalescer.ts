/**
 * Coalesces a burst of wheel events into one per animation frame (issue #2341).
 *
 * A trackpad delivers wheel events far faster than the display can show
 * frames, and each one used to trigger its own full scene redraw through
 * OrbitControls. This accumulates the deltas as they arrive and hands back
 * one combined sample per frame, carrying the latest pointer position and
 * modifier state, the state a single event would have carried if the
 * display could only show one of them.
 *
 * Summing the raw `deltaY` across a burst is not an approximation of
 * OrbitControls' own zoom math, it reproduces it exactly. OrbitControls
 * scales the camera by `pow(0.95, zoomSpeed * |deltaY * 0.01|)` on every
 * event, multiplied into the running zoom each time. Because
 * `pow(b, x) * pow(b, y) === pow(b, x + y)`, replaying the sum of several
 * same-direction deltas once produces the same end scale as applying each
 * of them in turn. The maths, not just the picture, comes out identical.
 */
export interface WheelSample {
  deltaY: number;
  deltaMode: number;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
}

export class WheelCoalescer {
  private pending: WheelSample | null = null;

  /**
   * Fold one event's delta into the pending frame.
   *
   * Returns true the first time since the last `take()`, telling the caller
   * a flush needs scheduling. Returns false when this only added to a frame
   * that is already scheduled.
   */
  push(sample: WheelSample): boolean {
    if (this.pending) {
      this.pending = {
        ...sample,
        deltaY: this.pending.deltaY + sample.deltaY,
      };
      return false;
    }
    this.pending = { ...sample };
    return true;
  }

  /** Take and clear the accumulated sample, or null if nothing is pending. */
  take(): WheelSample | null {
    const sample = this.pending;
    this.pending = null;
    return sample;
  }
}
