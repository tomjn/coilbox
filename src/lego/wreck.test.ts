import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { WRECK_POSE } from "./animPresets";
import { type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { buildS3o, type S3oPiece, type UnitBounds } from "./s3oBuild";
import { legoUnitDef, wreckName } from "./unitDef";
import {
  buildWreck,
  buildWreckFeature,
  WRECK_SHARE,
  wreckFeatureDef,
  wreckFeaturePath,
  wreckModelPath,
  wreckPose,
} from "./wreck";

/** One part: a triangle on the x/z plane, one elmo out along x and z. */
function pack(): LoadedPack {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 0, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [part],
    byId: new Map([["tri", part]]),
    vertices: new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  };
}

/** A body with a triangle, and a turret on it two elmos up. */
function tank(animations?: LegoProject["animations"]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Tank",
    unitName: "tank",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    animations,
    pieces: [
      ...base.pieces.map((piece) => ({
        ...piece,
        partId: "tri",
        role: "base",
      })),
      {
        id: "turret",
        name: "turret",
        parentId: "root",
        partId: "tri",
        position: [0, 2, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        role: "turret",
      },
    ],
  };
}

const posed = (tilt: number, sink: number) =>
  tank([{ presetId: WRECK_POSE.id, params: { tilt, sink } }]);

const BOUNDS: UnitBounds = { mid: [0, 0, 0], sizeX: 40, sizeY: 10, sizeZ: 20 };
const TOTALS = { health: 900, metal: 151, energy: 30, buildTime: 200, mass: 0 };

function round(values: number[]): number[] {
  return values.map((n) => Number(n.toFixed(5)) + 0);
}

function turret(root: S3oPiece): S3oPiece {
  const found = root.children.find((piece) => piece.name === "turret");
  if (!found) throw new Error("no turret");
  return found;
}

describe("wreck names", () => {
  it("names the wreck after the unit the way Splinter Faction does", () => {
    // Splinter Faction's `alldefs_post.lua` defaults a unit's
    // `customparams.corpse` to `<unitname>_dead`, and its
    // `featuredefs_post.lua` makes a wreck by that name for a unit without one.
    expect(wreckName("tank")).toBe("tank_dead");
  });

  it("keeps the model and the feature file in coilbox folders", () => {
    expect(wreckModelPath("tank")).toBe("objects3d/coilbox/tank_dead.s3o");
    expect(wreckFeaturePath("tank")).toBe("features/coilbox/tank_dead.lua");
  });
});

describe("wreckPose", () => {
  it("poses nothing without the wreck pose preset", () => {
    expect(wreckPose(tank()).size).toBe(0);
  });

  it("poses the body with the preset's own track", () => {
    const pose = wreckPose(posed(30, 2));
    expect([...pose.keys()]).toEqual(["root"]);
    expect(pose.get("root")).toEqual(
      WRECK_POSE.track(0, { tilt: 30, sink: 2 }, "base"),
    );
  });
});

describe("the wreck model", () => {
  it("is the unit at rest when no pose is applied", () => {
    const unit = buildS3o(tank(), pack(), null, { texture1: "a.png" });
    const wreck = buildS3o(
      tank(),
      pack(),
      null,
      { texture1: "a.png" },
      {
        pose: wreckPose(tank()),
      },
    );
    expect(wreck?.root).toEqual(unit?.root);
  });

  it("bakes the sink and the tilt into the body and everything on it", () => {
    const wreck = buildS3o(
      posed(90, 2),
      pack(),
      null,
      { texture1: "a.png" },
      {
        pose: wreckPose(posed(90, 2)),
      },
    );
    if (!wreck) throw new Error("no build");
    // Sunk two elmos.
    expect(round(wreck.root.offset)).toEqual([0, -2, 0]);
    // A quarter turn about z takes +x to +y.
    expect(round(wreck.root.vertices[1].pos)).toEqual([0, 1, 0]);
    expect(round(wreck.root.vertices[0].normal)).toEqual([-1, 0, 0]);
    // The turret turns with the body: two up becomes two along -x.
    expect(round(turret(wreck.root).offset)).toEqual([-2, 0, 0]);
    expect(round(turret(wreck.root).vertices[1].pos)).toEqual([0, 1, 0]);
  });

  it("is measured again rather than keeping the unit's header", () => {
    const wreck = buildS3o(
      posed(90, 0),
      pack(),
      null,
      { texture1: "a.png" },
      {
        pose: wreckPose(posed(90, 0)),
      },
    );
    // Lying on its side, nothing is above the turret's triangle at y = 1.
    expect(wreck?.height).toBeCloseTo(1, 5);
  });
});

describe("wreckFeatureDef", () => {
  const def = legoUnitDef(tank(), BOUNDS, "def", TOTALS);

  it("is worth half the unit's metal and health", () => {
    // Splinter Faction's `featuredefs_post.lua` takes half of each, rounded down.
    expect(WRECK_SHARE).toBe(0.5);
    const feature = wreckFeatureDef(tank(), def);
    expect(feature.metal).toBe(75);
    expect(feature.damage).toBe(450);
    expect(feature.energy).toBe(0);
  });

  it("draws the wreck model and covers the unit's footprint", () => {
    const feature = wreckFeatureDef(tank(), def);
    // With the extension: Splinter Faction drops a feature whose
    // `objects3d/<object>` is not a file, trying only `.3do` beside it.
    expect(feature.object).toBe("coilbox/tank_dead.s3o");
    expect(feature.footprintX).toBe(def.footprintx);
    expect(feature.footprintZ).toBe(def.footprintz);
    expect(feature.reclaimable).toBe(true);
    expect(feature.category).toBe("corpses");
    expect(feature.description).toBe("Tank wreckage");
  });

  it("blocks the ground only where a building stood", () => {
    expect(wreckFeatureDef(tank(), def).blocking).toBe(true);
    const mobile = {
      ...tank(),
      movement: { moveClass: "TANK2", speed: 60 },
    };
    const moving = legoUnitDef(mobile, BOUNDS, "def", TOTALS);
    expect(wreckFeatureDef(mobile, moving).blocking).toBe(false);
  });
});

describe("buildWreckFeature", () => {
  it("is a features file the engine's loader takes", () => {
    const def = legoUnitDef(tank(), BOUNDS, "def", TOTALS);
    const lua = buildWreckFeature(tank(), def);
    const result = spawnSync(
      "luajit",
      [
        "-e",
        "local f = assert(loadstring(io.read('*a'))) local t = f() " +
          "local w = t.tank_dead " +
          "io.write(w.object, ' ', w.metal, ' ', w.damage, ' ', tostring(w.blocking))",
      ],
      { input: lua },
    );
    expect(result.stderr?.toString() ?? "").toBe("");
    expect(result.stdout.toString()).toBe("coilbox/tank_dead.s3o 75 450 true");
  });
});

describe("buildWreck", () => {
  it("builds the posed model and the file that names it", () => {
    const project = posed(12, 0.15);
    const def = legoUnitDef(project, BOUNDS, "def", TOTALS);
    const wreck = buildWreck(project, pack(), null, { texture1: "a.png" }, def);
    expect(wreck?.model.texture1).toBe("a.png");
    expect(wreck?.feature).toContain('object = "coilbox/tank_dead.s3o"');
  });
});
