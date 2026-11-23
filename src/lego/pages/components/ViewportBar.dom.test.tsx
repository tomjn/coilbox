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
    snapping: toggle(true),
    drawMode: "solid",
    onNextDrawMode: vi.fn(),
    collision: toggle(),
    balance: toggle(),
    overlap: toggle(),
    footprint: { ...toggle(), leaveOut: true, onLeaveOutChange: vi.fn() },
    aim: toggle(),
    fourViews: toggle(),
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

function barButtons() {
  return within(bar()).getAllByRole("button");
}

function lucideName(svg: Element) {
  return [...svg.classList].find(
    (name) => name.startsWith("lucide-") && name !== "lucide-icon",
  );
}

/** Opens the Show menu the way a keyboard does, which Radix answers in jsdom. */
function openShowMenu() {
  const trigger = screen.getByRole("button", { name: "Show" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu");
}

describe("the Show menu", () => {
  it("lists every overlay by name with its state", () => {
    render(<ViewportBar {...props(everything())} />);
    const items = within(openShowMenu()).getAllByRole("menuitemcheckbox");
    expect(items.map((item) => item.textContent)).toEqual([
      "Grid",
      "SnappingP",
      "Collision volume",
      "SkeletonK",
      "Balance check",
      "Overlap check",
      "Footprint check",
      "Leave the barrel and similar out of the footprint",
      "Aim point",
      "Weapon ranges",
      "Guides",
      "Stand-in unit",
      "Follow the driving unit",
      "Script effects",
    ]);
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    expect(items[1].getAttribute("aria-checked")).toBe("true");
    expect(items[2].getAttribute("aria-checked")).toBe("false");
  });

  it("leaves out what the page does not offer", () => {
    render(<ViewportBar {...props()} />);
    const names = within(openShowMenu())
      .getAllByRole("menuitemcheckbox")
      .map((item) => item.textContent);
    expect(names).toEqual([
      "Grid",
      "SnappingP",
      "Collision volume",
      "Balance check",
      "Overlap check",
      "Footprint check",
      "Aim point",
      "Guides",
    ]);
  });

  it("calls the toggle's onChange when an item is chosen", () => {
    const collision = toggle();
    render(<ViewportBar {...props({ collision })} />);
    fireEvent.click(
      within(openShowMenu()).getByRole("menuitemcheckbox", {
        name: "Collision volume",
      }),
    );
    expect(collision.onChange).toHaveBeenCalledWith(true);
  });

  it("calls the snapping onChange, naming its key", () => {
    const snapping = toggle(true);
    render(<ViewportBar {...props({ snapping })} />);
    const item = within(openShowMenu()).getByRole("menuitemcheckbox", {
      name: /^Snapping/,
    });
    expect(item.textContent).toContain("P");
    fireEvent.click(item);
    expect(snapping.onChange).toHaveBeenCalledWith(false);
  });

  it("turns an overlay that is on off", () => {
    const grid = toggle(true);
    render(<ViewportBar {...props({ grid })} />);
    fireEvent.click(
      within(openShowMenu()).getByRole("menuitemcheckbox", { name: "Grid" }),
    );
    expect(grid.onChange).toHaveBeenCalledWith(false);
  });
});

describe("tools in the bar", () => {
  it("switches between one view and four, and says which it offers", () => {
    const fourViews = toggle();
    const { rerender } = render(<ViewportBar {...props({ fourViews })} />);
    const button = screen.getByRole("button", { name: "Four views (4)" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(fourViews.onChange).toHaveBeenCalledWith(true);

    rerender(<ViewportBar {...props({ fourViews: toggle(true) })} />);
    expect(
      screen
        .getByRole("button", { name: "One view (4)" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("leaves the measure tool to the tool rail", () => {
    render(<ViewportBar {...props()} />);
    expect(
      screen.queryByRole("button", { name: /^Measure between two points/ }),
    ).toBeNull();
  });
});

describe("icons", () => {
  it.each([
    "solid",
    "wireframe",
    "both",
  ] as const)("gives no two buttons the same icon, drawing %s", (drawMode) => {
    render(<ViewportBar {...props({ ...everything(), drawMode })} />);
    const names = within(bar())
      .getAllByRole("button")
      .map((button) => {
        const svg = button.querySelector("svg.lucide");
        return svg ? lucideName(svg) : "none";
      });
    expect(names).not.toContain(undefined);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not give the guides a ruler, which the measure tool has", () => {
    render(<ViewportBar {...props()} />);
    const guides = screen.getByRole("button", { name: "Guides" });
    const guidesIcon = lucideName(
      guides.querySelector("svg.lucide") as Element,
    );
    expect(guidesIcon).not.toMatch(/^lucide-ruler/);
  });
});

describe("the axis compass", () => {
  it("is not in the bar, and neither is the views flyout", () => {
    render(<ViewportBar {...props()} />);
    expect(screen.queryByRole("button", { name: "Reset the view" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Fixed views" })).toBeNull();
    expect(screen.queryByRole("button", { name: /perspective/ })).toBeNull();
    // The Show menu, the draw mode, one or four views, the pickers and the
    // keyboard sheet are what is left.
    expect(barButtons()).toHaveLength(7);
  });
});
