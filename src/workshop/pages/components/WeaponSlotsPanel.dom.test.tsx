// @vitest-environment happy-dom
/**
 * The weapons tab's supporting definitions and broken references (issue
 * #2641): what the panel draws for a unit that carries definitions no slot
 * mounts, and how a reference that names nothing is shown.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefProblem, SupportingDef } from "../../weaponRefs";
import { weaponSlots } from "../../weaponSlots";
import { type SlotLibrary, WeaponSlotsPanel } from "./WeaponSlotsPanel";

afterEach(cleanup);

const library: SlotLibrary = {
  weapons: {},
  unitName: "Ship",
  equippedIn: () => undefined,
  copySourceOf: () => undefined,
  mounts: () => 0,
  refusal: () => undefined,
  onCopy: () => {},
  onEquip: () => {},
  onUnequip: () => {},
  onChange: () => {},
  onReset: () => {},
  postOf: () => undefined,
};

const supporting: SupportingDef[] = [
  {
    key: "rocket_split",
    path: "weapondefs.rocket_split",
    def: { range: 300 },
    usedBy: [{ from: "rocket", field: "speceffect_def" }],
  },
  { key: "leftover", path: "weapondefs.leftover", def: {}, usedBy: [] },
];

const slots = weaponSlots(
  {
    weapons: [{ name: "ship_rocket" }],
    weapondefs: { rocket: {}, rocket_split: {}, leftover: {} },
  },
  {},
  ["ship"],
);

const problem: RefProblem = {
  id: "own:rocket:speceffect_def",
  holder: { kind: "own", key: "rocket" },
  field: "speceffect_def",
  value: "gone",
  message: "rocket's speceffect_def names gone, which is not a weapon.",
};

const draw = (over: Partial<Parameters<typeof WeaponSlotsPanel>[0]> = {}) =>
  render(
    <WeaponSlotsPanel
      slots={slots}
      selected={slots[0]}
      view={null}
      overrides={{ ship: { "weapondefs.leftover.range": 5 } }}
      unitKey="ship"
      consumers={null}
      onSelect={() => {}}
      onChange={() => {}}
      onReset={() => {}}
      library={library}
      supporting={supporting}
      {...over}
    />,
  );

describe("WeaponSlotsPanel supporting definitions", () => {
  it("lists them apart from the slots, with what names each", () => {
    draw();
    const group = screen.getByLabelText(
      "Supporting definitions: carried by this unit, mounted in no slot",
    );
    const split = screen.getByRole("radio", {
      name: "Supporting definition rocket_split",
    });
    expect(group.contains(split)).toBe(true);
    expect(split.getAttribute("title")).toBe(
      "Named by rocket's speceffect_def",
    );
    // The edit count sits on the one the project changed.
    expect(
      screen.getByRole("radio", { name: "Supporting definition leftover" })
        .textContent,
    ).toBe("leftover1");
  });

  it("selects one in place of the slot", () => {
    const onSelectSupport = vi.fn();
    draw({ selectedSupport: "rocket_split", onSelectSupport });
    expect(
      screen
        .getByRole("radio", { name: "Weapon 1, ship_rocket" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen
        .getByRole("radio", { name: "Supporting definition rocket_split" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("radio", { name: "Supporting definition leftover" }),
    );
    expect(onSelectSupport).toHaveBeenCalledWith("leftover");
  });

  it("opens on a unit that mounts nothing but carries something", () => {
    draw({ slots: [], selected: undefined, selectedSupport: "leftover" });
    expect(screen.queryByText("This unit has no weapons.")).toBeNull();
  });

  it("lists a reference that names nothing", () => {
    draw({ problems: [problem] });
    expect(
      screen.getByRole("list", {
        name: "Problems with this unit's weapons",
      }).textContent,
    ).toBe(problem.message);
  });
});
