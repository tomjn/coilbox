import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { presetById, ROLES } from "./animPresets";
import { buildArmModule, pickArmParts } from "./buildArm";
import { pieceConnectors } from "./connectors";
import { type LegoProject, newProject, parseLegoProjectJson } from "./model";
import { STARTER_CATEGORIES, swapCandidates } from "./moduleFilter";
import { insertModule } from "./moduleMount";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { worldMatrix } from "./reparent";
import {
  isBuiltInModule,
  ownCopy,
  starterModules,
  withStarters,
} from "./starterModules";
import { swapModule } from "./swapModule";
import { buildWeaponModule, pickWeaponParts } from "./weaponModule";

const bundled = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../src-tauri/legoparts/pack.json", import.meta.url),
    ),
    "utf8",
  ),
) as LegoPackManifest;

function loaded(manifest: LegoPackManifest = bundled): LoadedPack {
  const merged = mergePacks([
    { manifest, vertices: new Float32Array(), indices: new Uint16Array() },
  ]);
  return {
    ...merged,
    library: { packs: [manifest], atlases: [], dir: "", problems: [] },
  };
}

const pack = loaded();
const starters = starterModules(pack);

function named(name: string): LegoProject {
  const module = starters.find((m) => m.name === name);
  if (!module) throw new Error(`no starter called ${name}`);
  return module;
}

/** A hull to drop modules on: one bundled block, 2 wide, 1 high, 3 long. */
function hull(): LegoProject {
  const base = newProject({
    id: "unit",
    rootPieceId: "root",
    name: "tank",
    packId: bundled.id,
    packVersion: bundled.version,
    now: "2026-10-17T00:00:00.000Z",
  });
  return {
    ...base,
    pieces: [{ ...base.pieces[0], partId: "d2c111537495" }],
  };
}

let counter = 0;
const newId = () => `new${counter++}`;

/** Where a piece's own x axis points in the module or unit. */
function xAxis(project: LegoProject, pieceId: string): THREE.Vector3 {
  const rotation = new THREE.Quaternion();
  worldMatrix(project, pieceId).decompose(
    new THREE.Vector3(),
    rotation,
    new THREE.Vector3(),
  );
  return new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
}

describe("starterModules", () => {
  it("ships the wheel, axle, turret, legs, build arm and chassis sections", () => {
    expect(starters.map((m) => m.name)).toEqual([
      "Wheel",
      "Axle with two wheels",
      "Turret",
      "Leg",
      "Pair of legs",
      "Build arm",
      "Hull section",
      "Long hull section",
      "Deck plate",
    ]);
  });

  it("gives every module a fixed built in id, a category, tags and a mount", () => {
    const ids = new Set<string>();
    for (const module of starters) {
      expect(isBuiltInModule(module)).toBe(true);
      ids.add(module.id);
      expect(STARTER_CATEGORIES).toContain(module.category);
      expect(module.tags?.length ?? 0).toBeGreaterThan(0);
      const mount = module.mount;
      expect(mount).toBeDefined();
      const piece = module.pieces.find((p) => p.id === mount?.piece);
      expect(piece).toBeDefined();
      if (!piece) continue;
      expect(
        pieceConnectors(pack, piece).map((connector) => connector.id),
      ).toContain(mount?.connector);
    }
    expect(ids.size).toBe(starters.length);
  });

  it("is built the same way every time, so its ids and pieces are stable", () => {
    expect(starterModules(loaded())).toEqual(starters);
  });

  it("builds only from bundled parts, with roles and presets the builder knows", () => {
    const roles = new Set(ROLES.map((role) => role.id));
    for (const module of starters) {
      for (const piece of module.pieces) {
        if (piece.partId) expect(pack.byId.has(piece.partId)).toBe(true);
        if (piece.role) expect(roles.has(piece.role)).toBe(true);
      }
      for (const applied of module.animations ?? []) {
        expect(presetById(applied.presetId)).toBeDefined();
      }
    }
  });

  it("reads back through the document parser unchanged", () => {
    for (const module of starters) {
      const json = JSON.stringify(module);
      expect(parseLegoProjectJson(json)).toEqual(JSON.parse(json));
    }
  });

  it("leaves out a module whose parts the library does not have", () => {
    const withoutWheel = loaded({
      ...bundled,
      parts: bundled.parts.filter((part) => part.id !== "2c9119b8312f"),
    });
    const names = starterModules(withoutWheel).map((m) => m.name);
    expect(names).not.toContain("Wheel");
    expect(names).not.toContain("Axle with two wheels");
    expect(names).toContain("Turret");
  });

  it("builds the turret the Weapon button builds", () => {
    const parts = pickWeaponParts(pack.parts);
    if (!parts) throw new Error("the bundled pack has no weapon parts");
    const button = buildWeaponModule(parts, newId, "now");
    const turret = named("Turret");
    const shape = (m: LegoProject) =>
      m.pieces.map((p) => [p.name, p.partId, p.role, p.position, p.rotation]);
    expect(shape(turret)).toEqual(shape(button));
    expect(turret.animations?.map((a) => a.presetId)).toEqual([
      "turret.track",
      "recoil",
    ]);
  });

  it("builds the build arm the Build arm button builds", () => {
    const parts = pickArmParts(pack.parts);
    if (!parts) throw new Error("the bundled pack has no arm parts");
    const button = buildArmModule(parts, newId, "now");
    const arm = named("Build arm");
    const shape = (m: LegoProject) =>
      m.pieces.map((p) => [p.name, p.partId, p.role, p.position]);
    expect(shape(arm)).toEqual(shape(button));
    expect(arm.animations?.map((a) => a.presetId)).toEqual([
      "build.aim",
      "build.nano",
    ]);
  });

  it("uses a round part for the wheel and turns it about x", () => {
    const wheel = named("Wheel");
    const piece = wheel.pieces[0];
    expect(piece.role).toBe("wheel");
    const part = pack.byId.get(piece.partId as string);
    if (!part) throw new Error("no wheel part");
    const [x, y, z] = [0, 1, 2].map(
      (axis) => part.bbox.max[axis] - part.bbox.min[axis],
    );
    // The axle runs along x, the part's thin side, and the wheel is as tall as
    // it is long.
    expect(x).toBeLessThan(y);
    expect(y).toBeCloseTo(z, 3);
    expect(wheel.animations?.map((a) => a.presetId)).toEqual(["wheels.roll"]);
  });

  it("puts both of the axle's wheels on its ends, still turning about x", () => {
    const axle = named("Axle with two wheels");
    const wheels = axle.pieces.filter((p) => p.role === "wheel");
    expect(wheels).toHaveLength(2);
    const sides = wheels.map((wheel) => {
      expect(Math.abs(xAxis(axle, wheel.id).x)).toBeCloseTo(1, 6);
      return Math.sign(
        new THREE.Vector3().setFromMatrixPosition(worldMatrix(axle, wheel.id))
          .x,
      );
    });
    expect(sides.sort()).toEqual([-1, 1]);
  });

  it("lands a wheel on the hull's left face still turning about x", () => {
    // The top, front and back are taken, so the left face is the next free one.
    const unit = hull();
    const taken = ["+y", "+z", "-z"].map((to, n) => ({
      ...unit.pieces[0],
      id: `taken${n}`,
      name: `taken${n}`,
      parentId: "root",
      connection: { connector: "-y", to },
    }));
    const inserted = insertModule(
      { ...unit, pieces: [...unit.pieces, ...taken] },
      named("Wheel"),
      "root",
      newId,
      pack,
    );
    const wheel = inserted.project.pieces.find((p) => p.role === "wheel");
    if (!wheel) throw new Error("the wheel did not land");
    expect(wheel.connection?.to).toBe("+x");
    expect(Math.abs(xAxis(inserted.project, wheel.id).x)).toBeCloseTo(1, 6);
    expect(inserted.presets.added).toEqual(["wheels.roll"]);
  });

  it("brings the walk with a pair of legs, and holds it back for one leg", () => {
    const pair = insertModule(
      hull(),
      named("Pair of legs"),
      "root",
      newId,
      pack,
    );
    expect(pair.presets.added).toEqual(["walk.biped"]);

    const one = insertModule(hull(), named("Leg"), "root", newId, pack);
    expect(one.presets.added).toEqual([]);
    expect(one.presets.held.map((held) => held.presetId)).toEqual([
      "walk.biped",
    ]);
  });

  it("hangs each leg from the top of its thigh", () => {
    const leg = named("Leg");
    const [thigh, shin, foot] = leg.pieces;
    expect([thigh.role, shin.role, foot.role]).toEqual([
      "leg.l1.thigh",
      "leg.l1.shin",
      "leg.l1.foot",
    ]);
    const at = (id: string) =>
      new THREE.Vector3().setFromMatrixPosition(worldMatrix(leg, id));
    expect(at(shin.id).y).toBeLessThan(at(thigh.id).y);
    expect(at(foot.id).y).toBeLessThan(at(shin.id).y);
    const thighPart = pack.byId.get(thigh.partId as string);
    expect(thigh.pivot?.[1]).toBe(thighPart?.bbox.max[1]);
  });

  it("joins the long hull's second block to the front of the first", () => {
    const long = named("Long hull section");
    expect(long.pieces).toHaveLength(2);
    const second = long.pieces[1];
    expect(second.connection).toEqual({ connector: "-z", to: "+z" });
    // The hull block is 3 long, so the second sits one length ahead.
    expect(second.position[2]).toBeCloseTo(3, 6);
  });
});

describe("withStarters", () => {
  it("lists the built in modules first and drops a saved one claiming a built in id", () => {
    const saved = { ...hull(), id: "mine", name: "Mine" };
    const impostor = { ...hull(), id: starters[0].id, name: "Impostor" };
    const list = withStarters(starters, [saved, impostor]);
    expect(list.map((m) => m.id)).toEqual([
      ...starters.map((m) => m.id),
      "mine",
    ]);
  });
});

describe("ownCopy", () => {
  it("is the user's module, with a new id and a name of its own", () => {
    const wheel = named("Wheel");
    const copy = ownCopy(wheel, ["Wheel", "Wheel copy"], {
      id: "fresh",
      now: "2026-10-18T00:00:00.000Z",
    });
    expect(copy.id).toBe("fresh");
    expect(isBuiltInModule(copy)).toBe(false);
    expect(copy.name).toBe("Wheel copy 2");
    expect(copy.createdAt).toBe("2026-10-18T00:00:00.000Z");
    expect(copy.pieces).toEqual(wheel.pieces);
    expect(copy.mount).toEqual(wheel.mount);
    expect(copy.category).toBe(wheel.category);
    expect(copy.animations).toEqual(wheel.animations);
  });

  it("names the first copy plainly", () => {
    const copy = ownCopy(named("Turret"), ["turret"], {
      id: "fresh",
      now: "now",
    });
    expect(copy.name).toBe("Turret copy");
  });
});

describe("built in modules as instances", () => {
  it("records the built in id on every piece of a drop", () => {
    const dropped = insertModule(
      hull(),
      named("Wheel"),
      "root",
      newId,
      pack,
      undefined,
      true,
    );
    const added = dropped.project.pieces.filter((p) => p.module);
    expect(added.length).toBeGreaterThan(0);
    for (const p of added) expect(p.module?.id).toBe("builtin.wheel");
  });

  it("offers the other built in wheel first when swapping a wheel", () => {
    const list = withStarters(starters, []);
    const offered = swapCandidates(list, "builtin.wheel", "Wheel");
    expect(offered[0]?.id).toBe("builtin.axle");
    expect(offered.map((m) => m.id)).not.toContain("builtin.wheel");
  });

  it("records the built in id on the module a swap puts in", () => {
    const dropped = insertModule(
      hull(),
      named("Wheel"),
      "root",
      newId,
      pack,
      undefined,
      true,
    );
    const wheel = dropped.project.pieces.find((p) => p.role === "wheel");
    if (!wheel) throw new Error("the wheel did not land");
    const swapped = swapModule(
      dropped.project,
      pack,
      wheel.id,
      named("Axle with two wheels"),
      newId,
    );
    if (!swapped) throw new Error("the swap did not happen");
    const refs = new Set(
      swapped.project.pieces.flatMap((p) => (p.module ? [p.module.id] : [])),
    );
    expect([...refs]).toEqual(["builtin.axle"]);
  });
});
