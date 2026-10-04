// @vitest-environment happy-dom

/**
 * Marking the battle options a host has changed from their default (issue
 * #3388): the count on the tabs that hold them, and the mark on the option.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import type { Battle } from "../bindings";
import { BattleOptionsDrawer } from "./BattleOptionsDrawer";
import type { OptionEdit } from "./battleOptions";

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

function open(
  scriptTags: Record<string, string>,
  {
    canEdit = true,
    sendOption = () => {},
    sendOptions = () => {},
  }: {
    canEdit?: boolean;
    sendOption?: (tagKey: string, spadsName: string, value: string) => void;
    sendOptions?: (edits: OptionEdit[]) => void;
  } = {},
) {
  render(
    <BattleOptionsDrawer
      battle={battleWith(scriptTags)}
      modOptionsSchema={MOD}
      mapOptionsSchema={MAP}
      canEdit={canEdit}
      gameMissing={false}
      mapMissing={false}
      sendOption={sendOption}
      sendOptions={sendOptions}
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

describe("BattleOptionsDrawer reset (issue #3387)", () => {
  const click = (name: RegExp | string) =>
    fireEvent.click(screen.getByRole("button", { name }));
  const resetButtons = () =>
    screen.queryAllByRole("button", { name: /^Reset/ });

  it("resets one changed option to its default through the single-change path", () => {
    vi.useFakeTimers();
    try {
      const sendOption = vi.fn();
      open({ "game/modoptions/maxunits": "2000" }, { sendOption });
      select(/^Game/);

      click(/^Reset Max units to its default/);
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(sendOption).toHaveBeenCalledWith(
        "game/modoptions/maxunits",
        "maxunits",
        "1000",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a row reset only on the changed row", () => {
    open({ "game/modoptions/maxunits": "2000" });
    select(/^Game/);

    expect(
      screen.queryAllByRole("button", { name: /to its default$/ }),
    ).toHaveLength(1);
  });

  it("shows no reset anywhere when nothing is changed", () => {
    open({});
    select(/^Game/);
    expect(resetButtons()).toHaveLength(0);
    select(/^Map/);
    expect(resetButtons()).toHaveLength(0);
  });

  it("asks with the count before resetting a tab, and sends the lot at once", () => {
    const sendOption = vi.fn();
    const sendOptions = vi.fn();
    open(
      {
        "game/modoptions/maxunits": "2000",
        "game/modoptions/fixedallies": "0",
        "game/modoptions/mapsize": "16",
      },
      { sendOption, sendOptions },
    );
    select(/^Game/);

    click("Reset all Game options");
    expect(screen.getByText("Reset 2 options to their defaults?")).toBeTruthy();
    expect(sendOptions).not.toHaveBeenCalled();

    const confirm = screen
      .getAllByRole("button", { name: "Reset" })
      .find((b) => b.closest("[data-slot=popover-content]"));
    fireEvent.click(confirm as HTMLElement);

    expect(sendOptions).toHaveBeenCalledTimes(1);
    expect(sendOptions).toHaveBeenCalledWith([
      {
        tagKey: "game/modoptions/maxunits",
        spadsName: "maxunits",
        value: "1000",
      },
      {
        tagKey: "game/modoptions/fixedallies",
        spadsName: "fixedallies",
        value: "1",
      },
    ]);
    expect(sendOption).not.toHaveBeenCalled();
  });

  it("sends nothing when the confirm is cancelled", () => {
    const sendOptions = vi.fn();
    open({ "game/modoptions/maxunits": "2000" }, { sendOptions });
    select(/^Game/);

    click("Reset all Game options");
    click("Cancel");

    expect(sendOptions).not.toHaveBeenCalled();
  });

  it("resets the map tab across map options and the mod options about the map", () => {
    const sendOptions = vi.fn();
    open(
      { "game/mapoptions/fog": "1", "game/modoptions/mapsize": "16" },
      { sendOptions },
    );
    select(/^Map/);

    click("Reset all Map options");
    expect(screen.getByText("Reset 2 options to their defaults?")).toBeTruthy();
  });

  it("shows no reset control to somebody who cannot change the options", () => {
    open(
      { "game/modoptions/maxunits": "2000", "game/mapoptions/fog": "1" },
      { canEdit: false },
    );
    select(/^Game/);
    expect(resetButtons()).toHaveLength(0);
    select(/^Map/);
    expect(resetButtons()).toHaveLength(0);
  });
});
