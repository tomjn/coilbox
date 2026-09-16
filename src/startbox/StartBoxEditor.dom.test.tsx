// @vitest-environment happy-dom
/**
 * The interactive counterpart to StartBoxOverlay.dom.test.tsx: the editor
 * draws each ally's box in that ally's fixed palette colour too (issue
 * #2797), with no dependency on a roster to borrow one from.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allyPaletteColor } from "@/lib/allyPalette";
import { StartBoxEditor } from "./StartBoxEditor";

afterEach(cleanup);

describe("StartBoxEditor", () => {
  it("labels each box with its ally's fixed palette colour, never grey", () => {
    render(
      <StartBoxEditor
        rects={{
          "0": { left: 0, top: 0, right: 50, bottom: 50 },
          "2": { left: 100, top: 100, right: 150, bottom: 150 },
        }}
        activeAlly={0}
        onCommit={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    const labelA = screen.getByText("A");
    const labelC = screen.getByText("C");
    expect(labelA.style.background).toBe(allyPaletteColor(0));
    expect(labelC.style.background).toBe(allyPaletteColor(2));
    expect(labelA.style.background).not.toBe("#e5e7eb");
    expect(labelC.style.background).not.toBe("#e5e7eb");
    expect(labelA.style.background).not.toBe(labelC.style.background);
  });
});
