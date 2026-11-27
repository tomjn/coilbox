// @vitest-environment happy-dom
/**
 * What the time window means, for the map's help entry. The window is set on
 * the timeline dock's Heat window lane (`ReplayHeatWindow.dom.test.tsx`), and
 * what it does to the map's layers is in `ReplayMapHeat.dom.test.tsx`.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TimeWindowHelp } from "./ReplayTimeWindowNote";

afterEach(cleanup);

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
