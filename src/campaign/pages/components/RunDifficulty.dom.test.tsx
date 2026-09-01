// @vitest-environment happy-dom
/**
 * The difficulty picker on a campaign mission's briefing (issue #2220).
 *
 * What matters is that a run nobody has chosen for reads as the middle of the
 * ladder, which is what the runtime plays when the launch says nothing, and that
 * the player is told the choice is the campaign's rather than this mission's.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunDifficulty } from "./RunDifficulty";

afterEach(cleanup);

describe("choosing a difficulty for a campaign run", () => {
  it("shows the middle of the ladder for a run nobody has chosen for", () => {
    render(<RunDifficulty value={undefined} onChange={vi.fn()} />);

    expect(
      screen.getByRole("radio", { name: "Normal" }).getAttribute("data-state"),
    ).toBe("on");
  });

  it("shows the level the run is already at", () => {
    render(<RunDifficulty value="hard" onChange={vi.fn()} />);

    expect(
      screen.getByRole("radio", { name: "Hard" }).getAttribute("data-state"),
    ).toBe("on");
  });

  it("reports the level that was picked", () => {
    const onChange = vi.fn();
    render(<RunDifficulty value="normal" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "Easy" }));

    expect(onChange).toHaveBeenCalledWith("easy");
  });

  // The level is the run's, and a picker sitting on one mission's briefing has
  // to say so or it reads as a per-mission dial.
  it("says the choice holds for the rest of the campaign", () => {
    render(<RunDifficulty value="normal" onChange={vi.fn()} />);

    screen.getByText(/rest of the campaign/i);
  });
});
