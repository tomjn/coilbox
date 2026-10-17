import { gunzipSync, gzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { legoGeometryUrl } from "../lib/assetUrl";
import { liftIntoUnit } from "./liftIntoUnit";
import { type LegoProject, newProject } from "./model";
import {
  encodeRawGeometry,
  parseRawGeometry,
  type RawGeometry,
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
