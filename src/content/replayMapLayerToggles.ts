/**
 * Which layers the replay page's map draws, remembered between visits (#1152).
 *
 * A preference about how someone reads a map, not a fact about one replay, so
 * it goes to `localStorage` under one key for every replay, as the chart's
 * colour mode does in `chartColorMode.ts`.
 */

import { useState } from "react";

const KEY = "coilbox.replayMap.layers";

export const MAP_LAYERS = [
  "startBoxes",
  "starts",
  "buildings",
  "density",
  "bases",
] as const;

export type MapLayer = (typeof MAP_LAYERS)[number];

export type MapLayerToggles = Record<MapLayer, boolean>;

/**
 * What is on before anybody has chosen. The start boxes were always drawn, and
 * start positions come with the replay's details at no further cost. The two
 * layers drawn from build orders are off, because reading those walks the
 * whole demo stream.
 */
export const DEFAULT_MAP_LAYERS: MapLayerToggles = {
  startBoxes: true,
  starts: true,
  buildings: false,
  density: false,
  bases: false,
};

/** Parse a stored value. Anything missing or not a boolean takes its default. */
export function storedMapLayers(raw: string | null): MapLayerToggles {
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const held =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  const out = { ...DEFAULT_MAP_LAYERS };
  for (const layer of MAP_LAYERS)
    if (typeof held[layer] === "boolean") out[layer] = held[layer];
  return out;
}

/** The layers that are on, as the list a multiple toggle group holds. */
export function layersOn(toggles: MapLayerToggles): MapLayer[] {
  return MAP_LAYERS.filter((layer) => toggles[layer]);
}

/** The remembered toggles, and a setter that remembers them. */
export function useStoredMapLayers(): [
  MapLayerToggles,
  (on: readonly string[]) => void,
] {
  const [toggles, setToggles] = useState<MapLayerToggles>(() => {
    try {
      return storedMapLayers(localStorage.getItem(KEY));
    } catch {
      // Storage unavailable (private mode or quota). The defaults stand.
      return DEFAULT_MAP_LAYERS;
    }
  });
  return [
    toggles,
    (on) => {
      const next = { ...DEFAULT_MAP_LAYERS };
      for (const layer of MAP_LAYERS) next[layer] = on.includes(layer);
      setToggles(next);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
    },
  ];
}
