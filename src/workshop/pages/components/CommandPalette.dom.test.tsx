// @vitest-environment happy-dom
/**
 * The Cmd+K palette (issue #3118): typing "zeus range" must land on the
 * weapon range field of the unit named Zeus, and the sections, the unit
 * search and the actions must all be reachable from the one box.
 *
 * `react-router`'s `useNavigate` is mocked rather than driven through a real
 * router, since what matters here is which path the palette asks for, not
 * that the router itself resolves it: `UnitPage.dom.test.tsx`-style tests
 * elsewhere in this file's own directory already cover a real route.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

const navigate = vi.fn();
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => navigate };
});

type Defs = Record<string, Record<string, unknown>>;

/** A unit named Zeus, carrying its own copy of a weapon with a range field,
 *  the same shape a real Balanced Annihilation commander unit has. */
const UNITS: Defs = {
  armzeus: {
    weapons: [{ name: "armzeus_zeuslaser" }],
    weapondefs: { zeuslaser: { range: 300 } },
  },
  armcom: {
    weapons: [{ name: "armcom_armcomlaser" }],
    weapondefs: { armcomlaser: { range: 250 } },
  },
};

const nameOf = (key: string) =>
  ({ armzeus: "Zeus", armcom: "Commander" })[key] ?? key;

afterEach(() => {
  cleanup();
  navigate.mockClear();
});

function renderPalette(
  props: Partial<React.ComponentProps<typeof CommandPalette>> = {},
) {
  const onOpenChange = vi.fn();
  const onRequestTest = vi.fn();
  render(
    <CommandPalette
      open
      onOpenChange={onOpenChange}
      projectId="p1"
      units={UNITS}
      overrides={{}}
      weaponDefs={{}}
      nameOf={nameOf}
      currentUnitKey="armcom"
      onRequestTest={onRequestTest}
      {...props}
    />,
  );
  return { onOpenChange, onRequestTest };
}

function type(query: string) {
  const input = screen.getByPlaceholderText(/Jump to a unit/);
  fireEvent.change(input, { target: { value: query } });
}

describe("CommandPalette", () => {
  it("offers every project section and both actions with nothing typed", () => {
    renderPalette();
    for (const label of [
      "Units",
      "Changes",
      "Weapons",
      "Collections",
      "Checks",
      "Package",
    ])
      expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("Reference")).toBeTruthy();
    expect(screen.getByText("Test")).toBeTruthy();
  });

  it("lands 'zeus range' in Zeus's weapon range field", () => {
    renderPalette();
    type("zeus range");
    const [item] = screen.getAllByText("Range", { exact: false });
    fireEvent.click(item);
    expect(navigate).toHaveBeenCalledWith(
      "/workshop/p1?unit=armzeus&field=weapondefs.zeuslaser.range",
    );
  });

  it("finds a field of the unit already open by name alone", () => {
    renderPalette({ currentUnitKey: "armzeus" });
    type("range");
    const [item] = screen.getAllByText("Range", { exact: false });
    fireEvent.click(item);
    expect(navigate).toHaveBeenCalledWith(
      "/workshop/p1?unit=armzeus&field=weapondefs.zeuslaser.range",
    );
  });

  it("opens a unit matched by name", () => {
    renderPalette();
    type("zeus");
    fireEvent.click(screen.getByText("Zeus"));
    expect(navigate).toHaveBeenCalledWith("/workshop/p1?unit=armzeus");
  });

  it("runs the Test action rather than navigating", () => {
    const { onRequestTest, onOpenChange } = renderPalette();
    fireEvent.click(screen.getByText("Test"));
    expect(onRequestTest).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("jumps to a section", () => {
    renderPalette();
    fireEvent.click(screen.getByText("Checks"));
    expect(navigate).toHaveBeenCalledWith("/workshop/p1/checks");
  });
});
