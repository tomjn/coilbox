import { describe, expect, it } from "vitest";
import type { UserWidgetGates } from "./handlers";
import {
  type RoomWidgetContext,
  roomWidgetVerdict,
  roomWidgetWarning,
} from "./roomWarning";
import type { WidgetRow } from "./widgetList";
import { EMPTY_SETS } from "./widgetSets";

const bar: UserWidgetGates = {
  option: { key: "allowuserwidgets", loads: true, unset: true },
  configFlag: true,
  anonymousColours: true,
  spectators: "all",
  unitControlOption: "allowunitcontrolwidgets",
};
const sf: UserWidgetGates = {
  option: { key: "allowuserwidgets", loads: true, unset: false },
};
const ca: UserWidgetGates = {
  option: { key: "disable_local_widgets", loads: false, unset: false },
  localWidgetsFile: "{SHORT}_data.lua",
  spectators: "option",
};

function context(
  rules: UserWidgetGates,
  options: Record<string, string> = {},
  more: Partial<RoomWidgetContext> = {},
): RoomWidgetContext {
  return {
    rules,
    option: (key) => options[key],
    spectating: false,
    configFlag: null,
    localWidgets: null,
    ...more,
  };
}

describe("roomWidgetVerdict", () => {
  it("lets a game load widgets when the room sets nothing and the game defaults to on", () => {
    expect(roomWidgetVerdict(context(bar))).toEqual({
      off: null,
      noUnitControl: false,
    });
  });

  it("turns them off for a game that defaults to off until the room turns them on", () => {
    expect(roomWidgetVerdict(context(sf)).off).toBe("option");
    expect(
      roomWidgetVerdict(context(sf, { allowuserwidgets: "1" })).off,
    ).toBeNull();
    expect(roomWidgetVerdict(context(sf, { allowuserwidgets: "0" })).off).toBe(
      "option",
    );
  });

  it("reads an option that turns widgets off the other way round", () => {
    expect(roomWidgetVerdict(context(ca)).off).toBeNull();
    expect(
      roomWidgetVerdict(context(ca, { disable_local_widgets: "1" })).off,
    ).toBe("option");
    expect(
      roomWidgetVerdict(context(ca, { disable_local_widgets: "0" })).off,
    ).toBeNull();
  });

  it("names the room's option before the player's own setting", () => {
    const verdict = roomWidgetVerdict(
      context(bar, { allowuserwidgets: "0" }, { configFlag: false }),
    );
    expect(verdict.off).toBe("option");
  });

  it("turns them off for anonymous team colours but not for the disabled mode", () => {
    expect(
      roomWidgetVerdict(context(bar, { teamcolors_anonymous_mode: "disabled" }))
        .off,
    ).toBeNull();
    expect(
      roomWidgetVerdict(context(bar, { teamcolors_anonymous_mode: "global" }))
        .off,
    ).toBe("anonymous-colours");
  });

  it("turns them off when the player's own config file does", () => {
    expect(roomWidgetVerdict(context(bar, {}, { configFlag: false })).off).toBe(
      "config-flag",
    );
    expect(
      roomWidgetVerdict(context(bar, {}, { configFlag: true })).off,
    ).toBeNull();
  });

  it("does not guess when the config file could not be read", () => {
    expect(
      roomWidgetVerdict(context(bar, {}, { configFlag: null })).off,
    ).toBeNull();
    expect(
      roomWidgetVerdict(context(ca, {}, { localWidgets: null })).off,
    ).toBeNull();
  });

  it("turns them off until the player turns local widgets on", () => {
    expect(
      roomWidgetVerdict(context(ca, {}, { localWidgets: false })).off,
    ).toBe("local-widgets");
    expect(
      roomWidgetVerdict(context(ca, {}, { localWidgets: true })).off,
    ).toBeNull();
  });

  it("loads everything for a spectator in Beyond All Reason", () => {
    expect(
      roomWidgetVerdict(
        context(
          bar,
          { allowuserwidgets: "0", allowunitcontrolwidgets: "0" },
          { spectating: true, configFlag: false },
        ),
      ),
    ).toEqual({ off: null, noUnitControl: false });
  });

  it("ignores only the option for a spectator in Zero-K", () => {
    const options = { disable_local_widgets: "1" };
    expect(
      roomWidgetVerdict(
        context(ca, options, { spectating: true, localWidgets: true }),
      ).off,
    ).toBeNull();
    expect(
      roomWidgetVerdict(
        context(ca, options, { spectating: true, localWidgets: false }),
      ).off,
    ).toBe("local-widgets");
  });

  it("turns off unit control only when the room says so", () => {
    expect(roomWidgetVerdict(context(bar)).noUnitControl).toBe(false);
    expect(
      roomWidgetVerdict(context(bar, { allowunitcontrolwidgets: "1" }))
        .noUnitControl,
    ).toBe(false);
    expect(
      roomWidgetVerdict(context(bar, { allowunitcontrolwidgets: "0" }))
        .noUnitControl,
    ).toBe(true);
  });

  it("has nothing to say about unit control while widgets are off altogether", () => {
    const verdict = roomWidgetVerdict(
      context(bar, { allowuserwidgets: "0", allowunitcontrolwidgets: "0" }),
    );
    expect(verdict).toEqual({ off: "option", noUnitControl: false });
  });

  it("never turns off a game that has no gates", () => {
    expect(roomWidgetVerdict(context({}))).toEqual({
      off: null,
      noUnitControl: false,
    });
  });
});

function row(
  name: string,
  more: Partial<WidgetRow> & { control?: boolean } = {},
): WidgetRow {
  const { control, ...rest } = more;
  return {
    path: `LuaUI/Widgets/${name}.lua`,
    folder: "LuaUI/Widgets",
    nested: false,
    coilbox: false,
    givesOrders: false,
    info: { name, control, enabled: true },
    error: null,
    loadedBy: ["Game"],
    switch: { kind: "ready", name, previousNames: [] },
    ...rest,
  };
}

describe("roomWidgetWarning", () => {
  const game = { game: "Game", shortName: "G" };

  it("has nothing to say when the room costs the player nothing", () => {
    expect(
      roomWidgetWarning(
        { off: null, noUnitControl: false },
        [row("A")],
        game,
        EMPTY_SETS,
      ),
    ).toBeNull();
  });

  it("lists the widgets the game loads when it turns them all off", () => {
    const warning = roomWidgetWarning(
      { off: "option", noUnitControl: false },
      [row("A"), row("B")],
      game,
      EMPTY_SETS,
    );
    expect(warning?.blocked).toEqual(["A", "B"]);
  });

  it("leaves out widgets another game loads, coilbox's own, files that did not run and widgets the player has off", () => {
    const rows = [
      row("Mine"),
      row("Other game's", { loadedBy: ["Other"] }),
      row("Coilbox", { coilbox: true }),
      row("Broken", { info: null, error: "boom" }),
      row("Off"),
    ];
    const warning = roomWidgetWarning(
      { off: "option", noUnitControl: false },
      rows,
      game,
      { ...EMPTY_SETS, global: { Mine: true, Off: false } },
    );
    expect(warning?.blocked).toEqual(["Mine"]);
  });

  it("counts a widget the player's set says nothing about", () => {
    const warning = roomWidgetWarning(
      { off: "option", noUnitControl: false },
      [row("New")],
      game,
      EMPTY_SETS,
    );
    expect(warning?.blocked).toEqual(["New"]);
  });

  it("leaves out a widget nothing has switched on whose own info leaves it off", () => {
    const rows = [
      row("Quiet", { info: { name: "Quiet", enabled: false } }),
      row("Chosen", { info: { name: "Chosen", enabled: false } }),
    ];
    const warning = roomWidgetWarning(
      { off: "option", noUnitControl: false },
      rows,
      game,
      { ...EMPTY_SETS, global: { Chosen: true } },
    );
    expect(warning?.blocked).toEqual(["Chosen"]);
  });

  it("uses the game's own set in place of the global one", () => {
    const warning = roomWidgetWarning(
      { off: "option", noUnitControl: false },
      [row("A"), row("B")],
      game,
      {
        ...EMPTY_SETS,
        global: { A: true, B: true },
        overrides: { G: { A: false, B: true } },
      },
    );
    expect(warning?.blocked).toEqual(["B"]);
  });

  it("separates widgets that declare unit control from ones that give orders without saying so", () => {
    const warning = roomWidgetWarning(
      { off: null, noUnitControl: true },
      [
        row("Declares", { control: true, givesOrders: true }),
        row("Silent", { givesOrders: true }),
        row("Harmless"),
      ],
      game,
      EMPTY_SETS,
    );
    expect(warning).toMatchObject({
      blocked: [],
      skipped: ["Declares"],
      failing: ["Silent"],
    });
  });

  it("is null when no widget gives orders", () => {
    expect(
      roomWidgetWarning(
        { off: null, noUnitControl: true },
        [row("Harmless")],
        game,
        EMPTY_SETS,
      ),
    ).toBeNull();
  });

  it("counts two files that share a name as two widgets, told apart by path", () => {
    const warning = roomWidgetWarning(
      { off: "option", noUnitControl: false },
      [
        row("Same", { path: "LuaUI/Widgets/a.lua" }),
        row("Same", { path: "LuaUI/Widgets/b.lua" }),
        row("Other"),
      ],
      game,
      EMPTY_SETS,
    );
    expect(warning?.blocked).toEqual([
      "Same (LuaUI/Widgets/a.lua)",
      "Same (LuaUI/Widgets/b.lua)",
      "Other",
    ]);
  });

  it("names a widget without a name by its file", () => {
    const warning = roomWidgetWarning(
      { off: "option", noUnitControl: false },
      [row("x", { info: { name: null, enabled: true } })],
      game,
      EMPTY_SETS,
    );
    expect(warning?.blocked).toEqual(["x.lua"]);
  });
});
