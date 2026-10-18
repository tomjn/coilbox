/**
 * A small frame rate label in the bottom right corner of every 3D view
 * (issue #4071), for the General settings toggle.
 *
 * It is the rate the view draws at while it is drawing: frames drawn over the
 * display frames they took. Most views only draw when something changes, and
 * counting draws a second would read 7fps for a view that needed 7 frames and
 * drew each one on time. While nothing draws the label keeps its last number.
 * A frame counts once however many `renderer.render` calls it holds, because
 * the part pickers draw each tile as its own call.
 *
 * The views come from the registry in `./renderStats`, so nothing in a view
 * has to know the label exists. A host marked `data-frame-rate="off"` gets no
 * label, for a preview too small to give a corner to it.
 */

import { type Registered, registeredCanvases } from "./renderStats";

/** How often each label's number is replaced. */
const PERIOD_MS = 1000;

const LABEL_STYLE =
  "position:absolute;right:4px;bottom:4px;z-index:10;pointer-events:none;" +
  "padding:0 4px;border-radius:3px;background:rgba(0,0,0,0.6);color:#fff;" +
  "font:10px/1.4 ui-monospace,monospace;font-variant-numeric:tabular-nums;";

interface Tracked {
  /** `renderer.info.render.frame` when it was last looked at. */
  frame: number;
  /** Display frames in this period in which the view drew. */
  drawn: number;
  /** How long those frames took, each from the display frame before it. */
  drawingMs: number;
  since: number;
  label: HTMLElement | null;
  /** The host's inline `position` before the label made it relative. */
  position: string | null;
}

/** Put the label in the host, making it the label's containing block. */
function attachLabel(host: HTMLElement, one: Tracked): HTMLElement {
  if (getComputedStyle(host).position === "static") {
    one.position = host.style.position;
    host.style.position = "relative";
  }
  const label = document.createElement("div");
  label.style.cssText = LABEL_STYLE;
  label.setAttribute("aria-hidden", "true");
  host.appendChild(label);
  return label;
}

function detachLabel(host: HTMLElement, one: Tracked): void {
  one.label?.remove();
  if (one.position !== null) host.style.position = one.position;
}

/**
 * Show a frame rate label on every 3D view until the returned function is
 * called. Views that open later get one too.
 */
export function showFrameRates(): () => void {
  const tracked = new Map<Registered, Tracked>();
  let handle = 0;
  let last: number | null = null;

  const tick = (now: number) => {
    const interval = last === null ? 0 : now - last;
    last = now;
    const live = registeredCanvases();
    for (const [canvas, one] of tracked) {
      if (live.has(canvas)) continue;
      detachLabel(canvas.host, one);
      tracked.delete(canvas);
    }
    for (const canvas of live) {
      if (canvas.host.dataset.frameRate === "off") continue;
      const frame = canvas.renderer.info.render.frame;
      const one = tracked.get(canvas);
      if (!one) {
        tracked.set(canvas, {
          frame,
          drawn: 0,
          drawingMs: 0,
          since: now,
          label: null,
          position: null,
        });
        continue;
      }
      if (frame !== one.frame) {
        one.drawn++;
        one.drawingMs += interval;
      }
      one.frame = frame;
      if (now - one.since < PERIOD_MS) continue;
      if (one.drawingMs > 0) {
        one.label ??= attachLabel(canvas.host, one);
        one.label.textContent = `${Math.round((one.drawn * 1000) / one.drawingMs)}fps`;
      }
      one.drawn = 0;
      one.drawingMs = 0;
      one.since = now;
    }
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(handle);
    for (const [canvas, one] of tracked) detachLabel(canvas.host, one);
    tracked.clear();
  };
}
