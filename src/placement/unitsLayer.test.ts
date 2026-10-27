/**
 * What the units layer says about its own redraws (issue #1516).
 *
 * Drawing a model is three.js and is not tested. The announcement is, because
 * the selection ring hung off a guess about when the objects would be there: the
 * layer empties itself the moment an edit lands and refills over the next few
 * frames, so anything that looked in between found nothing and had no reason to
 * look again. The ring went after every edit and stayed gone.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { TerrainStep } from "@/blueprint/model";
import type { MapScene3D } from "@/lib/mapScene";
import type { Placement } from "./placements";
import { flatSource, Relief } from "./terrainRelief";
import { createUnitsLayer, type UnitsLayerDeps } from "./unitsLayer";

/** Enough of a scene to hang objects off. Nothing here renders. */
function scene(): MapScene3D {
  return {
    scene: new THREE.Scene(),
    scale: 1,
    render: () => {},
  } as unknown as MapScene3D;
}

/** A layer drawing marker boxes: no unit has a model, so nothing is read off
 *  disk and every draw still takes the async path a real one does. */
function layer(over: Partial<UnitsLayerDeps> = {}) {
  return createUnitsLayer({
    handle: scene(),
    field: { width: 1, height: 1, samples: Float32Array.of(0) },
    worldWidth: 512,
    worldHeight: 512,
    minHeight: 0,
    maxHeight: 0,
    objectName: () => undefined,
    loadModels: () => Promise.reject(new Error("no models in a test")),
    teamColor: () => [1, 1, 1],
    ...over,
  });
}

function building(index: number): Placement {
  return {
    key: `base:pf1#${index}`,
    kind: "base",
    id: "pf1",
    index,
    def: "armsolar",
    team: "p0",
    pos: { x: 100 + index * 64, z: 100 },
    facing: 0,
  };
}

describe("a units layer's model reads", () => {
  it("asks for every fresh unit type's model in one read", async () => {
    const asked: string[][] = [];
    const drawn = layer({
      objectName: (def) => `${def}.s3o`,
      loadModels: (objects) => {
        asked.push(objects);
        return Promise.resolve(
          new Map(objects.map((object) => [object, null])),
        );
      },
    });
    await drawn.draw([
      building(0),
      building(1),
      { ...building(2), key: "base:pf1#2", def: "armwin" },
    ]);
    expect(asked).toEqual([["armsolar.s3o", "armwin.s3o"]]);
  });

  it("counts each unit type as it stands up", async () => {
    const progress: [number, number][] = [];
    const drawn = layer({
      objectName: (def) => `${def}.s3o`,
      loadModels: (objects) =>
        Promise.resolve(new Map(objects.map((object) => [object, null]))),
      onProgress: (done, total) => progress.push([done, total]),
    });
    await drawn.draw([
      building(0),
      { ...building(1), key: "base:pf1#1", def: "armwin" },
    ]);
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it("asks nothing for a unit type it has already built", async () => {
    let asks = 0;
    const drawn = layer({
      objectName: (def) => `${def}.s3o`,
      loadModels: (objects) => {
        asks++;
        return Promise.resolve(
          new Map(objects.map((object) => [object, null])),
        );
      },
    });
    await drawn.draw([building(0)]);
    await drawn.draw([building(0), building(1)]);
    expect(asks).toBe(1);
  });
});

describe("a units layer's redraws", () => {
  it("has no object for a unit whose model it has not read yet", async () => {
    const units = layer();
    await units.draw([building(0)]);
    const filling = units.draw([building(0), building(1)]);
    expect(units.objects.size).toBe(1);
    await filling;
    expect(units.objects.size).toBe(2);
  });

  /**
   * Issue #1716. A redraw is not a rebuild: whatever is standing where the new
   * pass wants it stays standing, and only its key can have changed.
   *
   * Without this an edit to one building is an arrival for every one of them,
   * so all of them play the animation a unit plays when it is put down. React
   * runs every effect twice in development, so the pass that lost the map was
   * running on every edit.
   */
  it("leaves the units an edit did not touch standing where they were", async () => {
    const units = layer();
    await units.draw([building(0)]);
    const was = units.objects.get(building(0).key);
    await units.draw([building(0), building(1)]);
    expect(units.objects.get(building(0).key)).toBe(was);
  });

  it("stands a unit up once for two passes over the same document", async () => {
    const units = layer();
    const first = units.draw([building(0)]);
    const second = units.draw([building(0)]);
    await Promise.all([first, second]);
    expect(units.root.children).toHaveLength(1);
  });

  /**
   * Issue #1716, and the whole of why an edit used to animate everything.
   *
   * The blueprint editor builds its document afresh on every edit, so every
   * building's team id changes on every edit while the colour it is painted in
   * stays exactly what it was. A drawn unit is recognised by that colour rather
   * than by the id, because the colour is what decides whether two placements
   * can share a model and the id is not about the unit at all.
   */
  it("keeps a unit whose team was reminted in the same colour", async () => {
    const units = layer();
    await units.draw([building(0)]);
    const was = units.objects.get(building(0).key);
    await units.draw([{ ...building(0), team: "p7" }]);
    expect(units.objects.get(building(0).key)).toBe(was);
    expect(units.root.children).toHaveLength(1);
  });

  /** Issue #1716. A building dragged across the map is the same building, so it
   *  moves rather than vanishing at one square and appearing at another. */
  it("moves a unit rather than replacing it", async () => {
    const units = layer();
    await units.draw([building(0)]);
    const was = units.objects.get(building(0).key);
    const moved = { ...building(0), pos: { x: 800, z: 800 } };
    await units.draw([moved]);
    expect(units.objects.get(moved.key)).toBe(was);
    expect(units.root.children).toHaveLength(1);
  });

  /**
   * Issue #1716. A base's buildings are keyed by their place in its list, so
   * deleting the second of five renumbers the three after it. The ones that did
   * not move must keep standing where they are: what goes is the one that went.
   */
  it("keeps the units a delete renumbered standing where they were", async () => {
    const units = layer();
    await units.draw([building(0), building(1), building(2)]);
    const last = units.objects.get(building(2).key);
    // The third building under the second's key, which is what the document
    // looks like once the second is deleted.
    const after = [building(0), { ...building(2), key: building(1).key }];
    await units.draw(after);
    expect(units.objects.get(building(1).key)).toBe(last);
  });

  it("tells a watcher once its objects are there", async () => {
    const units = layer();
    const seen: number[] = [];
    const stop = units.onDrawn(() => seen.push(units.objects.size));
    await units.draw([building(0), building(1)]);
    expect(seen).toEqual([2]);
    stop();
    await units.draw([building(0)]);
    expect(seen).toEqual([2]);
  });

  it("says nothing for a pass a later draw abandoned", async () => {
    const units = layer();
    const seen: number[] = [];
    units.onDrawn(() => seen.push(units.objects.size));
    const first = units.draw([building(0)]);
    const second = units.draw([building(0), building(1)]);
    await Promise.all([first, second]);
    expect(seen).toEqual([2]);
  });
});

describe("a units layer on ground a terrain step raised (issue #4794)", () => {
  const wall = (height: number): TerrainStep => ({
    kind: "raise",
    shape: "wall",
    points: [
      { x: -64, z: 0 },
      { x: 64, z: 0 },
    ],
    height,
    before: 0,
  });
  const AT = { x: 256, z: 256 };
  const on = (x: number, z: number): Placement => ({
    ...building(0),
    pos: { x, z },
  });

  /** The layer reads the relief's own field with a range of 0 to 1, which is
   *  how `useScenarioUnits` hands it over. */
  function standing(relief: Relief) {
    const handle = scene();
    const drawn = createUnitsLayer({
      handle,
      field: relief.field,
      worldWidth: 512,
      worldHeight: 512,
      minHeight: 0,
      maxHeight: 1,
      objectName: () => undefined,
      loadModels: () => Promise.reject(new Error("no models in a test")),
      teamColor: () => [1, 1, 1],
    });
    return { drawn, handle };
  }
  const heightOf = (drawn: ReturnType<typeof standing>["drawn"]) =>
    drawn.objects.get("base:pf1#0")?.position.y;

  it("stands a building on a raised wall at the wall's height", async () => {
    const relief = new Relief(flatSource(65, 65));
    relief.update([wall(80)], { at: AT, quarters: 0 }, []);
    const { drawn } = standing(relief);
    await drawn.draw([on(256, 256)]);
    expect(heightOf(drawn)).toBeCloseTo(80, 3);
  });

  it("stands a building on flat ground beside the wall on the floor", async () => {
    const relief = new Relief(flatSource(65, 65));
    relief.update([wall(80)], { at: AT, quarters: 0 }, []);
    const { drawn } = standing(relief);
    await drawn.draw([on(40, 40)]);
    expect(heightOf(drawn)).toBeCloseTo(0, 3);
  });

  it("stands a building in a trench at the trench's depth", async () => {
    const relief = new Relief(flatSource(65, 65));
    relief.update([wall(-50)], { at: AT, quarters: 0 }, []);
    const { drawn } = standing(relief);
    await drawn.draw([on(256, 256)]);
    expect(heightOf(drawn)).toBeCloseTo(-50, 3);
  });

  it("moves a building with the ground when it changes under it", async () => {
    const relief = new Relief(flatSource(65, 65));
    const { drawn } = standing(relief);
    await drawn.draw([on(256, 256)]);
    expect(heightOf(drawn)).toBeCloseTo(0, 3);
    relief.update([wall(80)], { at: AT, quarters: 0 }, []);
    drawn.restand();
    expect(heightOf(drawn)).toBeCloseTo(80, 3);
    relief.update([], { at: AT, quarters: 0 }, []);
    drawn.restand();
    expect(heightOf(drawn)).toBeCloseTo(0, 3);
  });
});
