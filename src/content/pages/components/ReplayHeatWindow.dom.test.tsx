// @vitest-environment happy-dom
/**
 * The timeline dock's Heat window lane (#5309) on its own: dragging an end,
 * dragging the middle, the presets and the keys of each end, each read as the
 * window the map's layers receive. What the window does to the layers is in
 * `ReplayMapHeat.dom.test.tsx`, and where the lane sits in the dock is in
 * `ReplayMapCard.dom.test.tsx`.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoInfo } from "../../bindings";
import type { TimeWindow } from "../../replayTimeWindow";

vi.mock("../../useMatchStats", () => ({
  useMatchStats: () => ({ data: null, loading: false, error: null }),
}));

const { HeatWindowLabel, HeatWindowPlot, useHeatWindowLane } = await import(
  "./ReplayHeatWindow"
);
const { useReplayTimeWindow } = await import("../../useReplayTimeWindow");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");

/** A half hour match, in a lane 1,000 pixels wide: 1.8 seconds a pixel. */
const TOTAL = 1800;
const WIDTH = 1000;
const INFO = { durationSec: TOTAL } as DemoInfo;

/** What a layer of the map is handed, as the layers hook reads it. */
function Receiver() {
  const received = useReplayTimeWindow(TOTAL);
  return <output data-testid="received">{JSON.stringify(received)}</output>;
}

function Lane({ totalSec = TOTAL }: { totalSec?: number }) {
  const lane = useHeatWindowLane(INFO, null, totalSec);
  return lane ? (
    <>
      <HeatWindowLabel lane={lane} id="heat-label" />
      <HeatWindowPlot lane={lane} labelId="heat-label" />
    </>
  ) : null;
}

function show(totalSec = TOTAL) {
  return render(
    <SeriesEmphasisProvider>
      <Lane totalSec={totalSec} />
      <Receiver />
    </SeriesEmphasisProvider>,
  );
}

/** The window the layers receive. */
const received = (): TimeWindow | null =>
  JSON.parse(screen.getByTestId("received").textContent ?? "null");

const start = () => screen.getByTestId("heat-window-start");
const end = () => screen.getByTestId("heat-window-end");
const box = () => screen.getByTestId("heat-window-box");

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: WIDTH,
    bottom: 32,
    width: WIDTH,
    height: 32,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Presses, moves and lets go of a part of the box, one frame between moves. */
function drag(part: HTMLElement, from: number, to: number) {
  part.setPointerCapture = () => {};
  const at = (clientX: number) => ({ clientX, pointerId: 1 });
  fireEvent.pointerDown(part, at(from));
  fireEvent.pointerMove(part, at(to));
  fireEvent.pointerUp(part, at(to));
}

describe("the lane", () => {
  it("starts on the whole match, with an end at each side of the lane", () => {
    show();
    expect(received()).toBeNull();
    expect(start().getAttribute("aria-valuenow")).toBe("0");
    expect(end().getAttribute("aria-valuenow")).toBe("1800");
    expect(box().style.left).toBe("0%");
    expect(box().style.width).toBe("100%");
  });

  it("names each end, and the lane after its label", () => {
    show();
    expect(screen.getByRole("slider", { name: "Heat window start" })).toBe(
      start(),
    );
    expect(screen.getByRole("slider", { name: "Heat window end" })).toBe(end());
    expect(screen.getByRole("group", { name: "Heat window" })).toBeTruthy();
  });

  it("has nothing for a match with no length", () => {
    show(0);
    expect(screen.queryByTestId("heat-window-lane")).toBeNull();
  });
});

describe("dragging", () => {
  it("an end changes that end", () => {
    show();
    // From the right edge to half way across: 900 seconds back.
    drag(end(), 1000, 500);
    expect(received()).toEqual({ startSec: 0, endSec: 900 });
    drag(start(), 0, 250);
    expect(received()).toEqual({ startSec: 450, endSec: 900 });
  });

  it("the middle slides the whole box", () => {
    show();
    drag(end(), 1000, 500);
    expect(received()).toEqual({ startSec: 0, endSec: 900 });
    // A quarter of the lane to the right is 450 seconds.
    drag(box(), 300, 550);
    expect(received()).toEqual({ startSec: 450, endSec: 1350 });
  });

  it("stops the box at the edges of the match", () => {
    show();
    drag(end(), 1000, 500);
    drag(box(), 500, 5000);
    // The end is held at the match's end, so the layers reach their own.
    expect(received()).toEqual({ startSec: 900, endSec: 1800 });
    drag(box(), 500, -5000);
    expect(received()).toEqual({ startSec: 0, endSec: 900 });
  });

  it("does not let the ends cross", () => {
    show();
    drag(end(), 1000, 500);
    drag(start(), 0, 5000);
    expect(received()).toEqual({ startSec: 899, endSec: 900 });
  });

  it("returns to the whole match when the ends are dragged back to the edges", () => {
    show();
    drag(end(), 1000, 500);
    drag(end(), 500, 1000);
    expect(received()).toBeNull();
  });

  it("draws the box where the pointer is, and tells the layers at most once a frame", () => {
    vi.useFakeTimers();
    show();
    const part = end();
    part.setPointerCapture = () => {};
    const at = (clientX: number) => ({ clientX, pointerId: 1 });
    fireEvent.pointerDown(part, at(1000));
    fireEvent.pointerMove(part, at(900));
    fireEvent.pointerMove(part, at(800));
    fireEvent.pointerMove(part, at(700));
    // The box follows at once and the layers have not been told.
    expect(Number.parseFloat(box().style.width)).toBeCloseTo(70, 5);
    expect(received()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(received()).toEqual({ startSec: 0, endSec: 1260 });
    fireEvent.pointerMove(part, at(600));
    fireEvent.pointerUp(part, at(600));
    expect(received()).toEqual({ startSec: 0, endSec: 1080 });
  });

  it("ignores a drag that does not start on the lane's own pointer", () => {
    show();
    const part = end();
    part.setPointerCapture = () => {};
    fireEvent.pointerMove(part, { clientX: 500, pointerId: 1 });
    expect(received()).toBeNull();
  });
});

describe("the keyboard", () => {
  it("reaches each end with Tab, as two stops", () => {
    show();
    expect(start().getAttribute("tabindex")).toBe("0");
    expect(end().getAttribute("tabindex")).toBe("0");
    expect(box().getAttribute("tabindex")).toBeNull();
  });

  it("moves an end a second with an arrow and ten with Shift", () => {
    show();
    act(() => start().focus());
    fireEvent.keyDown(start(), { key: "ArrowRight" });
    expect(received()).toEqual({ startSec: 1, endSec: 1800 });
    fireEvent.keyDown(start(), { key: "ArrowRight", shiftKey: true });
    expect(received()).toEqual({ startSec: 11, endSec: 1800 });
    fireEvent.keyDown(end(), { key: "ArrowLeft" });
    expect(received()).toEqual({ startSec: 11, endSec: 1799 });
    expect(start().getAttribute("aria-valuenow")).toBe("11");
    expect(end().getAttribute("aria-valuenow")).toBe("1799");
  });

  it("moves an end to the least or the most with Home and End", () => {
    show();
    fireEvent.keyDown(start(), { key: "PageUp" });
    fireEvent.keyDown(end(), { key: "Home" });
    expect(received()).toEqual({ startSec: 10, endSec: 11 });
    fireEvent.keyDown(end(), { key: "End" });
    expect(received()).toEqual({ startSec: 10, endSec: 1800 });
  });

  it("marks a key it used as handled, so the dock's own keys leave it alone", () => {
    show();
    const used = fireEvent.keyDown(start(), { key: "ArrowRight" });
    // fireEvent answers false when the event's default was prevented.
    expect(used).toBe(false);
    const left = fireEvent.keyDown(start(), { key: "r" });
    expect(left).toBe(true);
    const held = fireEvent.keyDown(start(), {
      key: "ArrowRight",
      ctrlKey: true,
    });
    expect(held).toBe(true);
  });

  it("keeps the ends apart", () => {
    show();
    fireEvent.keyDown(end(), { key: "Home" });
    fireEvent.keyDown(start(), { key: "End" });
    expect(received()).toEqual({ startSec: 0, endSec: 1 });
    expect(start().getAttribute("aria-valuemax")).toBe("0");
  });
});

describe("the presets", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("button", { name: "Heat window" }));
  const press = (name: string) =>
    fireEvent.click(screen.getByRole("button", { name }));

  it("open from the lane's label and set the window the layers receive", () => {
    show();
    open();
    press("First 5 minutes");
    expect(received()).toEqual({ startSec: 0, endSec: 300 });
    expect(Number.parseFloat(box().style.width)).toBeCloseTo(
      (300 / 1800) * 100,
      5,
    );
    open();
    press("Last 5 minutes");
    expect(received()).toEqual({ startSec: 1500, endSec: 1800 });
    open();
    press("Whole match");
    expect(received()).toBeNull();
  });

  it("say which one is chosen", () => {
    show();
    open();
    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("Whole match")).toBe("true");
    press("First 5 minutes");
    open();
    expect(pressed("First 5 minutes")).toBe("true");
    expect(pressed("Last 5 minutes")).toBe("false");
    expect(pressed("Whole match")).toBe("false");
  });

  it("follow the box, so a window dragged to the last five minutes is that preset", () => {
    show();
    drag(start(), 0, (1500 / 1800) * WIDTH);
    open();
    expect(
      screen
        .getByRole("button", { name: "Last 5 minutes" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("are left out of a match of five minutes or less, where each is the whole match", () => {
    show(180);
    open();
    expect(screen.queryByRole("button", { name: /minutes/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Whole match" })).toBeTruthy();
  });
});

describe("the shading", () => {
  const lane = (activity: boolean) => ({
    totalSec: TOTAL,
    domainSec: TOTAL,
    window: null,
    activity: activity
      ? {
          label: "Damage dealt per minute",
          points: [
            { timeSec: 0, value: 1 },
            { timeSec: 900, value: 9 },
            { timeSec: 1800, value: 2 },
          ],
        }
      : null,
    presets: [],
    set: () => {},
    choose: () => {},
  });

  it("is drawn behind the box, and named on the lane", () => {
    render(<HeatWindowPlot lane={lane(true)} labelId="x" />);
    expect(screen.getByTestId("heat-window-activity")).toBeTruthy();
    expect(screen.getByTestId("heat-window-lane").getAttribute("title")).toBe(
      "Shaded: damage dealt per minute",
    );
  });

  it("is left out of a lane with no statistics, which still has its box", () => {
    render(<HeatWindowPlot lane={lane(false)} labelId="x" />);
    expect(screen.queryByTestId("heat-window-activity")).toBeNull();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });
});
