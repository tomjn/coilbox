// @vitest-environment happy-dom
/**
 * A difficulty range problem never marks the field invalid (issue #2307).
 *
 * `checkDifficulty` in `validate.ts` only ever reports this as a warning: the
 * mission still plays, and what is lost is one placement or trigger at every
 * setting, not a launch. `aria-invalid` is the screen reader's "this value
 * was refused", which is not true of a range that compiles and plays fine, so
 * this pins that the message shows next to the field without that claim -
 * unlike a dangling reference, which is a real refusal and does claim it.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DifficultyRangeFields } from "./DifficultyRangeFields";

afterEach(cleanup);

describe("a difficulty range the validator has flagged", () => {
  it("shows the message without marking either bound aria-invalid", () => {
    render(
      <DifficultyRangeFields
        value={{ atLeast: "hard", atMost: "easy" }}
        onChange={() => {}}
        problem="it is only there from hard up and only up to easy, which is no difficulty at all, so it never appears"
      />,
    );

    expect(
      screen.getByText(
        "it is only there from hard up and only up to easy, which is no difficulty at all, so it never appears",
      ),
    ).toBeTruthy();
    for (const field of screen.getAllByRole("combobox")) {
      expect(field.hasAttribute("aria-invalid")).toBe(false);
    }
  });

  it("says nothing, and marks nothing invalid, with no problem", () => {
    render(<DifficultyRangeFields value={undefined} onChange={() => {}} />);

    for (const field of screen.getAllByRole("combobox")) {
      expect(field.hasAttribute("aria-invalid")).toBe(false);
    }
  });
});
