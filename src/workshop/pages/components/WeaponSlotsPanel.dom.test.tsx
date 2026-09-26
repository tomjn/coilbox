// @vitest-environment happy-dom
/**
 * The weapons tab's supporting definitions and broken references (issue
 * #2641): what the panel draws for a unit that carries definitions no slot
 * mounts, and how a reference that names nothing is shown.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deathExplosions } from "../../deathExplosions";
import type { RefProblem, SupportingDef } from "../../weaponRefs";
import { weaponSlots } from "../../weaponSlots";
import {
  DeathExplosionsPanel,
  type ExplosionPanel,
  type SlotLibrary,
  WeaponSlotsPanel,
} from "./WeaponSlotsPanel";

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

  it("lists a reference that names nothing, in error colour", () => {
    draw({ problems: [problem] });
    const list = screen.getByRole("list", {
      name: "Problems with this unit's weapons",
    });
    expect(list.textContent).toBe(problem.message);
    expect(list.querySelector("li")?.className).toContain("text-destructive");
  });

  it("lists an unknown armour class in warning colour rather than error colour", () => {
    draw({
      problems: [
        {
          id: "rocket:damage",
          message: "rocket's damage table names 1 armour class...",
          severity: "warning",
        },
      ],
    });
    const list = screen.getByRole("list", {
      name: "Problems with this unit's weapons",
    });
    expect(list.querySelector("li")?.className).toContain("text-amber-700");
    expect(list.querySelector("li")?.className).not.toContain(
      "text-destructive",
    );
  });
});

/** Issue #3116. A problem's `holder` names the same definition as a slot. */
describe("the slot a weapon problem is about", () => {
  it("marks the slot whose own definition the problem's holder names", () => {
    draw({ problems: [problem] });
    const slot = screen.getByRole("radio", { name: "Weapon 1, ship_rocket" });
    const marker = slot.querySelector("[title]");
    expect(marker?.getAttribute("title")).toBe(problem.message);
  });

  it("marks nothing when no problem's holder names this slot", () => {
    draw({
      problems: [{ ...problem, holder: { kind: "own", key: "elsewhere" } }],
    });
    const slot = screen.getByRole("radio", { name: "Weapon 1, ship_rocket" });
    expect(slot.querySelector("[title]")).toBeNull();
  });
});

describe("the death explosion a weapon problem is about", () => {
  const def = {
    weapons: [{ name: "ship_rocket" }],
    weapondefs: { rocket: {}, rocket_split: {}, leftover: {} },
    explodeAs: "ship_rocket",
  };
  const explosions = deathExplosions(def, def, {}, ["ship"]);

  const explosionPanel: ExplosionPanel = {
    entries: explosions,
    selected: "explodeas",
    equippedIn: () => undefined,
    editCount: () => 0,
    copyKey: () => "",
    onSelect: () => {},
    onChange: () => {},
    onReset: () => {},
    postOf: () => undefined,
    onCopy: () => {},
    onEquip: () => {},
    onPutBack: () => {},
  };

  const drawExplosions = (
    over: Partial<Parameters<typeof DeathExplosionsPanel>[0]> = {},
  ) =>
    render(
      <DeathExplosionsPanel
        view={null}
        consumers={null}
        library={library}
        explosions={explosionPanel}
        {...over}
      />,
    );

  it("marks the death explosion whose own definition the problem's holder names", () => {
    drawExplosions({ problems: [problem] });
    const explosion = screen.getByRole("radio", { name: "Death explosion" });
    const marker = explosion.querySelector("[title]");
    expect(marker?.getAttribute("title")).toBe(problem.message);
  });
});
