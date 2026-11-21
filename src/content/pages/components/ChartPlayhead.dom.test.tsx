// @vitest-environment happy-dom

/**
 * The line a statistics chart draws at the match clock's time, and the press
 * that moves the clock (#5307).
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LineChart, XAxis, YAxis } from "recharts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type MatchClock,
  MatchClockProvider,
  useMatchClock,
} from "../../useMatchClock";
import { CHART_PRESS_TARGET, ChartPlayhead } from "./ChartPlayhead";

afterEach(cleanup);

// The plot spans x 40 to 392 and y 8 to 200 in a chart this size, over a 100
// second axis. The match is 100 seconds long at 30 frames a second.
const X_AT = (sec: number) => 40 + (sec / 100) * 352;
const PLOT_Y = 100;

let clockNow: MatchClock;
function Grab() {
  clockNow = useMatchClock();
  return null;
}

function open() {
  const result = render(
    <MemoryRouter>
      <MatchClockProvider durationSec={100}>
        <Grab />
        <LineChart
          width={400}
          height={200}
          data={[
            { timeSec: 0, a: 1 },
            { timeSec: 100, a: 2 },
          ]}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <XAxis dataKey="timeSec" type="number" domain={[0, 100]} height={0} />
          <YAxis width={40} />
          <ChartPlayhead />
        </LineChart>
      </MatchClockProvider>
    </MemoryRouter>,
  );
  const svg = result.container.querySelector("svg") as SVGSVGElement;
  const line = () =>
    result.container.querySelector(
      '[data-testid="chart-playhead"]',
    ) as SVGLineElement;
  return { svg, line, ...result };
}

const press = (svg: Element, clientX: number, clientY = PLOT_Y) =>
  fireEvent.pointerDown(svg, {
    clientX,
    clientY,
    button: 0,
    isPrimary: true,
  });

describe("ChartPlayhead", () => {
  it("sits at the clock's time, and follows the clock when it moves elsewhere", () => {
    const { line } = open();
    expect(Number(line().getAttribute("x1"))).toBeCloseTo(X_AT(0), 0);
    act(() => clockNow.playback.seek(1500));
    expect(Number(line().getAttribute("x1"))).toBeCloseTo(X_AT(50), 0);
    expect(Number(line().getAttribute("x2"))).toBeCloseTo(X_AT(50), 0);
  });

  it("does not render again as the clock moves", () => {
    const { line } = open();
    const element = line();
    act(() => clockNow.playback.seek(900));
    expect(line()).toBe(element);
  });

  it("moves the clock to the time under a click on the plot", () => {
    const { svg } = open();
    press(svg, X_AT(25));
    expect(clockNow.clock.frame).toBe(750);
  });

  it("ignores a press on the axis margin, outside the plot", () => {
    const { svg } = open();
    press(svg, X_AT(25), 5);
    press(svg, 10);
    expect(clockNow.clock.frame).toBe(0);
  });

  it("leaves a press on a press target to that target", () => {
    const { svg } = open();
    const stand = document.createElementNS("http://www.w3.org/2000/svg", "g");
    stand.setAttribute("class", CHART_PRESS_TARGET);
    svg.append(stand);
    press(stand, X_AT(25));
    expect(clockNow.clock.frame).toBe(0);
  });

  it("scrubs along the plot while the pointer is held, and settles on release", () => {
    const { svg } = open();
    const settle = vi.spyOn(clockNow.playback, "settle");
    press(svg, X_AT(10));
    expect(clockNow.clock.frame).toBe(300);
    fireEvent.pointerMove(window, { clientX: X_AT(40), isPrimary: true });
    expect(clockNow.clock.frame).toBe(1200);
    fireEvent.pointerMove(window, { clientX: X_AT(60), isPrimary: true });
    expect(clockNow.clock.frame).toBe(1800);
    expect(settle).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    expect(settle).toHaveBeenCalledTimes(1);
    // Released, so the pointer no longer moves the clock.
    fireEvent.pointerMove(window, { clientX: X_AT(90), isPrimary: true });
    expect(clockNow.clock.frame).toBe(1800);
  });

  it("holds a drag past the end of the plot at the end of the match", () => {
    const { svg } = open();
    press(svg, X_AT(50));
    fireEvent.pointerMove(window, { clientX: 5000, isPrimary: true });
    expect(clockNow.clock.frame).toBe(3000);
    fireEvent.pointerUp(window);
  });
});
