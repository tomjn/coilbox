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
  "orderDensity",
  "bases",
  "deaths",
  "damage",
  "finished",
  "startUnitDeaths",
  "startUnitPaths",
] as const;

export type MapLayer = (typeof MAP_LAYERS)[number];

/** The layers drawn from an analysis's event log (#1160), which a replay with
 *  no analysis cannot switch on. */
export const EVENT_MAP_LAYERS: readonly MapLayer[] = [
  "deaths",
  "damage",
  "finished",
  "startUnitDeaths",
  "startUnitPaths",
];

/**
 * The toggle group's list with the event layers the reader chose on another
 * replay put back in. A replay that cannot draw them shows them off and
 * disabled, so a press on another toggle must not forget them.
 */
export function holdEventLayers(
  next: readonly string[],
  stored: MapLayerToggles,
): string[] {
  return [...next, ...EVENT_MAP_LAYERS.filter((layer) => stored[layer])];
}

export type MapLayerToggles = Record<MapLayer, boolean>;

/**
 * Deaths and damage are drawn in one ramp, because a fourth ramp that a
 * reader with red and green colour blindness can tell from the other three
 * does not exist: `heatRamp.ts` says why. So only one of the two is on at a
 * time, and switching one on switches the other off.
 */
export function oneOfDeathsAndDamage(
  next: readonly string[],
  before: MapLayerToggles,
): string[] {
  if (!next.includes("deaths") || !next.includes("damage")) return [...next];
  const drop = before.damage ? "damage" : "deaths";
  return next.filter((layer) => layer !== drop);
}

/**
 * What is on before anybody has chosen. The start boxes were always drawn, and
 * start positions come with the replay's details at no further cost. The two
 * layers drawn from build orders are off, because reading those walks the
 * whole demo stream, and so is the order density, which walks it again.
 */
export const DEFAULT_MAP_LAYERS: MapLayerToggles = {
  startBoxes: true,
  starts: true,
  buildings: false,
  density: false,
  orderDensity: false,
  bases: false,
  deaths: false,
  damage: false,
  finished: false,
  startUnitDeaths: false,
  startUnitPaths: false,
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
