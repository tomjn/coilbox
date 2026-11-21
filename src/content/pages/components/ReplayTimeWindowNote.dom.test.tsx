// @vitest-environment happy-dom
/**
 * The line under the map that says what the time window covers (#1153), on its
 * own. The window is set on the timeline dock's Heat window lane
 * (`ReplayHeatWindow.dom.test.tsx`), and what it does to the map's layers is in
 * `ReplayMapHeat.dom.test.tsx`.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReplayTimeWindowNote, TimeWindowHelp } from "./ReplayTimeWindowNote";

afterEach(cleanup);

function show(
  over: Partial<React.ComponentProps<typeof ReplayTimeWindowNote>> = {},
) {
  return render(
    <ReplayTimeWindowNote
      matchEndSec={1800}
      window={null}
      count={{ inside: 3605, total: 3605 }}
      {...over}
    />,
  );
}

describe("the whole match", () => {
  it("is what it says with no window, with the count of the layer", () => {
    show();
    expect(
      screen.getByText(
        /The whole match, 0:00 to 30:00\. 3,605 of 3,605 orders/,
      ),
    ).toBeTruthy();
  });

  it("has no controls of its own", () => {
    show();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says nothing for a match with no length", () => {
    show({ matchEndSec: 0 });
    expect(screen.queryByTestId("time-window")).toBeNull();
  });
});

describe("a window", () => {
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

  it("ends at the match's end when the window is held open to it (#5358)", () => {
    // The dock holds a window that reaches the match's end as Infinity.
    show({
      matchEndSec: 501.4,
      window: { startSec: 450, endSec: Number.POSITIVE_INFINITY },
      count: null,
    });
    expect(screen.getByText("Orders given from 7:30 to 8:21.")).toBeTruthy();
  });

  it("never gives an end later than the match's end", () => {
    // The layers' axis ran on to 508 s for an order given after the match.
    show({
      matchEndSec: 501.4,
      window: { startSec: 450, endSec: 508 },
      count: null,
    });
    expect(screen.getByText("Orders given from 7:30 to 8:21.")).toBeTruthy();
  });

  it("ends the whole match at the match's end", () => {
    show({ matchEndSec: 501.4, count: null });
    expect(screen.getByText("The whole match, 0:00 to 8:21.")).toBeTruthy();
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

  it("counts a second kind of point and events under their own names", () => {
    show({
      window: { startSec: 0, endSec: 300 },
      noun: "building orders",
      count: { inside: 2, total: 3 },
      also: { count: { inside: 5, total: 9 }, noun: "orders on the map" },
      events: [{ noun: "deaths", inside: 4, total: 10 }],
      subject: "both",
    });
    expect(
      screen.getByText(
        /Orders given and events from 0:00 to 5:00\. 2 of 3 building orders\. 5 of 9 orders on the map\. 4 of 10 deaths\./,
      ),
    ).toBeTruthy();
  });
});

describe("the help", () => {
  it("says what the window filters by, and what is shaded on the lane", () => {
    render(
      <TimeWindowHelp
        activity={{ label: "Some metric per minute", points: [] }}
        subject="orders"
      />,
    );
    expect(screen.getByText(/not when anything was built/i)).toBeTruthy();
    expect(
      screen.getByText(
        /Behind the box on the Heat window lane, some metric per minute across all teams/,
      ),
    ).toBeTruthy();
  });

  it("says so when there are no statistics to shade", () => {
    render(<TimeWindowHelp activity={null} subject="events" />);
    expect(screen.getByText(/when each event happened/i)).toBeTruthy();
    expect(screen.getByText(/no match statistics are drawn/i)).toBeTruthy();
  });
});
