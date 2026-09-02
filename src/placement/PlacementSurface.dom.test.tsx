// @vitest-environment happy-dom
/**
 * The working area as something a keyboard can reach (issue #2269).
 *
 * The scene inside it needs a GPU, so it is stood in for here. What is left is
 * the part that decides whether the map can be driven at all: it is in the tab
 * order, it says what it is when you land on it, it hands its key presses on,
 * and it has somewhere to speak from.
 *
 * These are the things that break silently. A `tabIndex` dropped by a tidy-up,
 * or a live region that stops being a live region, leaves an interface that
 * still looks right and answers nobody.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlacementSurface, type SurfaceKeyboard } from "./PlacementSurface";

vi.mock("./GridScene", () => ({
  GridScene: () => <div data-testid="scene" />,
}));
vi.mock("@/mapconv/pages/components/MapPreview3D", () => ({
  MapPreview3D: () => <div data-testid="scene" />,
}));

afterEach(cleanup);

function surface(keyboard?: Partial<SurfaceKeyboard>) {
  const onKeyDown = vi.fn();
  const onFocus = vi.fn();
  render(
    <PlacementSurface
      ground={{ kind: "grid", extent: 1024 }}
      onScene={() => {}}
      keyboard={{
        label: "Scenario map",
        help: "Arrow keys move what is selected.",
        said: { text: "", token: 0 },
        cursor: "x 100, z 200",
        onKeyDown,
        onFocus,
        ...keyboard,
      }}
    />,
  );
  return { onKeyDown, onFocus };
}

const area = () => screen.getByRole("application", { name: "Scenario map" });

describe("reaching the map with the keyboard", () => {
  it("is in the tab order", () => {
    surface();

    expect(area().getAttribute("tabindex")).toBe("0");
  });

  it("takes the focus and says so", () => {
    const { onFocus } = surface();
    area().focus();

    expect(document.activeElement).toBe(area());
    expect(onFocus).toHaveBeenCalled();
  });

  it("describes what the keys do, for whoever has just landed on it", () => {
    surface();
    const help = area().getAttribute("aria-describedby");

    expect(help).toBeTruthy();
    expect(document.getElementById(help ?? "")?.textContent).toBe(
      "Arrow keys move what is selected.",
    );
  });

  it("hands its key presses on", () => {
    const { onKeyDown } = surface();
    fireEvent.keyDown(area(), { key: "ArrowUp" });

    expect(onKeyDown).toHaveBeenCalled();
  });

  // Three's orbit controls call preventDefault on the press over the canvas, so
  // clicking the map would otherwise leave the focus wherever it was and none of
  // the keys would answer.
  it("takes the focus when the map is clicked as well", () => {
    surface();
    fireEvent.pointerDown(area());

    expect(document.activeElement).toBe(area());
  });
});

describe("what it says", () => {
  it("has a polite live region for the keys to speak from", () => {
    surface({
      said: { text: "Moved 16 east, now at x 116, z 200.", token: 1 },
    });
    const spoken = screen.getByText("Moved 16 east, now at x 116, z 200.");

    expect(spoken.closest("[aria-live]")?.getAttribute("aria-live")).toBe(
      "polite",
    );
  });
});

describe("the marker at the point the keys act on", () => {
  it("is not drawn until the map has the focus", () => {
    surface();

    expect(screen.queryByText("x 100, z 200")).toBeNull();
  });

  it("is drawn once it has", () => {
    surface();
    fireEvent.focus(area());

    expect(screen.getByText("x 100, z 200")).toBeTruthy();
  });

  // A pointer over the map has the preview under it saying where a click would
  // land, and two cursors saying two different things is worse than one.
  it("stands down for a pointer, and comes back on the next key", () => {
    surface();
    fireEvent.focus(area());
    fireEvent.pointerMove(area());

    expect(screen.queryByText("x 100, z 200")).toBeNull();

    fireEvent.keyDown(area(), { key: "ArrowUp" });

    expect(screen.getByText("x 100, z 200")).toBeTruthy();
  });
});

describe("a surface with no keyboard interface", () => {
  it("is left exactly as it was", () => {
    render(
      <PlacementSurface
        ground={{ kind: "grid", extent: 1024 }}
        onScene={() => {}}
      />,
    );

    expect(screen.queryByRole("application")).toBeNull();
  });
});
