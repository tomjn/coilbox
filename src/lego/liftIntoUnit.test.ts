import { gunzipSync, gzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { legoGeometryUrl } from "../lib/assetUrl";
import { liftIntoUnit, pasteIntoUnit, trimLiftedMeshes } from "./liftIntoUnit";
import { type LegoProject, newProject } from "./model";
import {
  encodeRawGeometry,
  parseRawGeometry,
  type RawGeometry,
  type RawMesh,
} from "./rawGeometry";

const save = vi.hoisted(() => vi.fn());
vi.mock("./bindings", () => ({
  legoGeometrySave: (args: unknown) => save(args),
}));

/** One mesh of one vertex under `id`, at `x`. */
function geometry(id: string, x: number): RawGeometry {
  return {
    byId: new Map([
      [
        id,
        {
          id,
          vFirst: 0,
          vCount: 1,
          iFirst: 0,
          iCount: 3,
          bbox: { min: [x, 0, 0], max: [x, 0, 0] },
        },
      ],
    ]),
    vertices: new Float32Array([x, 0, 0, 0, 1, 0, 0, 0]),
    indices: new Uint32Array([0, 0, 0]),
  };
}

function base(id: string): LegoProject {
  return newProject({
    id,
    rootPieceId: `${id}-root`,
    name: id,
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
}

/** A module lifted from a game: one turret naming mesh `m0`. */
function turret(): LegoProject {
  const module = base("mod");
  return {
    ...module,
    pieces: [
      {
        ...module.pieces[0],
        name: "turret",
        meshId: "m0",
        lifted: {
          game: { name: "SF", archive: "sf.sdz" },
          member: "objects3d/armcom.s3o",
        },
      },
    ],
  };
}

let files: Map<string, RawGeometry>;

beforeEach(() => {
  files = new Map();
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

/** What was written, read back. */
function written(): RawGeometry {
  const { bytes } = save.mock.calls[0][0] as { bytes: number[] };
  return parseRawGeometry(gunzipSync(new Uint8Array(bytes)));
}

describe("liftIntoUnit", () => {
  it("starts the unit's own geometry file with the module's meshes", async () => {
    files.set("mod", geometry("m0", 5));

    const { module, raw } = await liftIntoUnit("unit", turret());

    expect(module.pieces[0].meshId).toBe("mod/m0");
    expect([...(raw?.byId.keys() ?? [])]).toEqual(["mod/m0"]);
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0][0] as { id: string }).id).toBe("unit");
    expect(written().byId.get("mod/m0")?.bbox.min).toEqual([5, 0, 0]);
  });

  it("records the box of each mesh on the module's pieces (#3269)", async () => {
    files.set("mod", geometry("m0", 5));

    const { module } = await liftIntoUnit("unit", turret());

    expect(module.pieces[0].meshBox).toEqual({
      min: [5, 0, 0],
      max: [5, 0, 0],
    });
  });

  it("keeps what the unit's file already holds", async () => {
    files.set("mod", geometry("m0", 5));
    files.set("unit", geometry("other/m0", 9));

    await liftIntoUnit("unit", turret());

    expect([...written().byId.keys()]).toEqual(["other/m0", "mod/m0"]);
  });

  it("writes nothing when the unit already holds the meshes", async () => {
    files.set("mod", geometry("m0", 5));
    files.set("unit", geometry("mod/m0", 5));

    const { raw } = await liftIntoUnit("unit", turret());

    expect(save).not.toHaveBeenCalled();
    expect([...(raw?.byId.keys() ?? [])]).toEqual(["mod/m0"]);
  });

  it("needs no file for a module of parts", async () => {
    const { raw } = await liftIntoUnit("unit", base("parts"));
    expect(raw).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("says which module's meshes are missing, and writes nothing", async () => {
    await expect(liftIntoUnit("unit", turret())).rejects.toThrow(
      /The meshes of mod could not be read/,
    );
    expect(save).not.toHaveBeenCalled();
  });
});

/** A pasted piece naming mesh `mod/m0`, as a lifted module's piece does once in a unit. */
function placed(): LegoProject {
  const module = turret();
  return {
    ...module,
    pieces: module.pieces.map((piece) => ({ ...piece, meshId: "mod/m0" })),
  };
}

describe("pasteIntoUnit", () => {
  it("copies the pasted pieces' meshes out of the unit they were copied from", async () => {
    files.set("source", geometry("mod/m0", 5));

    const raw = await pasteIntoUnit("unit", "source", placed());

    expect([...(raw?.byId.keys() ?? [])]).toEqual(["mod/m0"]);
    expect((save.mock.calls[0][0] as { id: string }).id).toBe("unit");
    expect(written().byId.get("mod/m0")?.bbox.min).toEqual([5, 0, 0]);
  });

  it("keeps what the unit's file already holds", async () => {
    files.set("source", geometry("mod/m0", 5));
    files.set("unit", geometry("other/m0", 9));

    await pasteIntoUnit("unit", "source", placed());

    expect([...written().byId.keys()]).toEqual(["other/m0", "mod/m0"]);
  });

  it("reads nothing when pasting into the unit it was copied from", async () => {
    const raw = await pasteIntoUnit("unit", "unit", placed());
    expect(raw).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("writes nothing when the unit already holds the meshes", async () => {
    files.set("source", geometry("mod/m0", 5));
    files.set("unit", geometry("mod/m0", 5));

    await pasteIntoUnit("unit", "source", placed());

    expect(save).not.toHaveBeenCalled();
  });

  it("needs no file for pieces of parts", async () => {
    const raw = await pasteIntoUnit("unit", "source", base("parts"));
    expect(raw).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("says whose meshes are missing, and writes nothing", async () => {
    await expect(pasteIntoUnit("unit", "source", placed())).rejects.toThrow(
      /The meshes of mod could not be read/,
    );
    expect(save).not.toHaveBeenCalled();
  });
});

/** A whole model's file: `count` meshes of `vertices` vertices each. */
function wholeModel(count: number, vertices: number): RawGeometry {
  const byId = new Map<string, RawMesh>();
  for (let n = 0; n < count; n++) {
    byId.set(`m${n}`, {
      id: `m${n}`,
      vFirst: n * vertices,
      vCount: vertices,
      iFirst: n * vertices * 3,
      iCount: vertices * 3,
      bbox: { min: [n, 0, 0], max: [n, 0, 0] },
    });
  }
  return {
    byId,
    vertices: new Float32Array(
      Array.from({ length: count * vertices * 8 }, (_, i) => i),
    ),
    indices: new Uint32Array(
      Array.from({ length: count * vertices * 3 }, (_, i) => i % vertices),
    ),
  };
}

describe("trimLiftedMeshes (#4337)", () => {
  it("leaves a file holding exactly the meshes the lifted pieces name", async () => {
    files.set("mod", wholeModel(6, 40));
    const whole = gzipSync(
      encodeRawGeometry(files.get("mod") as RawGeometry),
    ).length;

    const raw = await trimLiftedMeshes(turret());

    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0][0] as { id: string }).id).toBe("mod");
    expect([...written().byId.keys()]).toEqual(["m0"]);
    expect([...(raw?.byId.keys() ?? [])]).toEqual(["m0"]);
    const { bytes } = save.mock.calls[0][0] as { bytes: number[] };
    expect(bytes.length).toBeLessThan(whole);
  });

  it("keeps the mesh's vertices, so the trimmed module still goes into a unit", async () => {
    files.set("mod", wholeModel(6, 40));
    await trimLiftedMeshes(turret());
    files.set("mod", written());
    save.mockClear();

    const { module, raw } = await liftIntoUnit("unit", turret());

    expect(module.pieces[0].meshId).toBe("mod/m0");
    expect(raw?.byId.get("mod/m0")?.vCount).toBe(40);
    expect(raw?.vertices.length).toBe(40 * 8);
    expect(module.pieces[0].meshBox).toEqual({
      min: [0, 0, 0],
      max: [0, 0, 0],
    });
  });

  it("still loads a module whose file holds the whole model", async () => {
    files.set("mod", wholeModel(6, 40));

    const { module, raw } = await liftIntoUnit("unit", turret());

    expect(module.pieces[0].meshId).toBe("mod/m0");
    expect([...(raw?.byId.keys() ?? [])]).toEqual(["mod/m0"]);
  });

  it("writes nothing for a module without meshes", async () => {
    expect(await trimLiftedMeshes(base("parts"))).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("writes nothing when the file lacks a mesh the pieces name", async () => {
    files.set("mod", geometry("other", 1));
    await expect(trimLiftedMeshes(turret())).rejects.toThrow(
      /names meshes the lifted model's geometry file does not hold/,
    );
    expect(save).not.toHaveBeenCalled();
  });
});
