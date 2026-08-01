/**
 * What fills a mission's panorama or side-graphic slot.
 *
 * A slot holds one of three things: the author's own image or video, the
 * mission's map as a spinning 3D preview, or one of the game's units as a
 * spinning 3D model. Which one is stored as *which config field is set*
 * (`panoramaMap` / `panoramaUnit`, and the side-graphic pair), rather than as a
 * discriminator of its own, because the map preview was there first and its
 * documents are already written that way.
 *
 * The mapping between "the option the author picked" and "the fields that are
 * set" is here rather than in the drawer so it can be tested without rendering
 * one, and so both slots answer it identically.
 */

import type { MapPreviewConfig, UnitPreviewConfig } from "./model";

/** The ways a slot can be filled, in the order the editor offers them. */
export const SLOT_SOURCE_OPTIONS = [
  { value: "image", label: "Image" },
  { value: "map-textured", label: "Map (textured)" },
  { value: "map-heightmap", label: "Map (wireframe)" },
  { value: "unit", label: "Unit model" },
] as const;

/** The configs one slot holds. At most one is ever set. */
export interface SlotConfigs {
  map?: MapPreviewConfig;
  unit?: UnitPreviewConfig;
}

/** The current slot source as a select value. */
export function slotSourceValue(slot: SlotConfigs): string {
  if (slot.unit) return "unit";
  if (!slot.map) return "image";
  return slot.map.style === "heightmap" ? "map-heightmap" : "map-textured";
}

/**
 * The configs a chosen source becomes. Exactly one is set (image sets neither),
 * so picking a source always clears the one it replaced.
 *
 * Switching within a kind keeps that kind's tuning, so trying the wireframe
 * style does not lose the spin speed. Switching to another kind drops what the
 * old one held, because keeping it would mean storing both. A fresh choice
 * seeds a default spin speed.
 */
export function sourceToSlot(value: string, prev: SlotConfigs): SlotConfigs {
  if (value === "image") return {};
  if (value === "unit") {
    return { unit: { unitDef: "", spinSpeed: 1, ...prev.unit } };
  }
  const style = value === "map-heightmap" ? "heightmap" : "textured";
  return { map: { spinSpeed: 1, ...prev.map, style } };
}

/**
 * Clamp a stored spin multiplier's magnitude to the editor's slider range,
 * keeping its sign (negative = reverse direction). Default 1.
 */
export function clampSpin(v: number | undefined): number {
  const n = v ?? 1;
  const magnitude = Math.min(4, Math.max(0.25, Math.abs(n)));
  return n < 0 ? -magnitude : magnitude;
}
