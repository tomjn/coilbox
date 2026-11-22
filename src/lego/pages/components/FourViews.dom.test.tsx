// @vitest-environment happy-dom

/**
 * The four view layout's controls (#5371): the button beside the compass, its
 * shortcut, and the named frame round each quadrant.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChromeBands, FourViewsButton, QuadrantFrames } from "./FourViews";
import type { SceneState } from "./sceneState";
import { useModelShortcuts } from "./useModelShortcuts";

afterEach(cleanup);

const BANDS = { top: 60, bottom: 64, left: 56 };

describe("the four views button", () => {
  it("names its shortcut and says whether four views are showing", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <FourViewsButton on={false} onToggle={onToggle} />,
    );
    const button = screen.getByRole("button", { name: "Four views (4)" });
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<FourViewsButton on onToggle={onToggle} />);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});

/** Only the shortcut hook, with no scene behind it. */
function Shortcuts({ toggleFourViews }: { toggleFourViews: () => void }) {
  const sceneRef = useRef<SceneState | null>(null);
  const selectedIdsRef = useRef<string[]>([]);
  useModelShortcuts(sceneRef, {
    selectedIdsRef,
    setSnapped: vi.fn(),
    setSnappedTo: vi.fn(),
    setSteppedBy: vi.fn(),
    setSlidBy: vi.fn(),
    setMode: vi.fn(),
    setShortcutsOpen: vi.fn(),
    setDrawMode: vi.fn(),
    toggleSkeleton: vi.fn(),
    snapEnabled: true,
    toggleSnapping: vi.fn(),
    toggleFourViews,
  });
  return null;
}

describe("the four views shortcut", () => {
  it("switches the layout on 4, and not with Cmd or Ctrl held", () => {
    const toggle = vi.fn();
    render(<Shortcuts toggleFourViews={toggle} />);

    fireEvent.keyDown(window, { key: "4" });
    expect(toggle).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "4", metaKey: true });
    fireEvent.keyDown(window, { key: "4", ctrlKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe("the quadrant frames", () => {
  it("name each quadrant and mark the one that has the controls", () => {
    render(
      <QuadrantFrames active="front" bands={BANDS} onMaximise={vi.fn()} />,
    );
    for (const name of ["Top", "Front", "Side", "Perspective"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    const front = screen.getByRole("button", { name: "Front" }).parentElement;
    expect(front?.dataset.active).toBe("true");
    const top = screen.getByRole("button", { name: "Top" }).parentElement;
    expect(top?.dataset.active).toBeUndefined();
  });

  it("fills the view with a quadrant whose name is double clicked, and not on a single click", () => {
    const onMaximise = vi.fn();
    render(
      <QuadrantFrames
        active="perspective"
        bands={BANDS}
        onMaximise={onMaximise}
      />,
    );
    const side = screen.getByRole("button", { name: "Side" });

    fireEvent.click(side);
    expect(onMaximise).not.toHaveBeenCalled();

    fireEvent.doubleClick(side);
    expect(onMaximise).toHaveBeenCalledWith("side");
  });
});

describe("the chrome's bands (#5410)", () => {
  it("lay the quadrants out in the room the bands leave, and take the clicks on them", () => {
    const { container } = render(
      <QuadrantFrames
        active="perspective"
        bands={BANDS}
        onMaximise={vi.fn()}
      />,
    );
    const top = screen.getByRole("button", { name: "Top" }).parentElement;
    const grid = top?.parentElement as HTMLElement;
    expect(grid.style.top).toBe("60px");
    expect(grid.style.bottom).toBe("64px");
    expect(grid.style.left).toBe("56px");

    const band = (id: string) =>
      container.querySelector(`[data-band="${id}"]`) as HTMLElement;
    expect(band("top").style.height).toBe("60px");
    expect(band("bottom").style.height).toBe("64px");
    expect(band("left").style.width).toBe("56px");
    // Solid, so a click beside a button lands on the band, not on a view.
    for (const id of ["top", "bottom", "left"]) {
      expect(band(id).className).not.toContain("pointer-events-none");
      expect(band(id).className).toContain("bg-background");
    }
  });
});

describe("the chrome's bands in one view (#5414)", () => {
  it("are the same solid bands, with no quadrants in them", () => {
    const { container } = render(<ChromeBands bands={BANDS} />);
    const band = (id: string) =>
      container.querySelector(`[data-band="${id}"]`) as HTMLElement;
    expect(band("top").style.height).toBe("60px");
    expect(band("bottom").style.height).toBe("64px");
    expect(band("left").style.width).toBe("56px");
    expect(container.querySelector("[data-quadrant]")).toBeNull();
  });
});
