// @vitest-environment happy-dom
/**
 * A start position past the last coloured entry in `markerColors` has no
 * player, so it must not draw as if it did. It used to fall back to
 * `#ffffff`, which reads as near-invisible on a light map and, worse, still
 * looks like a claimed dot with no side to point to (issue #2867). It now
 * gets a distinct "unclaimed" treatment instead of a fabricated colour.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MinimapPreview } from "./MinimapPreview";

afterEach(cleanup);

describe("MinimapPreview", () => {
  it("colours a claimed start position from markerColors, and marks an unclaimed one distinctly instead of white", () => {
    render(
      <MinimapPreview
        url="coilbox://unitsyncthumb/map.png"
        width={10}
        height={10}
        startPositions={[
          { x: 10, z: 10 },
          { x: 20, z: 20 },
          { x: 30, z: 30 },
        ]}
        markerColors={["#d24f5a", "#a90ef6"]}
        alt="Test map"
      />,
    );

    const claimed = screen.getByTitle("Start position 1");
    const unclaimed = screen.getByTitle("Start position 3 (unclaimed)");

    expect(claimed.style.background).toBe("#d24f5a");
    expect(unclaimed.style.background).toBe("");
    expect(unclaimed.style.background).not.toBe("#ffffff");
    expect(unclaimed.className).toContain("border-dashed");
    expect(claimed.className).not.toContain("border-dashed");
  });

  it("marks every position unclaimed when markerColors is absent", () => {
    render(
      <MinimapPreview
        url="coilbox://unitsyncthumb/map.png"
        width={10}
        height={10}
        startPositions={[{ x: 10, z: 10 }]}
        alt="Test map"
      />,
    );

    const marker = screen.getByTitle("Start position 1 (unclaimed)");
    expect(marker.style.background).toBe("");
  });
});
