/**
 * Zones as the editor edits them: where one is, what dragging it does, and what
 * a drag across bare ground draws.
 *
 * Arithmetic on plain values, so it can be tested without a GPU. The three.js
 * half, drawing a zone on the terrain, lives in `zonesLayer.ts`.
 *
 * A box's corners are put the right way round wherever they are written, because
 * the runtime does the same when it reads a mission (`coilbox_zones.lua`). A
 * zone dragged up and to the left arrives with its min above its max, and the
 * editor disagreeing with the runtime about which box that is would mean an
 * author draws one area and the mission tests another.
 */

import { turnedAbout } from "@/lib/scenarioEditing/editing";
import type { Heading } from "@/placement/mapKeys";
import type { Point, Scenario, ScenarioZone } from "../../model";

/**
 * The smallest a zone may be, in elmos: the side of a box, or the radius of a
 * circle.
 *
 * A drag of a few pixels at framing zoom is tens of elmos, so without a floor a
 * shaky hand makes a zone too small to see or to grab a corner of again. Roughly
 * a medium tank, which is the smallest area worth asking a question about.
 */
export const MIN_ZONE_ELMOS = 48;

/**
 * How big a zone is when a single point puts it down rather than a drag,
 * which is what the keyboard has to offer instead of two corners (issue
 * #2313). Four times the minimum: big enough to see and to find a size worth
 * grabbing before an author has changed it at all.
 */
export const DEFAULT_ZONE_ELMOS = MIN_ZONE_ELMOS * 4;

/**
 * Which part of a drawn zone is being dragged. A corner by its compass point,
 * because engine z grows southward, so `min` is the north-west corner.
 *
 * `move` is the whole zone, grabbed by the handle at its middle. A zone is a
 * sheet of ground, so its body is not what moves it: a zone big enough to fill
 * the view would otherwise swallow every drag meant for the camera or for the
 * next zone drawn inside it.
 */
export type ZoneHandle = "move" | "nw" | "ne" | "sw" | "se" | "radius";

/** The shapes a zone can be drawn as. */
export type ZoneShape = ScenarioZone["shape"];

/**
 * The id the selection marquee carries while it is being dragged out
 * (issue #2279).
 *
 * A marquee is not a zone and is never written to the document. It travels as
 * one because a rectangle dragged out on the ground is exactly what the zones
 * layer already draws, and the layer tells the two apart by this id.
 *
 * A plain string rather than a UUID, so it can never collide with a real zone's,
 * and here rather than beside the mode that makes it: the layer that draws it
 * has to recognise it, and this is the file both of them already share.
 */
export const MARQUEE_ZONE_ID = "marquee";

/** Whether this is the selection marquee rather than a zone. What decides
 *  between drawing a sheet of ground and drawing a box round a selection. */
export function isMarqueeZone(zone: ScenarioZone): boolean {
  return zone.id === MARQUEE_ZONE_ID;
}

/**
 * The key a drawn zone is picked by.
 *
 * The same namespace as unit placements, so one selection covers both, and
 * distinct from them: `parsePlacementKey` reads nothing that starts `zone:`,
 * and this reads nothing that does not.
 */
export function zoneKey(id: string, handle?: ZoneHandle): string {
  return handle ? `zone:${id}@${handle}` : `zone:${id}`;
}

/** The zone a key names and the part of it that was grabbed, or `null` when the
 *  key is not a zone's. */
export function parseZoneKey(
  key: string,
): { id: string; handle: ZoneHandle | null } | null {
  if (!key.startsWith("zone:")) return null;
  const rest = key.slice("zone:".length);
  if (!rest) return null;
  const at = rest.lastIndexOf("@");
  if (at <= 0) return { id: rest, handle: null };
  const handle = rest.slice(at + 1);
  const known: ZoneHandle[] = ["move", "nw", "ne", "sw", "se", "radius"];
  if (!known.includes(handle as ZoneHandle)) return null;
  return { id: rest.slice(0, at), handle: handle as ZoneHandle };
}

/** Whole elmos. The engine takes fractions, but an author never means 1023.9997. */
function round(pos: Point): Point {
  return { x: Math.round(pos.x), z: Math.round(pos.z) };
}

/**
 * Two corners put the right way round, exactly as the runtime puts them.
 *
 * The one piece of this file the runtime also has, so it is the one to keep an
 * eye on: `index` in `coilbox_zones.lua` takes the same two mins and two maxes.
 */
export function normaliseBox(a: Point, b: Point): { min: Point; max: Point } {
  return {
    min: { x: Math.min(a.x, b.x), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), z: Math.max(a.z, b.z) },
  };
}

/** A box held to the minimum size, grown about its own centre so a zone
 *  collapsed to nothing reappears where it was rather than at a corner. */
function atLeastMinimum(min: Point, max: Point): { min: Point; max: Point } {
  const grow = (lo: number, hi: number): [number, number] => {
    const short = MIN_ZONE_ELMOS - (hi - lo);
    if (short <= 0) return [lo, hi];
    return [lo - short / 2, hi + short / 2];
  };
  const [x0, x1] = grow(min.x, max.x);
  const [z0, z1] = grow(min.z, max.z);
  return { min: round({ x: x0, z: z0 }), max: round({ x: x1, z: z1 }) };
}

/**
 * The zone a drag across bare ground draws.
 *
 * A box goes corner to corner, which is how every selection rectangle works. A
 * circle goes out from its centre, because a circle has no corners and its
 * centre is the thing an author is aiming at.
 */
export function zoneFromDrag(
  shape: ZoneShape,
  from: Point,
  to: Point,
  id: string,
  name: string,
): ScenarioZone {
  if (shape === "circle") {
    const radius = Math.hypot(to.x - from.x, to.z - from.z);
    return {
      id,
      name,
      shape: "circle",
      center: round(from),
      radius: Math.round(Math.max(MIN_ZONE_ELMOS, radius)),
    };
  }
  const box = normaliseBox(from, to);
  return { id, name, shape: "box", ...atLeastMinimum(box.min, box.max) };
}

/**
 * The zone a single point puts down, centred on it at the default size.
 *
 * A drag has two points and names both a place and a size in one gesture. A
 * keyboard press at a cursor has only the one, so the size has to come from
 * somewhere else. This is what Enter draws in Zones mode (issue #2313): a
 * zone worth seeing and resizing afterwards, rather than one an author has to
 * size before it exists.
 */
export function zoneFromPoint(
  shape: ZoneShape,
  at: Point,
  id: string,
  name: string,
): ScenarioZone {
  const center = round(at);
  if (shape === "circle")
    return { id, name, shape: "circle", center, radius: DEFAULT_ZONE_ELMOS };
  const half = DEFAULT_ZONE_ELMOS / 2;
  return {
    id,
    name,
    shape: "box",
    min: round({ x: center.x - half, z: center.z - half }),
    max: round({ x: center.x + half, z: center.z + half }),
  };
}

/** The middle of a zone, which is where it is drawn from and what a drag of the
 *  whole thing moves. */
export function zoneCenter(zone: ScenarioZone): Point {
  if (zone.shape === "circle") return zone.center;
  return {
    x: (zone.min.x + zone.max.x) / 2,
    z: (zone.min.z + zone.max.z) / 2,
  };
}

/** How far a zone reaches from its centre along each axis, in elmos. */
export function zoneExtent(zone: ScenarioZone): {
  halfX: number;
  halfZ: number;
} {
  if (zone.shape === "circle")
    return { halfX: zone.radius, halfZ: zone.radius };
  return {
    halfX: (zone.max.x - zone.min.x) / 2,
    halfZ: (zone.max.z - zone.min.z) / 2,
  };
}

/** Where a resize handle sits, relative to the zone's centre, in elmos. */
export function zoneHandleOffset(
  zone: ScenarioZone,
  handle: ZoneHandle,
): Point | null {
  const { halfX, halfZ } = zoneExtent(zone);
  if (handle === "move") return { x: 0, z: 0 };
  if (zone.shape === "circle")
    return handle === "radius" ? { x: halfX, z: 0 } : null;
  switch (handle) {
    case "nw":
      return { x: -halfX, z: -halfZ };
    case "ne":
      return { x: halfX, z: -halfZ };
    case "sw":
      return { x: -halfX, z: halfZ };
    case "se":
      return { x: halfX, z: halfZ };
    default:
      return null;
  }
}

/** Every handle a zone offers, in the order it draws them. The move handle
 *  first, because it is the one every zone has. */
export function zoneHandles(zone: ScenarioZone): ZoneHandle[] {
  return zone.shape === "circle"
    ? ["move", "radius"]
    : ["move", "nw", "ne", "sw", "se"];
}

/**
 * A zone with a drag applied: the whole thing moved by the move handle or by no
 * handle at all, one corner or the radius moved by the handle that names it.
 *
 * Dragging a corner past its opposite flips the box rather than emptying it,
 * which is what normalising the corners means when it happens live.
 */
export function dragZone(
  zone: ScenarioZone,
  handle: ZoneHandle | null,
  delta: Point,
): ScenarioZone {
  const whole = !handle || handle === "move";
  if (zone.shape === "circle") {
    if (whole)
      return {
        ...zone,
        center: round({
          x: zone.center.x + delta.x,
          z: zone.center.z + delta.z,
        }),
      };
    // The handle sits one radius east of the centre, so where it lands is what
    // the new radius is, however far round the drag carried it.
    const radius = Math.hypot(zone.radius + delta.x, delta.z);
    return { ...zone, radius: Math.round(Math.max(MIN_ZONE_ELMOS, radius)) };
  }

  if (whole) {
    return {
      ...zone,
      min: round({ x: zone.min.x + delta.x, z: zone.min.z + delta.z }),
      max: round({ x: zone.max.x + delta.x, z: zone.max.z + delta.z }),
    };
  }

  const west = handle === "nw" || handle === "sw";
  const north = handle === "nw" || handle === "ne";
  const moved = {
    x: (west ? zone.min.x : zone.max.x) + delta.x,
    z: (north ? zone.min.z : zone.max.z) + delta.z,
  };
  const fixed = {
    x: west ? zone.max.x : zone.min.x,
    z: north ? zone.max.z : zone.min.z,
  };
  const box = normaliseBox(moved, fixed);
  return { ...zone, ...atLeastMinimum(box.min, box.max) };
}

/** Replace one zone by id, or drop it when the update returns null. The same
 *  list back when the id is not in it, so a caller can compare identities. */
function editZone(
  zones: ScenarioZone[],
  id: string,
  update: (zone: ScenarioZone) => ScenarioZone | null,
): ScenarioZone[] {
  const at = zones.findIndex((zone) => zone.id === id);
  if (at < 0) return zones;
  const next = update(zones[at]);
  if (next === zones[at]) return zones;
  const out = zones.slice();
  if (next === null) out.splice(at, 1);
  else out[at] = next;
  return out;
}

/** The document with the zone this key names moved or resized by `delta`. The
 *  same document back when the key names no zone it holds. */
export function moveZone(
  scenario: Scenario,
  key: string,
  delta: Point,
): Scenario {
  const ref = parseZoneKey(key);
  if (!ref) return scenario;
  const zones = editZone(scenario.zones, ref.id, (zone) =>
    dragZone(zone, ref.handle, delta),
  );
  return zones === scenario.zones ? scenario : { ...scenario, zones };
}

/**
 * The document with the zone this key names turned `steps` quarter turns about
 * `pivot`, as part of turning a whole selection as one shape (issue #2353).
 *
 * A zone does turn, which is the one thing about this that reads as a surprise.
 * It is an axis-aligned box, so it cannot face north-east, but a quarter turn
 * never asks it to: turn both corners and a box is still a box, with its width
 * and its height swapped. So a long thin zone laid east to west comes back laid
 * north to south, which is what turning the base it was drawn round should do
 * to it. A circle turns to itself and only its centre moves.
 *
 * Both corners are turned and then put back the right way round, because the
 * corner that was the north-west one is not after a quarter turn.
 */
export function turnZone(
  scenario: Scenario,
  key: string,
  pivot: Point,
  steps: number,
): Scenario {
  const ref = parseZoneKey(key);
  if (!ref) return scenario;
  const zones = editZone(scenario.zones, ref.id, (zone) => {
    if (zone.shape === "circle") {
      const center = round(turnedAbout(zone.center, pivot, steps));
      return { ...zone, center };
    }
    return {
      ...zone,
      ...normaliseBox(
        turnedAbout(zone.min, pivot, steps),
        turnedAbout(zone.max, pivot, steps),
      ),
    };
  });
  return zones === scenario.zones ? scenario : { ...scenario, zones };
}

/** Whether a heading makes a zone bigger or smaller. North and east grow it,
 *  south and west shrink it: the same sign for a box's two axes and a
 *  circle's one radius, so the rule is one an author only has to learn once. */
function growSign(heading: Heading): 1 | -1 {
  return heading === "north" || heading === "east" ? 1 : -1;
}

/**
 * A zone grown or shrunk by `step` elmos in the direction named, held to the
 * minimum size the same way a drag is (issue #2313).
 *
 * A box answers on one axis at a time: north and south change its height,
 * east and west its width, each about the zone's own centre so the edge that
 * was not asked for does not wander. A circle has one size, its radius, and
 * every heading answers to that.
 *
 * The same zone back, not a new copy of the same numbers, when the size a
 * heading asks for is the size it already has, so a press held at the floor
 * changes nothing rather than nothing an author can tell apart from a change.
 */
function growZone(
  zone: ScenarioZone,
  heading: Heading,
  step: number,
): ScenarioZone {
  const sign = growSign(heading);
  if (zone.shape === "circle") {
    const radius = Math.round(
      Math.max(MIN_ZONE_ELMOS, zone.radius + sign * step),
    );
    return radius === zone.radius ? zone : { ...zone, radius };
  }
  const axis: "x" | "z" =
    heading === "north" || heading === "south" ? "z" : "x";
  const lo = axis === "z" ? zone.min.z : zone.min.x;
  const hi = axis === "z" ? zone.max.z : zone.max.x;
  const half = (hi - lo) / 2;
  const nextHalf = Math.max(MIN_ZONE_ELMOS / 2, half + sign * step);
  if (nextHalf === half) return zone;
  const mid = (lo + hi) / 2;
  const nextLo = Math.round(mid - nextHalf);
  const nextHi = Math.round(mid + nextHalf);
  return axis === "z"
    ? {
        ...zone,
        min: { ...zone.min, z: nextLo },
        max: { ...zone.max, z: nextHi },
      }
    : {
        ...zone,
        min: { ...zone.min, x: nextLo },
        max: { ...zone.max, x: nextHi },
      };
}

/** The document with the zone this key names grown or shrunk `step` elmos in
 *  the direction named. The same document back when the key names no zone it
 *  holds, or when the change asked for is no change at all. */
export function resizeZone(
  scenario: Scenario,
  key: string,
  heading: Heading,
  step: number,
): Scenario {
  const ref = parseZoneKey(key);
  if (!ref) return scenario;
  const zones = editZone(scenario.zones, ref.id, (zone) =>
    growZone(zone, heading, step),
  );
  return zones === scenario.zones ? scenario : { ...scenario, zones };
}

/** The document with one more zone on it. */
export function addZone(scenario: Scenario, zone: ScenarioZone): Scenario {
  return { ...scenario, zones: [...scenario.zones, zone] };
}

/** The document with a zone renamed. An empty name is refused: a zone is picked
 *  by name in the trigger panel, and one with no name cannot be. No trigger is
 *  rewritten, because a `zoneId` parameter holds the zone's minted id and this
 *  changes only what the author reads (issue #913). */
export function renameZone(
  scenario: Scenario,
  id: string,
  name: string,
): Scenario {
  const trimmed = name.trim();
  if (!trimmed) return scenario;
  const zones = editZone(scenario.zones, id, (zone) => ({
    ...zone,
    name: trimmed,
  }));
  return zones === scenario.zones ? scenario : { ...scenario, zones };
}

/** The document without a zone. Triggers naming it are left alone: the runtime
 *  says so at load rather than silently testing nothing, and an author who
 *  deleted the wrong zone would not want their triggers rewritten. */
export function removeZone(scenario: Scenario, id: string): Scenario {
  const zones = scenario.zones.filter((zone) => zone.id !== id);
  return zones.length === scenario.zones.length
    ? scenario
    : { ...scenario, zones };
}

/** The name a newly drawn zone gets: the first "Zone n" no zone already has, so
 *  drawing several in a row does not make several called the same thing. */
export function nextZoneName(zones: ScenarioZone[]): string {
  const taken = new Set(zones.map((zone) => zone.name));
  for (let n = 1; ; n++) {
    const name = `Zone ${n}`;
    if (!taken.has(name)) return name;
  }
}
