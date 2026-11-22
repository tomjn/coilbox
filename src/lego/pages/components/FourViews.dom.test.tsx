// @vitest-environment happy-dom

/**
 * The four view layout's controls (#5371): the button beside the compass, its
 * shortcut, and the named frame round each quadrant.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FourViewsButton, QuadrantFrames, ViewportOverlay } from "./FourViews";
import type { SceneState } from "./sceneState";
import { useModelShortcuts } from "./useModelShortcuts";

afterEach(cleanup);

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
    render(<QuadrantFrames active="front" onMaximise={vi.fn()} />);
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
    render(<QuadrantFrames active="perspective" onMaximise={onMaximise} />);
    const side = screen.getByRole("button", { name: "Side" });

    fireEvent.click(side);
    expect(onMaximise).not.toHaveBeenCalled();

    fireEvent.doubleClick(side);
    expect(onMaximise).toHaveBeenCalledWith("side");
  });
});

describe("the viewport overlay", () => {
  it("takes the perspective quadrant with four views on", () => {
    render(
      <ViewportOverlay fourViews>
        <p>chrome</p>
      </ViewportOverlay>,
    );
    const overlay = screen.getByText("chrome").parentElement as HTMLElement;
    expect(overlay.style.left).toBe("calc(50% + 0.75rem)");
    expect(overlay.style.top).toBe("calc(50% + 1rem + 0.75rem)");
    expect(overlay.style.right).toBe("0.75rem");
    expect(overlay.style.bottom).toBe("0.75rem");
    expect(overlay.dataset.fourViews).toBe("true");
  });

  it("keeps the whole view with one view", () => {
    render(
      <ViewportOverlay fourViews={false}>
        <p>chrome</p>
      </ViewportOverlay>,
    );
    const overlay = screen.getByText("chrome").parentElement as HTMLElement;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      expect(overlay.style[side]).toBe("0.75rem");
    }
    expect(overlay.dataset.fourViews).toBeUndefined();
  });
});
