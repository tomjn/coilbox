// @vitest-environment happy-dom

/**
 * The unit builder's bar of view controls, in the bottom right of the viewport.
 *
 * The bar had grown to seventeen buttons in the user's screenshot, its tools and
 * toggles looked the same whether they were on or off, two of them were the same
 * ruler and two more were near-identical cubes. These check the four things that
 * went wrong: every toggle reports and shows its state, the measure tool shows it
 * is on, no two buttons share an icon, and the front, side and top views live in
 * a flyout over the reset button rather than in the bar.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GROUND } from "../../environment";
import { newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { EnvironmentPicker } from "./EnvironmentPicker";
import { GuidesPopover } from "./GuidesPopover";
import { ReferencePicker } from "./ReferencePicker";
import { ViewportBar, type ViewportBarProps } from "./ViewportBar";

vi.mock("./useTestGame", () => ({
  useTestGame: () => ({ target: null, game: null }),
}));
vi.mock("@/workshop/config", () => ({ useUnitDefs: () => ({}) }));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({ target: null }),
}));
vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({ data: undefined }),
  useUnitsyncUnitDataset: () => ({ dataset: undefined }),
  useUnitsyncUnitModel: () => ({
    model: null,
    loading: false,
    failed: false,
    error: null,
    retry: () => {},
  }),
}));

afterEach(cleanup);

const project = newProject({
  id: "p",
  rootPieceId: "root",
  name: "walker",
  packId: "lego",
  packVersion: "1",
  now: "2026-10-18T00:00:00Z",
});

function toggle(on = false) {
  return { on, onChange: vi.fn() };
}

/**
 * The bar as the user's screenshot had it: a unit with a footprint check and a
 * guide, and no skeleton, weapons, stand-in or script effects. The real
 * pickers go in their slots, because their icons are part of the bar.
 */
function props(overrides: Partial<ViewportBarProps> = {}): ViewportBarProps {
  return {
    grid: toggle(true),
    drawMode: "solid",
    onNextDrawMode: vi.fn(),
    collision: toggle(),
    balance: toggle(),
    overlap: toggle(),
    footprint: { ...toggle(), leaveOut: true, onLeaveOutChange: vi.fn() },
    aim: toggle(),
    view: null,
    onView: vi.fn(),
    measure: toggle(),
    guides: (
      <GuidesPopover
        guides={[]}
        onEdit={() => {}}
        picking={null}
        onPick={() => {}}
      />
    ),
    guideVisibility: toggle(true),
    environment: (
      <EnvironmentPicker
        backdrop="studio"
        onBackdrop={() => {}}
        ground={DEFAULT_GROUND}
        onGround={() => {}}
        shape={null}
      />
    ),
    reference: (
      <ReferencePicker
        unit={{ project, pack: {} as LoadedPack, raw: null }}
        show={false}
        onShowChange={() => {}}
        onReference={() => {}}
      />
    ),
    onShortcuts: vi.fn(),
    compassRef: { current: null },
    onResetView: vi.fn(),
    ...overrides,
  };
}

/** Every optional control present and switched on, the longest the bar gets. */
function everything(): Partial<ViewportBarProps> {
  return {
    skeleton: toggle(true),
    footprint: { ...toggle(true), leaveOut: true, onLeaveOutChange: vi.fn() },
    reach: toggle(true),
    standIn: toggle(true),
    followDrive: toggle(true),
    effects: toggle(true),
  };
}

function bar() {
  return screen.getAllByRole("group")[0];
}

/** The buttons in the bar itself, not the ones in a flyout or a popover. */
function barButtons() {
  return within(bar())
    .getAllByRole("button")
    .filter((button) => !button.closest("[data-views-flyout]"));
}

function resetButton() {
  return screen.getByRole("button", { name: "Reset the view" });
}

function focused() {
  return document.activeElement as HTMLElement;
}

function lucideName(svg: Element) {
  return [...svg.classList].find(
    (name) => name.startsWith("lucide-") && name !== "lucide-icon",
  );
}

describe("toggles and tools", () => {
  it("gives every toggle aria-pressed and flips it when the state changes", () => {
    const { rerender } = render(<ViewportBar {...props(everything())} />);
    const pressed = barButtons().filter((b) => b.hasAttribute("aria-pressed"));
    // Grid, collision, skeleton, balance, overlap, footprint, leave out, aim,
    // ranges, measure, guides, guide visibility, reference, stand-in, follow
    // and effects.
    expect(pressed).toHaveLength(16);

    const before = screen.getByRole("button", {
      name: "Show the collision volume, the shape the engine hits and clicks",
    });
    expect(before.getAttribute("aria-pressed")).toBe("false");
    rerender(
      <ViewportBar {...props({ ...everything(), collision: toggle(true) })} />,
    );
    const after = screen.getByRole("button", {
      name: "Hide the collision volume",
    });
    expect(after.getAttribute("aria-pressed")).toBe("true");
  });

  it("draws a toggle that is on the way the gizmo's chosen mode is drawn", () => {
    render(<ViewportBar {...props({ collision: toggle(true) })} />);
    const on = screen.getByRole("button", {
      name: "Hide the collision volume",
    });
    const off = screen.getByRole("button", {
      name: "Show the balance check: where the weight looks centred, against the ground the feet or wheels cover. An estimate from piece volumes at one density, not a mass. The engine does not simulate balance",
    });
    expect(on.className).toContain("bg-primary");
    expect(off.className).not.toContain("bg-primary");
    expect(off.className).toContain("border");
  });

  it("shows the measure tool as on while it is on", () => {
    const { rerender } = render(<ViewportBar {...props()} />);
    const idle = screen.getByRole("button", {
      name: /^Measure between two points/,
    });
    expect(idle.getAttribute("aria-pressed")).toBe("false");
    expect(idle.className).not.toContain("bg-primary");

    rerender(<ViewportBar {...props({ measure: toggle(true) })} />);
    const active = screen.getByRole("button", {
      name: /^Leave the measure tool/,
    });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(active.className).toContain("bg-primary");
  });
});

describe("icons", () => {
  it.each([
    "solid",
    "wireframe",
    "both",
  ] as const)("gives no two buttons the same icon, drawing %s", (drawMode) => {
    render(<ViewportBar {...props({ ...everything(), drawMode })} />);
    // Open the flyout so its view buttons are counted too.
    fireEvent.mouseOver(resetButton());
    const names = within(bar())
      .getAllByRole("button")
      .map((button) => {
        const svg = button.querySelector("svg.lucide");
        return svg ? lucideName(svg) : "compass";
      });
    expect(names).not.toContain(undefined);
    expect(new Set(names).size).toBe(names.length);
  });

  it("draws the measure tool and the guides with different icons", () => {
    render(<ViewportBar {...props()} />);
    const measure = screen.getByRole("button", {
      name: /^Measure between two points/,
    });
    const guides = screen.getByRole("button", { name: "Guides" });
    const measureIcon = lucideName(
      measure.querySelector("svg.lucide") as Element,
    );
    const guidesIcon = lucideName(
      guides.querySelector("svg.lucide") as Element,
    );
    expect(measureIcon).not.toBe(guidesIcon);
    expect([measureIcon, guidesIcon]).not.toContain("lucide-ruler");
  });
});

describe("the fixed views", () => {
  it("keeps them out of the bar, which is shorter for it", () => {
    render(<ViewportBar {...props()} />);
    // The screenshot's bar held 17 buttons, three of them the views.
    expect(barButtons()).toHaveLength(14);
    expect(screen.queryByRole("button", { name: /front/ })).toBeNull();
  });

  it("opens them above the reset button on hover", () => {
    render(<ViewportBar {...props()} />);
    fireEvent.mouseOver(resetButton());
    const flyout = screen.getByRole("group", { name: "Fixed views" });
    const names = within(flyout)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual([
      "Look at the front with no perspective (1)",
      "Look at the side with no perspective (2)",
      "Look at the top with no perspective (3)",
    ]);
    expect(flyout.parentElement?.className).toContain("bottom-full");

    fireEvent.mouseOut(resetButton());
    expect(screen.queryByRole("group", { name: "Fixed views" })).toBeNull();
  });

  it("opens them when the reset button takes focus, after it in tab order", () => {
    render(<ViewportBar {...props()} />);
    act(() => resetButton().focus());
    const flyout = screen.getByRole("group", { name: "Fixed views" });
    const first = within(flyout).getAllByRole("button")[0];
    expect(
      resetButton().compareDocumentPosition(first) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("moves through them with the arrow keys and closes on Escape", () => {
    render(<ViewportBar {...props()} />);
    act(() => resetButton().focus());
    // Up from the reset button reaches the nearest view, the bottom one.
    fireEvent.keyDown(resetButton(), { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Look at the top with no perspective (3)",
    );
    fireEvent.keyDown(focused(), { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Look at the side with no perspective (2)",
    );
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(resetButton());

    fireEvent.keyDown(resetButton(), { key: "ArrowUp" });
    fireEvent.keyDown(focused(), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Fixed views" })).toBeNull();
    expect(document.activeElement).toBe(resetButton());
  });

  it("keeps Escape inside the flyout from reaching the viewport's own keys", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<ViewportBar {...props()} />);
    act(() => resetButton().focus());
    fireEvent.keyDown(resetButton(), { key: "Escape" });
    window.removeEventListener("keydown", onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  it("shows which view is on, and turns it off from the same button", () => {
    const onView = vi.fn();
    render(<ViewportBar {...props({ view: "side", onView })} />);
    fireEvent.mouseOver(resetButton());
    const side = screen.getByRole("button", {
      name: "Leave the side view (2)",
    });
    expect(side.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(side);
    expect(onView).toHaveBeenCalledWith("side", false);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Look at the top with no perspective (3)",
      }),
    );
    expect(onView).toHaveBeenCalledWith("top", true);
  });

  it("still resets the view when the reset button is clicked", () => {
    const onResetView = vi.fn();
    render(<ViewportBar {...props({ onResetView })} />);
    fireEvent.click(resetButton());
    expect(onResetView).toHaveBeenCalledOnce();
  });
});
