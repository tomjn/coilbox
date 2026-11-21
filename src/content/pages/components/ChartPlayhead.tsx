import { useEffect, useRef } from "react";
import { usePlotArea, useXAxisInverseScale, useXAxisScale } from "recharts";
import {
  chartSecToFrame,
  DRAG_THRESHOLD_PX,
  frameToChartSec,
} from "../../chartPlayhead";
import { useMatchClock } from "../../useMatchClock";

/** Class for an invisible target that has a job of its own on a press. */
export const CHART_PRESS_TARGET = "chart-press-target";

/**
 * A line across a chart's plot at the match clock's time, and the way to move
 * that time from the plot (#5307). Put it inside a Recharts chart, with a number
 * x axis in seconds from the start of the match.
 *
 * The line is written to the DOM as the clock moves, so playback does not
 * render the chart or this component.
 *
 * A press on the plot moves the clock there. A press that then travels
 * {@link DRAG_THRESHOLD_PX} pauses a match that is playing and scrubs along the
 * plot until the pointer is released. A press on an element with the
 * {@link CHART_PRESS_TARGET} class is left to that element. The chart's own
 * hover readout is not touched, because nothing here stops an event.
 */
export function ChartPlayhead() {
  const { clock, playback, range } = useMatchClock();
  const area = usePlotArea();
  const scale = useXAxisScale();
  const inverse = useXAxisInverseScale();
  const anchor = useRef<SVGGElement>(null);
  const line = useRef<SVGLineElement>(null);

  const left = area?.x ?? 0;
  const right = left + (area?.width ?? 0);
  const place = (frame: number): number | null => {
    const at = scale?.(frameToChartSec(range, frame));
    return typeof at === "number" && Number.isFinite(at)
      ? Math.min(right, Math.max(left, at))
      : null;
  };
  // What the listeners below read, so they are added once per chart.
  const latest = useRef({ area, inverse, range, place });
  latest.current = { area, inverse, range, place };

  // biome-ignore lint/correctness/useExhaustiveDependencies: place and scale are read through latest
  useEffect(() => {
    const move = () => {
      const x = latest.current.place(clock.frame);
      if (x === null) return;
      line.current?.setAttribute("x1", String(x));
      line.current?.setAttribute("x2", String(x));
    };
    move();
    return clock.subscribe(move);
  }, [clock, area, scale, range]);

  useEffect(() => {
    const svg = anchor.current?.ownerSVGElement;
    if (!svg) return;
    const was = svg.style.touchAction;
    // A horizontal drag scrubs. A vertical one still scrolls the page.
    svg.style.touchAction = "pan-y";

    const frameAt = (event: PointerEvent): number | null => {
      const { area, inverse, range } = latest.current;
      if (!area || !inverse) return null;
      const box = svg.getBoundingClientRect();
      const x = event.clientX - box.left;
      const sec = Number(
        inverse(Math.min(area.x + area.width, Math.max(area.x, x))),
      );
      return Number.isFinite(sec) ? chartSecToFrame(range, sec) : null;
    };

    const press = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const { area } = latest.current;
      if (!area) return;
      const target = event.target;
      if (target instanceof Element && target.closest(`.${CHART_PRESS_TARGET}`))
        return;
      const box = svg.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      if (
        x < area.x ||
        x > area.x + area.width ||
        y < area.y ||
        y > area.y + area.height
      )
        return;
      const start = frameAt(event);
      if (start === null) return;
      // A click lands here. It keeps a playing match playing from there.
      playback.seek(start);

      const from = event.clientX;
      let dragging = false;
      const drag = (next: PointerEvent) => {
        if (!next.isPrimary) return;
        if (!dragging && Math.abs(next.clientX - from) < DRAG_THRESHOLD_PX)
          return;
        const frame = frameAt(next);
        if (frame === null) return;
        dragging = true;
        playback.seek(frame, { settle: false, pause: true });
      };
      const release = () => {
        window.removeEventListener("pointermove", drag);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
        if (dragging) playback.settle();
      };
      window.addEventListener("pointermove", drag);
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
    };

    svg.addEventListener("pointerdown", press);
    return () => {
      svg.removeEventListener("pointerdown", press);
      svg.style.touchAction = was;
    };
  }, [playback]);

  const x = place(clock.frame);
  return (
    <g ref={anchor} aria-hidden pointerEvents="none">
      {area && x !== null && (
        <line
          ref={line}
          data-testid="chart-playhead"
          x1={x}
          x2={x}
          y1={area.y}
          y2={area.y + area.height}
          strokeWidth={2}
          strokeLinecap="round"
          className="stroke-primary"
        />
      )}
    </g>
  );
}
