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

import type { MapScene3D } from "@/lib/mapScene";
import type { Placement } from "./placements";
import { createUnitsLayer } from "./unitsLayer";

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
function layer() {
  return createUnitsLayer({
    handle: scene(),
    field: { width: 1, height: 1, samples: Float32Array.of(0) },
    worldWidth: 512,
    worldHeight: 512,
    minHeight: 0,
    maxHeight: 0,
    objectName: () => undefined,
    loadModel: () => Promise.reject(new Error("no models in a test")),
    teamColor: () => [1, 1, 1],
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
