import { describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import type { Scenario, ScenarioZone } from "../../model";
import {
  addZone,
  dragZone,
  MIN_ZONE_ELMOS,
  moveZone,
  nextZoneName,
  normaliseBox,
  parseZoneKey,
  removeZone,
  renameZone,
  zoneCenter,
  zoneExtent,
  zoneFromDrag,
  zoneHandleOffset,
  zoneHandles,
  zoneKey,
} from "./zones";

const box: ScenarioZone = {
  id: "z1",
  name: "Landing site",
  shape: "box",
  min: { x: 100, z: 200 },
  max: { x: 500, z: 600 },
};

const circle: ScenarioZone = {
  id: "z2",
  name: "Perimeter",
  shape: "circle",
  center: { x: 1000, z: 1000 },
  radius: 300,
};

function document(): Scenario {
  return { ...newScenario("test"), zones: [box, circle] };
}

describe("zoneKey", () => {
  it("names a zone and one of its handles", () => {
    expect(zoneKey("z1")).toBe("zone:z1");
    expect(zoneKey("z1", "se")).toBe("zone:z1@se");
  });

  it("round-trips through parseZoneKey", () => {
    expect(parseZoneKey(zoneKey("z1"))).toEqual({ id: "z1", handle: null });
    expect(parseZoneKey(zoneKey("z1", "nw"))).toEqual({
      id: "z1",
      handle: "nw",
    });
    expect(parseZoneKey(zoneKey("z2", "radius"))).toEqual({
      id: "z2",
      handle: "radius",
    });
  });

  it("reads nothing that is not a zone's", () => {
    expect(parseZoneKey("actor:a1")).toBeNull();
    expect(parseZoneKey("group:g1#2")).toBeNull();
    expect(parseZoneKey("zone:")).toBeNull();
    expect(parseZoneKey("zone:z1@middle")).toBeNull();
  });

  it("names the handle that moves a whole zone", () => {
    expect(zoneKey("z1", "move")).toBe("zone:z1@move");
    expect(parseZoneKey("zone:z1@move")).toEqual({ id: "z1", handle: "move" });
  });
});

describe("normaliseBox", () => {
  // The runtime's `index` in coilbox_zones.lua takes the same two mins and two
  // maxes, so a box drawn either way round means the same area in both.
  it("puts corners the right way round", () => {
    expect(normaliseBox({ x: 500, z: 600 }, { x: 100, z: 200 })).toEqual({
      min: { x: 100, z: 200 },
      max: { x: 500, z: 600 },
    });
  });

  it("mixes the axes independently", () => {
    expect(normaliseBox({ x: 500, z: 200 }, { x: 100, z: 600 })).toEqual({
      min: { x: 100, z: 200 },
      max: { x: 500, z: 600 },
    });
  });

  it("leaves an already ordered box alone", () => {
    expect(normaliseBox(box.min, box.max)).toEqual({
      min: box.min,
      max: box.max,
    });
  });
});

describe("zoneFromDrag", () => {
  it("draws a box corner to corner", () => {
    const drawn = zoneFromDrag(
      "box",
      { x: 100, z: 200 },
      { x: 500, z: 600 },
      "new",
      "Zone 1",
    );
    expect(drawn).toEqual({
      id: "new",
      name: "Zone 1",
      shape: "box",
      min: { x: 100, z: 200 },
      max: { x: 500, z: 600 },
    });
  });

  it("normalises a box dragged up and to the left", () => {
    const drawn = zoneFromDrag(
      "box",
      { x: 500, z: 600 },
      { x: 100, z: 200 },
      "new",
      "Zone 1",
    );
    expect(drawn).toMatchObject({
      min: { x: 100, z: 200 },
      max: { x: 500, z: 600 },
    });
  });

  it("draws a circle out from its centre", () => {
    const drawn = zoneFromDrag(
      "circle",
      { x: 1000, z: 1000 },
      { x: 1300, z: 1400 },
      "new",
      "Zone 1",
    );
    expect(drawn).toEqual({
      id: "new",
      name: "Zone 1",
      shape: "circle",
      center: { x: 1000, z: 1000 },
      radius: 500,
    });
  });

  it("holds a tiny drag to the minimum size", () => {
    const tiny = zoneFromDrag(
      "box",
      { x: 100, z: 100 },
      { x: 104, z: 102 },
      "n",
      "Z",
    );
    expect(tiny).toMatchObject({ shape: "box" });
    if (tiny.shape !== "box") throw new Error("expected a box");
    expect(tiny.max.x - tiny.min.x).toBe(MIN_ZONE_ELMOS);
    expect(tiny.max.z - tiny.min.z).toBe(MIN_ZONE_ELMOS);
    // Grown about the middle of the drag, so it appears where it was drawn.
    expect(zoneCenter(tiny)).toEqual({ x: 102, z: 101 });

    const dot = zoneFromDrag(
      "circle",
      { x: 500, z: 500 },
      { x: 502, z: 500 },
      "n",
      "Z",
    );
    expect(dot).toMatchObject({ radius: MIN_ZONE_ELMOS });
  });
});

describe("zone geometry", () => {
  it("measures a box from its middle", () => {
    expect(zoneCenter(box)).toEqual({ x: 300, z: 400 });
    expect(zoneExtent(box)).toEqual({ halfX: 200, halfZ: 200 });
  });

  it("measures a circle from its centre", () => {
    expect(zoneCenter(circle)).toEqual({ x: 1000, z: 1000 });
    expect(zoneExtent(circle)).toEqual({ halfX: 300, halfZ: 300 });
  });

  it("offers a move handle, four corners on a box and one radius on a circle", () => {
    expect(zoneHandles(box)).toEqual(["move", "nw", "ne", "sw", "se"]);
    expect(zoneHandles(circle)).toEqual(["move", "radius"]);
  });

  it("puts the move handle in the middle of either shape", () => {
    expect(zoneHandleOffset(box, "move")).toEqual({ x: 0, z: 0 });
    expect(zoneHandleOffset(circle, "move")).toEqual({ x: 0, z: 0 });
  });

  it("puts each handle on the corner it names, with north at the lower z", () => {
    expect(zoneHandleOffset(box, "nw")).toEqual({ x: -200, z: -200 });
    expect(zoneHandleOffset(box, "se")).toEqual({ x: 200, z: 200 });
    expect(zoneHandleOffset(box, "ne")).toEqual({ x: 200, z: -200 });
    expect(zoneHandleOffset(box, "sw")).toEqual({ x: -200, z: 200 });
    expect(zoneHandleOffset(circle, "radius")).toEqual({ x: 300, z: 0 });
    expect(zoneHandleOffset(circle, "nw")).toBeNull();
  });
});

describe("dragZone", () => {
  it("moves a whole box", () => {
    expect(dragZone(box, null, { x: 50, z: -25 })).toMatchObject({
      min: { x: 150, z: 175 },
      max: { x: 550, z: 575 },
    });
  });

  it("moves a whole circle", () => {
    expect(dragZone(circle, null, { x: -100, z: 40 })).toMatchObject({
      center: { x: 900, z: 1040 },
      radius: 300,
    });
  });

  it("moves a whole zone through the move handle", () => {
    // The same as no handle at all: the sheet is not what a drag grabs any
    // more, so the handle at the middle is what says "move all of this".
    expect(dragZone(box, "move", { x: 50, z: -25 })).toEqual(
      dragZone(box, null, { x: 50, z: -25 }),
    );
    expect(dragZone(circle, "move", { x: -100, z: 40 })).toMatchObject({
      center: { x: 900, z: 1040 },
      radius: 300,
    });
  });

  it("moves one corner and leaves the opposite one", () => {
    expect(dragZone(box, "se", { x: 100, z: 100 })).toMatchObject({
      min: { x: 100, z: 200 },
      max: { x: 600, z: 700 },
    });
    expect(dragZone(box, "nw", { x: 100, z: 100 })).toMatchObject({
      min: { x: 200, z: 300 },
      max: { x: 500, z: 600 },
    });
    expect(dragZone(box, "ne", { x: -50, z: 50 })).toMatchObject({
      min: { x: 100, z: 250 },
      max: { x: 450, z: 600 },
    });
  });

  it("flips a corner dragged past its opposite rather than emptying the box", () => {
    // The nw corner carried 600 east and 600 south lands beyond se, so the box
    // is now on the other side of the corner that stayed put.
    expect(dragZone(box, "nw", { x: 600, z: 600 })).toMatchObject({
      min: { x: 500, z: 600 },
      max: { x: 700, z: 800 },
    });
  });

  it("holds a corner drag to the minimum size", () => {
    const squashed = dragZone(box, "se", { x: -400, z: -400 });
    if (squashed.shape !== "box") throw new Error("expected a box");
    expect(squashed.max.x - squashed.min.x).toBe(MIN_ZONE_ELMOS);
    expect(squashed.max.z - squashed.min.z).toBe(MIN_ZONE_ELMOS);
  });

  it("resizes a circle by where its handle lands", () => {
    // The handle starts one radius east, so dragging it 100 further east is a
    // radius 100 bigger.
    expect(dragZone(circle, "radius", { x: 100, z: 0 })).toMatchObject({
      radius: 400,
    });
    // Carried off the axis, the radius is still the distance from the centre.
    expect(dragZone(circle, "radius", { x: 100, z: 300 })).toMatchObject({
      radius: 500,
    });
    // Dragged almost onto the centre, the circle stops at the smallest one
    // still worth having rather than becoming a point.
    expect(dragZone(circle, "radius", { x: -290, z: 0 })).toMatchObject({
      radius: MIN_ZONE_ELMOS,
    });
  });
});

describe("moveZone", () => {
  it("moves the zone a key names", () => {
    const next = moveZone(document(), zoneKey("z1"), { x: 10, z: 10 });
    expect(next.zones[0]).toMatchObject({
      min: { x: 110, z: 210 },
      max: { x: 510, z: 610 },
    });
    expect(next.zones[1]).toEqual(circle);
  });

  it("moves through the move handle's key", () => {
    const next = moveZone(document(), zoneKey("z1", "move"), { x: 10, z: 10 });
    expect(next.zones[0]).toMatchObject({
      min: { x: 110, z: 210 },
      max: { x: 510, z: 610 },
    });
  });

  it("resizes through a handle key", () => {
    const next = moveZone(document(), zoneKey("z2", "radius"), {
      x: 200,
      z: 0,
    });
    expect(next.zones[1]).toMatchObject({ radius: 500 });
  });

  it("hands back the same document when the key names nothing", () => {
    const before = document();
    expect(moveZone(before, "zone:nope", { x: 10, z: 10 })).toBe(before);
    expect(moveZone(before, "actor:a1", { x: 10, z: 10 })).toBe(before);
  });
});

describe("addZone, renameZone and removeZone", () => {
  it("appends a zone", () => {
    const next = addZone(document(), {
      id: "z3",
      name: "Zone 3",
      shape: "box",
      min: { x: 0, z: 0 },
      max: { x: 64, z: 64 },
    });
    expect(next.zones.map((z) => z.id)).toEqual(["z1", "z2", "z3"]);
  });

  it("renames a zone, trimming what was typed", () => {
    const next = renameZone(document(), "z1", "  Drop point  ");
    expect(next.zones[0].name).toBe("Drop point");
  });

  it("refuses an empty name and an unknown id", () => {
    const before = document();
    expect(renameZone(before, "z1", "   ")).toBe(before);
    expect(renameZone(before, "nope", "Anything")).toBe(before);
  });

  it("removes a zone", () => {
    expect(removeZone(document(), "z1").zones.map((z) => z.id)).toEqual(["z2"]);
    const before = document();
    expect(removeZone(before, "nope")).toBe(before);
  });
});

describe("nextZoneName", () => {
  it("counts up from one", () => {
    expect(nextZoneName([])).toBe("Zone 1");
  });

  it("skips names already taken", () => {
    expect(
      nextZoneName([
        { ...box, name: "Zone 1" },
        { ...circle, name: "Zone 2" },
      ]),
    ).toBe("Zone 3");
  });

  it("ignores names that are not counted ones", () => {
    expect(nextZoneName([{ ...box, name: "Landing site" }])).toBe("Zone 1");
  });
});
