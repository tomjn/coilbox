// @vitest-environment happy-dom

/**
 * Marking the battle options a host has changed from their default (issue
 * #3388): the count on the tabs that hold them, and the mark on the option.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import type { Battle } from "../bindings";
import { BattleOptionsDrawer } from "./BattleOptionsDrawer";

vi.mock("./BattleTweakDecodeSection", () => ({
  BattleTweakDecodeSection: () => null,
}));
vi.mock("@/campaign/pages/components/UnitRestrictions", () => ({
  UnitRestrictions: () => null,
}));

afterEach(cleanup);

const MOD: ConfigOption[] = [
  { key: "maxunits", name: "Max units", default: "1000", type: "number" },
  { key: "fixedallies", name: "Fixed allies", default: "1", type: "bool" },
  { key: "mapsize", name: "Map size", default: "8", type: "number" },
];
const MAP: ConfigOption[] = [
  { key: "fog", name: "Fog", default: "0", type: "bool" },
];

const battleWith = (scriptTags: Record<string, string>) =>
  ({ modname: "Test Game", scriptTags }) as unknown as Battle;

function open(scriptTags: Record<string, string>) {
  render(
    <BattleOptionsDrawer
      battle={battleWith(scriptTags)}
      modOptionsSchema={MOD}
      mapOptionsSchema={MAP}
      canEdit
      gameMissing={false}
      mapMissing={false}
      sendOption={() => {}}
      canEditRestrictions
      onRestrictChange={() => {}}
    />,
  );
  fireEvent.click(screen.getByText("Battle options", { selector: "button *" }));
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const select = (name: RegExp) => fireEvent.mouseDown(tab(name), { button: 0 });

describe("BattleOptionsDrawer changed options", () => {
  it("counts changes on the tab that holds them", () => {
    open({
      "game/modoptions/maxunits": "2000",
      "game/modoptions/fixedallies": "0",
      "game/modoptions/mapsize": "16",
      "game/mapoptions/fog": "1",
    });

    expect(tab(/^Game/).textContent).toContain("2 changed");
    // The map tab holds the map's own options and the mod options whose name
    // begins "Map".
    expect(tab(/^Map/).textContent).toContain("2 changed");
  });

  it("says nothing on a tab with no changes, nor for a default respelled", () => {
    open({
      "game/modoptions/maxunits": "1000.0",
      "game/modoptions/fixedallies": "true",
    });

    expect(tab(/^Game/).textContent).not.toContain("changed");
    expect(tab(/^Map/).textContent).not.toContain("changed");
  });

  it("marks a changed option and shows its default", () => {
    open({ "game/modoptions/maxunits": "2000" });
    select(/^Game/);

    expect(screen.getByText("changed")).toBeTruthy();
    expect(screen.getByText("Default: 1000")).toBeTruthy();
  });

  it("marks a changed map option on the map tab", () => {
    open({ "game/mapoptions/fog": "1" });
    select(/^Map/);

    expect(screen.getByText("changed")).toBeTruthy();
    expect(screen.getByText("Default: Off")).toBeTruthy();
  });

  it("ignores a value for an option the game does not declare", () => {
    open({ "game/modoptions/notinschema": "5" });

    expect(tab(/^Game/).textContent).not.toContain("changed");
  });
});
