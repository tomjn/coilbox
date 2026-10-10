// @vitest-environment happy-dom
/**
 * The time window control (#1153) on its own: its thumbs, presets and words.
 * What the window does to the map's layers is in `ReplayMap.dom.test.tsx`.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TimeWindow } from "../../replayTimeWindow";
import {
  ReplayTimeWindowControl,
  TimeWindowHelp,
} from "./ReplayTimeWindowControl";

beforeAll(() => {
  // Radix sizes a thumb with a ResizeObserver, which happy-dom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

const ACTIVITY = {
  label: "Some metric per minute",
  points: [
    { timeSec: 0, value: 1 },
    { timeSec: 300, value: 9 },
    { timeSec: 600, value: 2 },
  ],
};

function show(
  over: Partial<React.ComponentProps<typeof ReplayTimeWindowControl>> = {},
) {
  const onChange = vi.fn<(w: TimeWindow | null) => void>();
  const view = render(
    <ReplayTimeWindowControl
      domainSec={1800}
      window={null}
      onChange={onChange}
      activity={ACTIVITY}
      count={{ inside: 3605, total: 3605 }}
      {...over}
    />,
  );
  return { onChange, ...view };
}

const thumbs = () => screen.getAllByRole("slider");

describe("the whole match", () => {
  it("is selected to begin with, with a thumb at each end", () => {
    show();
    expect(
      screen
        .getByRole("button", { name: "Whole match" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const [start, end] = thumbs();
    expect(start.getAttribute("aria-valuenow")).toBe("0");
    expect(end.getAttribute("aria-valuenow")).toBe("1800");
    expect(
      screen.getByText(
        /The whole match, 0:00 to 30:00\. 3,605 of 3,605 orders/,
      ),
    ).toBeTruthy();
  });

  it("labels each thumb for assistive technology", () => {
    show();
    const [start, end] = thumbs();
    expect(start.getAttribute("aria-label")).toBe("Minimum");
    expect(end.getAttribute("aria-label")).toBe("Maximum");
    expect(
      screen.getByRole("group", { name: "Match time window" }),
    ).toBeTruthy();
  });

  it("draws the series behind the range, on a timeline axis", () => {
    show();
    expect(screen.getByTestId("time-window-activity")).toBeTruthy();
    expect(screen.getByText("10:00")).toBeTruthy();
    expect(
      screen.getByText(/some metric per minute across all teams/i),
    ).toBeTruthy();
  });

  it("has a plain track for a replay with no statistics", () => {
    show({ activity: null });
    expect(screen.queryByTestId("time-window-activity")).toBeNull();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    expect(screen.queryByText(/no match statistics are drawn/i)).toBeNull();
  });

  it("keeps what the window means out of the control, and says it in the help", () => {
    show();
    expect(screen.queryByText(/not when anything was built/i)).toBeNull();
    cleanup();
    render(<TimeWindowHelp activity={null} subject="orders" />);
    expect(screen.getByText(/not when anything was built/i)).toBeTruthy();
    expect(screen.getByText(/no match statistics are drawn/i)).toBeTruthy();
  });

  it("draws nothing for a match with no length", () => {
    show({ domainSec: 0 });
    expect(screen.queryByTestId("time-window")).toBeNull();
  });
});

describe("the presets", () => {
  it("offer the first and last five minutes of a long match", () => {
    const { onChange } = show();
    fireEvent.click(screen.getByRole("button", { name: "First 5 minutes" }));
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 0, endSec: 300 });
    fireEvent.click(screen.getByRole("button", { name: "Last 5 minutes" }));
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 1500, endSec: 1800 });
    fireEvent.click(screen.getByRole("button", { name: "Whole match" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("show which one is chosen", () => {
    show({ window: { startSec: 0, endSec: 300 } });
    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("First 5 minutes")).toBe("true");
    expect(pressed("Last 5 minutes")).toBe("false");
    expect(pressed("Whole match")).toBe("false");
  });

  it("are hidden in a match of five minutes or less, where each is the whole match", () => {
    show({ domainSec: 180 });
    expect(screen.queryByRole("button", { name: /minutes/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Whole match" })).toBeTruthy();
  });

  it("both show in a nine minute match, and overlap", () => {
    show({ domainSec: 540 });
    expect(
      screen.getByRole("button", { name: "First 5 minutes" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Last 5 minutes" })).toBeTruthy();
  });
});

describe("the thumbs", () => {
  it("are reached by keyboard and move a second at a time", () => {
    const { onChange } = show();
    const [start] = thumbs();
    act(() => start.focus());
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 1, endSec: 1800 });
  });

  it("move by pages, and to either end with Home and End", () => {
    const { onChange } = show({ window: { startSec: 600, endSec: 900 } });
    const [start, end] = thumbs();
    act(() => end.focus());
    fireEvent.keyDown(end, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 600, endSec: 1800 });
    act(() => start.focus());
    fireEvent.keyDown(start, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 0, endSec: 900 });
    fireEvent.keyDown(start, { key: "PageUp" });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ endSec: 900 }),
    );
  });

  it("cannot cross", () => {
    const { onChange } = show({ window: { startSec: 100, endSec: 101 } });
    const [start] = thumbs();
    act(() => start.focus());
    fireEvent.keyDown(start, { key: "ArrowRight" });
    // Pushed up against the other thumb, so nothing new is reported.
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(
      last === undefined || (last?.startSec ?? 0) < (last?.endSec ?? 0),
    ).toBe(true);
  });

  it("report a drag at most once a frame, and again when the thumb is let go", () => {
    vi.useFakeTimers();
    try {
      const { onChange, container } = show();
      const root = container.querySelector<HTMLElement>('[data-slot="slider"]');
      if (!root) throw new Error("no slider");
      // 1000 pixels for 1800 seconds.
      root.getBoundingClientRect = () =>
        ({
          left: 0,
          right: 1000,
          width: 1000,
          top: 0,
          bottom: 10,
          height: 10,
        }) as DOMRect;
      root.setPointerCapture = () => {};
      root.hasPointerCapture = () => true;
      const at = (clientX: number) => ({ clientX, pointerId: 1 });
      fireEvent.pointerDown(root, at(500));
      fireEvent.pointerMove(root, at(520));
      fireEvent.pointerMove(root, at(540));
      fireEvent.pointerMove(root, at(560));
      // Nothing is reported until a frame has passed.
      expect(onChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      fireEvent.pointerMove(root, at(580));
      fireEvent.pointerUp(root, at(580));
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("what the window says", () => {
  it("gives its start and end as match times, and the count inside", () => {
    show({
      window: { startSec: 600, endSec: 900 },
      count: { inside: 12, total: 3605 },
    });
    expect(
      screen.getByText(
        /Orders given from 10:00 to 15:00\. 12 of 3,605 orders\./,
      ),
    ).toBeTruthy();
  });

  it("says none, and not that the layer is broken, when the window is empty", () => {
    show({
      window: { startSec: 600, endSec: 900 },
      count: { inside: 0, total: 3605 },
    });
    expect(screen.getByText(/0 of 3,605 orders\./)).toBeTruthy();
  });

  it("says nothing of a count before the orders are read", () => {
    show({ count: null });
    expect(screen.queryByText(/of 3,605 orders/)).toBeNull();
  });
});
