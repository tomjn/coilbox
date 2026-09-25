// @vitest-environment happy-dom
/**
 * The drawer that previews and applies one arithmetic change across a
 * collection (issue #2655). `OptionSelect` is mocked to a native `<select>`,
 * the same way `PlayLocallyButton`'s tests do it, since Radix's own dropdown
 * needs pointer capture jsdom/happy-dom do not implement.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchRow } from "../../batchEdit";
import {
  createCollection,
  setCollectionMembership,
  setCollectionRule,
} from "../../collections";

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" disabled hidden />
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const { BatchEditDrawer } = await import("./BatchEditDrawer");

const UNITS = {
  armcom: { metalCost: 900 },
  armflash: { metalCost: 50 },
  armpw: { metalCost: 30 },
  armstring: { metalCost: "cheap" },
};

function withCollection(units: string[]) {
  let collections = createCollection({}, "Bots").collections;
  const id = Object.keys(collections)[0];
  for (const u of units) {
    collections = setCollectionMembership(collections, id, u, true);
  }
  return { collections, id };
}

afterEach(cleanup);

describe("picking a field and an operation", () => {
  it("previews a before-and-after per unit, and reports how many change", () => {
    const { collections, id } = withCollection(["armcom", "armflash"]);
    render(
      <BatchEditDrawer
        open
        onOpenChange={() => {}}
        collections={collections}
        units={UNITS}
        overrides={{}}
        nameOf={(key) => key}
        onApply={() => {}}
        weaponDefs={{}}
        library={{}}
        equipped={{}}
        clones={{}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Collection"), {
      target: { value: id },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. cost"), {
      target: { value: "cost" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.9"), {
      target: { value: "0.5" },
    });

    expect(
      screen.getByText((_, el) => el?.textContent === "900 → 450"),
    ).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.textContent === "50 → 25"),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /preview/i }).textContent,
    ).toContain("2 of 2 units change");
  });

  it("skips a unit missing the field, and one whose value is not a number", () => {
    const { collections, id } = withCollection(["armpw", "armstring"]);
    render(
      <BatchEditDrawer
        open
        onOpenChange={() => {}}
        collections={collections}
        units={{ ...UNITS, armpw: { name: "peewee" } }}
        overrides={{}}
        nameOf={(key) => key}
        onApply={() => {}}
        weaponDefs={{}}
        library={{}}
        equipped={{}}
        clones={{}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Collection"), {
      target: { value: id },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. cost"), {
      target: { value: "cost" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.9"), {
      target: { value: "2" },
    });

    expect(screen.getByText("No such field")).toBeTruthy();
    expect(screen.getByText("Not a number")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /preview/i }).textContent,
    ).toContain("0 of 2 units change");
  });

  it("shows the search box's own error for an unknown field", () => {
    const { collections, id } = withCollection(["armcom"]);
    render(
      <BatchEditDrawer
        open
        onOpenChange={() => {}}
        collections={collections}
        units={UNITS}
        overrides={{}}
        nameOf={(key) => key}
        onApply={() => {}}
        weaponDefs={{}}
        library={{}}
        equipped={{}}
        clones={{}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Collection"), {
      target: { value: id },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. cost"), {
      target: { value: "notafield" },
    });
    expect(screen.getByText(/Unknown field/)).toBeTruthy();
  });

  it("rounds to the nearest step when asked", () => {
    const { collections, id } = withCollection(["armcom"]);
    render(
      <BatchEditDrawer
        open
        onOpenChange={() => {}}
        collections={collections}
        units={UNITS}
        overrides={{}}
        nameOf={(key) => key}
        onApply={() => {}}
        weaponDefs={{}}
        library={{}}
        equipped={{}}
        clones={{}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Collection"), {
      target: { value: id },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. cost"), {
      target: { value: "cost" },
    });
    fireEvent.change(screen.getByLabelText("Operation"), {
      target: { value: "offset" },
    });
    fireEvent.change(screen.getByPlaceholderText("-20"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Rounding"), {
      target: { value: "nearest" },
    });
    fireEvent.change(screen.getByPlaceholderText("5"), {
      target: { value: "10" },
    });
    // 900 + 3 = 903, nearest multiple of 10 is 900: unchanged from the 900
    // the unit already holds.
    expect(
      screen.getByText((_, el) => el?.textContent === "900 → 900(unchanged)"),
    ).toBeTruthy();
  });

  it("disables applying until an operation would change at least one unit", () => {
    const { collections, id } = withCollection(["armcom"]);
    render(
      <BatchEditDrawer
        open
        onOpenChange={() => {}}
        collections={collections}
        units={UNITS}
        overrides={{}}
        nameOf={(key) => key}
        onApply={() => {}}
        weaponDefs={{}}
        library={{}}
        equipped={{}}
        clones={{}}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: /apply to/i })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Collection"), {
      target: { value: id },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. cost"), {
      target: { value: "cost" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.9"), {
      target: { value: "1" },
    });
    expect(
      screen
        .getByRole("button", { name: /apply to/i })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("0.9"), {
      target: { value: "0.5" },
    });
    expect(
      screen
        .getByRole("button", { name: /apply to/i })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});

describe("applying", () => {
  it("hands up every row, closes the drawer, and asks for nothing further", () => {
    const { collections, id } = withCollection(["armcom", "armflash"]);
    const onApply = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <BatchEditDrawer
        open
        onOpenChange={onOpenChange}
        collections={collections}
        units={UNITS}
        overrides={{}}
        nameOf={(key) => key}
        onApply={onApply}
        weaponDefs={{}}
        library={{}}
        equipped={{}}
        clones={{}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Collection"), {
      target: { value: id },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. cost"), {
      target: { value: "cost" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.9"), {
      target: { value: "0.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply to/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const rows = onApply.mock.calls[0][0] as BatchRow[];
    expect(rows.map((r) => [r.unit, r.before, r.after])).toEqual([
      ["armcom", 900, 450],
      ["armflash", 50, 25],
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("a rule naming a derived field (issue #3085)", () => {
  it("reaches a unit a dps rule matches", () => {
    const tank = {
      metalCost: 200,
      weapons: [{ name: "armtank_laser" }],
      weapondefs: {
        laser: { range: 300, reloadTime: 2, damage: { default: 50 } },
      },
    };
    let collections = createCollection({}, "Hard hitters").collections;
    const id = Object.keys(collections)[0];
    collections = setCollectionRule(collections, id, "dps > 20");
    render(
      <BatchEditDrawer
        open
        onOpenChange={() => {}}
        collections={collections}
        units={{ armtank: tank }}
        overrides={{}}
        nameOf={(key) => key}
        onApply={() => {}}
        weaponDefs={{}}
        library={{}}
        equipped={{}}
        clones={{}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Collection"), {
      target: { value: id },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. cost"), {
      target: { value: "cost" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.9"), {
      target: { value: "0.5" },
    });

    expect(
      screen.getByRole("heading", { name: /preview/i }).textContent,
    ).toContain("1 of 1 unit change");
  });
});

describe("no collections yet", () => {
  it("points at the Collections button instead of showing the form", () => {
    render(
      <BatchEditDrawer
        open
        onOpenChange={() => {}}
        collections={{}}
        units={UNITS}
        overrides={{}}
        nameOf={(key) => key}
        onApply={() => {}}
        weaponDefs={{}}
        library={{}}
        equipped={{}}
        clones={{}}
      />,
    );
    expect(screen.getByText(/no collections yet/i)).toBeTruthy();
    expect(screen.queryByLabelText("Collection")).toBeNull();
  });
});
