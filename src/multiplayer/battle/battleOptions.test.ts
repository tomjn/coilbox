import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import {
  changedCount,
  displayedValue,
  optionValue,
  rawOptionEntries,
  reconcilePending,
  scriptTagKey,
} from "./battleOptions";

const opt = (over: Partial<ConfigOption> = {}): ConfigOption => ({
  key: "maxunits",
  name: "Max units",
  default: "1000",
  type: "number",
  ...over,
});

describe("battleOptions", () => {
  it("builds scoped script-tag keys", () => {
    expect(scriptTagKey("mod", "maxunits")).toBe("game/modoptions/maxunits");
    expect(scriptTagKey("map", "waterlevel")).toBe(
      "game/mapoptions/waterlevel",
    );
  });

  it("resolves option values case-insensitively", () => {
    const tags = { "GAME/MODOPTIONS/MaxUnits": "2000" };
    expect(optionValue(tags, "mod", "maxunits")).toBe("2000");
    expect(optionValue(tags, "mod", "missing")).toBeUndefined();
  });

  it("counts options changed from default", () => {
    const tags = { "game/modoptions/maxunits": "2000" };
    expect(changedCount([opt()], tags, "mod")).toBe(1);
    expect(
      changedCount([opt()], { "game/modoptions/maxunits": "1000" }, "mod"),
    ).toBe(0);
  });

  it("extracts raw entries for a scope", () => {
    const tags = {
      "game/modoptions/a": "1",
      "game/mapoptions/b": "2",
      "game/startpostype": "2",
    };
    expect(rawOptionEntries(tags, "mod")).toEqual([{ key: "a", value: "1" }]);
  });

  it("keeps pending until an echo changes the confirmed value", () => {
    const pending = {
      "game/modoptions/maxunits": { target: "2000", prev: "1000" },
    };
    // No echo yet: confirmed still equals prev -> stays pending.
    expect(
      reconcilePending(pending, { "game/modoptions/maxunits": "1000" }),
    ).toEqual(pending);
    // Echo arrives (value changed): resolved -> dropped.
    expect(
      reconcilePending(pending, { "game/modoptions/maxunits": "2000" }),
    ).toEqual({});
  });

  it("shows the pending target over the confirmed value", () => {
    const pending = {
      "game/modoptions/maxunits": { target: "2000", prev: "1000" },
    };
    const tags = { "game/modoptions/maxunits": "1000" };
    expect(displayedValue(pending, tags, "mod", "maxunits")).toBe("2000");
    expect(displayedValue({}, tags, "mod", "maxunits")).toBe("1000");
    expect(displayedValue({}, {}, "mod", "maxunits")).toBeUndefined();
  });
});
