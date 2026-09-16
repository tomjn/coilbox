// @vitest-environment happy-dom
/**
 * Every start box gets its own fixed, distinct colour (issue #2797) rather
 * than borrowing one from a player, and an ally nobody has joined still gets
 * a real colour instead of falling back to the neutral grey the box used to
 * draw itself in when no player had picked that ally yet.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { allyPaletteColor } from "@/lib/allyPalette";
import { StartBoxOverlay } from "./StartBoxOverlay";

afterEach(cleanup);

describe("StartBoxOverlay", () => {
  it("draws each ally's box in that ally's fixed palette colour, never grey", () => {
    // Ally 3 has a box but (unlike the old player-derived colour) needs no
    // player to have joined it for a colour to exist.
    render(
      <StartBoxOverlay
        rects={{
          "0": { left: 0, top: 0, right: 50, bottom: 50 },
          "3": { left: 100, top: 100, right: 150, bottom: 150 },
        }}
      />,
    );

    const boxA = screen.getByText("A").closest("div");
    const boxD = screen.getByText("D").closest("div");
    expect(boxA?.style.borderColor).toBe(allyPaletteColor(0));
    expect(boxD?.style.borderColor).toBe(allyPaletteColor(3));
    expect(boxA?.style.borderColor).not.toBe("#e5e7eb");
    expect(boxD?.style.borderColor).not.toBe("#e5e7eb");
    // The two boxes get different colours from each other.
    expect(boxA?.style.borderColor).not.toBe(boxD?.style.borderColor);
  });

  it("keeps the ally letter on the box, so colour isn't the only cue", () => {
    render(
      <StartBoxOverlay
        rects={{ "1": { left: 0, top: 0, right: 50, bottom: 50 } }}
      />,
    );
    expect(screen.getByText("B")).toBeTruthy();
  });
});
