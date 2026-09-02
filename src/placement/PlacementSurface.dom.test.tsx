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

import {
  memoryStorage,
  PersistentStoreProvider,
  type SettingsStorage,
} from "@picoframe/frame";
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

// PlacementSurface remembers its own height through the frame's settings
// store (issue #2320), which throws if it is rendered outside a
// PersistentStoreProvider. A storage the caller can hand back in lets the
// persistence tests below render twice against the same backing store, the
// way two launches of the app would share one settings file.
function surface(
  keyboard?: Partial<SurfaceKeyboard>,
  storage: SettingsStorage = memoryStorage(),
) {
  const onKeyDown = vi.fn();
  const onFocus = vi.fn();
  render(
    <PersistentStoreProvider storage={storage}>
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
      />
    </PersistentStoreProvider>,
  );
  return { onKeyDown, onFocus, storage };
}

const area = () => screen.getByRole("application", { name: "Scenario map" });
const handle = () =>
  screen.getByRole("separator", { name: "Resize the working area" });

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
      <PersistentStoreProvider storage={memoryStorage()}>
        <PlacementSurface
          ground={{ kind: "grid", extent: 1024 }}
          onScene={() => {}}
        />
      </PersistentStoreProvider>,
    );

    expect(screen.queryByRole("application")).toBeNull();
  });
});

/**
 * The height handle (issue #2320).
 *
 * happy-dom does no layout, so nothing here can see the card grow or shrink in
 * pixels. What it can pin is the part that is logic rather than layout: the
 * separator answers the keyboard within bounds, and what it lands on survives
 * a remount, which is what standing the app back up after a restart does.
 */
describe("the height handle", () => {
  it("is a horizontal separator with the current height and its bounds", () => {
    surface();

    const el = handle();
    expect(el.getAttribute("aria-orientation")).toBe("horizontal");
    expect(el.getAttribute("aria-valuenow")).toBe("480");
    expect(el.getAttribute("aria-valuemin")).toBe("240");
    expect(el.getAttribute("aria-valuemax")).toBe("960");
  });

  it("is in the tab order on its own stop", () => {
    surface();

    expect(handle().getAttribute("tabindex")).toBe("0");
  });

  it("grows on ArrowDown and shrinks on ArrowUp, in steps", () => {
    surface();

    fireEvent.keyDown(handle(), { key: "ArrowDown" });
    expect(handle().getAttribute("aria-valuenow")).toBe("512");

    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    expect(handle().getAttribute("aria-valuenow")).toBe("448");
  });

  it("stops at the minimum rather than going below it", () => {
    surface();

    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(handle(), { key: "ArrowUp" });
    }

    expect(handle().getAttribute("aria-valuenow")).toBe("240");
  });

  it("stops at the maximum rather than going above it", () => {
    surface();

    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(handle(), { key: "ArrowDown" });
    }

    expect(handle().getAttribute("aria-valuenow")).toBe("960");
  });

  it("leaves other keys, on the map or elsewhere, alone", () => {
    const { onKeyDown } = surface();
    fireEvent.keyDown(handle(), { key: "Enter" });

    expect(handle().getAttribute("aria-valuenow")).toBe("480");
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("does not swallow the map's own arrow keys", () => {
    const { onKeyDown } = surface();
    fireEvent.keyDown(area(), { key: "ArrowDown" });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(handle().getAttribute("aria-valuenow")).toBe("480");
  });

  it("remembers a height set by the keyboard across a remount", () => {
    const storage = memoryStorage();
    surface(undefined, storage);
    fireEvent.keyDown(handle(), { key: "ArrowDown" });
    expect(handle().getAttribute("aria-valuenow")).toBe("512");
    cleanup();

    surface(undefined, storage);
    expect(handle().getAttribute("aria-valuenow")).toBe("512");
  });

  it("is not offered in the expanded view", () => {
    surface();
    fireEvent.click(screen.getByTitle("Fill the window"));

    expect(screen.queryByRole("separator")).toBeNull();
  });
});
