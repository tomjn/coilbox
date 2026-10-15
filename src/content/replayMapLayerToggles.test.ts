import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_LAYERS,
  layersOn,
  oneOfDeathsAndDamage,
  storedMapLayers,
} from "./replayMapLayerToggles";

describe("the map's remembered layers", () => {
  it("opens with the start boxes and start positions, and nothing that reads the stream", () => {
    expect(storedMapLayers(null)).toEqual(DEFAULT_MAP_LAYERS);
    expect(layersOn(DEFAULT_MAP_LAYERS)).toEqual(["startBoxes", "starts"]);
  });

  it("reads back what was stored", () => {
    const raw = JSON.stringify({
      startBoxes: false,
      starts: true,
      buildings: true,
      density: false,
      orderDensity: true,
    });
    expect(layersOn(storedMapLayers(raw))).toEqual([
      "starts",
      "buildings",
      "orderDensity",
    ]);
  });

  it("takes the default for anything missing, unknown or unreadable", () => {
    expect(storedMapLayers("not json")).toEqual(DEFAULT_MAP_LAYERS);
    expect(storedMapLayers('"a string"')).toEqual(DEFAULT_MAP_LAYERS);
    expect(storedMapLayers('{"density":true,"starts":"yes"}')).toEqual({
      ...DEFAULT_MAP_LAYERS,
      density: true,
    });
  });
});

describe("deaths and damage, which share a ramp", () => {
  const with_ = (over: Partial<typeof DEFAULT_MAP_LAYERS>) => ({
    ...DEFAULT_MAP_LAYERS,
    ...over,
  });

  it("leaves a choice of one of them, or neither, alone", () => {
    expect(oneOfDeathsAndDamage(["starts", "deaths"], with_({}))).toEqual([
      "starts",
      "deaths",
    ]);
    expect(oneOfDeathsAndDamage(["damage"], with_({ deaths: true }))).toEqual([
      "damage",
    ]);
    expect(oneOfDeathsAndDamage([], with_({ deaths: true }))).toEqual([]);
  });

  it("switches off the one that was on when the other is switched on", () => {
    expect(
      oneOfDeathsAndDamage(["deaths", "damage"], with_({ deaths: true })),
    ).toEqual(["damage"]);
    expect(
      oneOfDeathsAndDamage(
        ["starts", "deaths", "damage"],
        with_({ damage: true }),
      ),
    ).toEqual(["starts", "deaths"]);
  });

  it("keeps damage when both arrive at once with neither on before", () => {
    expect(oneOfDeathsAndDamage(["deaths", "damage"], with_({}))).toEqual([
      "damage",
    ]);
  });
});
