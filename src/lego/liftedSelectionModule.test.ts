import { gunzipSync, gzipSync } from "fflate";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { legoGeometryUrl } from "../lib/assetUrl";
import { buildCompoundHolder } from "./compoundPreview";
import { selectionAsCompound } from "./compounds";
import { saveModuleMeshes } from "./liftIntoUnit";
import { liftedModuleRefusal, moduleForUnit } from "./liftPiece";
import {
  type LegoLifted,
  type LegoPiece,
  type LegoProject,
  type LegoUnitGame,
  newProject,
} from "./model";
import {
  encodeRawGeometry,
  parseRawGeometry,
  type RawGeometry,
} from "./rawGeometry";

const save = vi.hoisted(() => vi.fn());
vi.mock("./bindings", () => ({
  legoGeometrySave: (args: unknown) => save(args),
}));

const sf: LegoUnitGame = { name: "Splinter Faction", archive: "sf.sdz" };
const xta: LegoUnitGame = { name: "XTA", archive: "xta.sdz" };

const lifted: LegoLifted = {
  game: sf,
  member: "objects3d/armcom.s3o",
  unit: "armcom",
  texture: { key: "tex", name: "armcom.png" },
};

/** Three meshes in the unit's file, one of which the selection leaves out. */
function unitGeometry(): RawGeometry {
  const ids = ["unit/m0", "unit/m1", "unit/m2"];
  return {
    byId: new Map(
      ids.map((id, n) => [
        id,
        {
          id,
          vFirst: n,
          vCount: 1,
          iFirst: n * 3,
          iCount: 3,
          bbox: { min: [n, 0, 0], max: [n, 0, 0] },
        },
      ]),
    ),
    vertices: new Float32Array(ids.flatMap((_, n) => [n, 0, 0, 0, 1, 0, 0, 0])),
    indices: new Uint32Array(ids.flatMap(() => [0, 0, 0])),
  };
}

function piece(extra: Partial<LegoPiece> & { id: string }): LegoPiece {
  return {
    name: extra.id,
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

/** A unit for Splinter Faction holding two lifted pieces and a pack barrel. */
function unit(game: LegoUnitGame | null = sf): LegoProject {
  const base = newProject({
    id: "unit",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    game,
    pieces: [
      ...base.pieces,
      piece({ id: "turret", meshId: "unit/m0", lifted }),
      piece({ id: "barrel", partId: "barrel", parentId: "turret" }),
      piece({ id: "dome", meshId: "unit/m1", lifted }),
      piece({ id: "spare", meshId: "unit/m2", lifted }),
    ],
  };
}

function saved(project: LegoProject, ids: string[]): LegoProject {
  let n = 0;
  const module = selectionAsCompound(project, ids, {
    id: "module",
    now: "2026-10-17T00:00:00Z",
    newId: () => `p${n++}`,
  });
  if (!module) throw new Error("nothing selected");
  return module;
}

let files: Map<string, RawGeometry>;

beforeEach(() => {
  files = new Map([["unit", unitGeometry()]]);
  save.mockReset();
  save.mockResolvedValue({ bytes: 0 });
  vi.stubGlobal("fetch", async (url: string) => {
    for (const [id, raw] of files) {
      if (url === legoGeometryUrl(id)) {
        return new Response(gzipSync(encodeRawGeometry(raw)));
      }
    }
    return new Response(null, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saving a selection that holds lifted pieces as a module", () => {
  it("writes a file named after the module holding exactly its meshes", async () => {
    const module = saved(unit(), ["turret", "dome"]);

    await saveModuleMeshes("unit", module);

    expect(save).toHaveBeenCalledTimes(1);
    const call = save.mock.calls[0][0] as { id: string; bytes: number[] };
    expect(call.id).toBe("module");
    const raw = parseRawGeometry(gunzipSync(new Uint8Array(call.bytes)));
    expect([...raw.byId.keys()].sort()).toEqual(["unit/m0", "unit/m1"]);
    expect(raw.byId.get("unit/m1")?.bbox.min).toEqual([1, 0, 0]);
  });

  it("keeps each piece's game, texture and the pack part under a lifted one", () => {
    const module = saved(unit(), ["turret", "dome"]);

    const lifts = module.pieces.filter((p) => p.lifted);
    expect(lifts).toHaveLength(2);
    for (const p of lifts) expect(p.lifted).toEqual(lifted);
    expect(module.pieces.some((p) => p.partId === "barrel")).toBe(true);
  });

  it("writes nothing for a selection of pack parts", async () => {
    const module = saved(unit(), ["barrel"]);

    expect(await saveModuleMeshes("unit", module)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("writes nothing and says why when the unit's file is missing", async () => {
    files.clear();

    await expect(
      saveModuleMeshes("unit", saved(unit(), ["turret"])),
    ).rejects.toThrow(/The meshes of turret could not be read/);
    expect(save).not.toHaveBeenCalled();
  });

  it("goes into a unit for the same game and is refused by another", () => {
    const module = saved(unit(), ["turret", "dome"]);

    expect(liftedModuleRefusal(unit(sf), module)).toBeNull();
    expect(liftedModuleRefusal(unit(xta), module)).toBe(
      "This piece is from Splinter Faction. This unit is for XTA.",
    );
    expect(liftedModuleRefusal(unit(null), module)).toMatch(/no game/);
  });

  it("takes its meshes into another unit under keys of the module's own", () => {
    const placed = moduleForUnit(saved(unit(), ["turret", "dome"]));

    expect([...placed.keys.values()].sort()).toEqual([
      "module/unit/m0",
      "module/unit/m1",
    ]);
  });
});

describe("drawing such a module in the picker", () => {
  it("gives each lifted piece its own texture's material and the pack's to a part", () => {
    const module = saved(unit(), ["turret", "dome"]);
    const own = new THREE.MeshBasicMaterial();
    const shared = new THREE.MeshBasicMaterial();

    const holder = buildCompoundHolder(
      module,
      () => new THREE.BoxGeometry(1, 1, 1),
      (p) => (p.meshId ? own : shared),
      100,
    );

    const used = new Map<string, THREE.Material>();
    holder.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        used.set(child.parent?.userData.pieceId, child.material);
      }
    });
    const barrel = module.pieces.find((p) => p.partId === "barrel");
    const turret = module.pieces.find((p) => p.name === "turret");
    expect(used.get(barrel?.id as string)).toBe(shared);
    expect(used.get(turret?.id as string)).toBe(own);
  });
});
