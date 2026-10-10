import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_LAYERS,
  layersOn,
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
