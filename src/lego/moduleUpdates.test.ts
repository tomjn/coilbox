import { describe, expect, it } from "vitest";
import { BUILD_ARM_ID } from "./buildArm";
import { duplicatePiece, insertCompound } from "./compounds";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
} from "./model";
import { markModuleCurrent, moduleStamp, moduleUpdates } from "./moduleUpdates";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { swapModule } from "./swapModule";

type Vec3 = [number, number, number];

function part(id: string, min: Vec3, max: Vec3): LegoPartInfo {
  return {
    id,
    packId: "lego",
    shapeId: id,
    name: id,
    category: "grey",
    colourway: "grey",
    shape: "block",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: { min, max },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  } as LegoPartInfo;
}

function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  } as LoadedPack;
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

function doc(pieces: LegoPiece[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return { ...base, pieces: [...base.pieces, ...pieces] };
}

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

function wheel(extra: Partial<LegoProject> = {}): LegoProject {
  return {
    ...doc([]),
    id: "wheel",
    name: "Wheel",
    rootPieceId: "tyre",
    pieces: [
      piece({ id: "tyre", name: "tyre", partId: "leg", parentId: null }),
      piece({
        id: "hub",
        name: "hub",
        partId: "leg",
        parentId: "tyre",
        position: [0, 0.5, 0],
      }),
    ],
    mount: { piece: "tyre", connector: "-y" },
    ...extra,
  };
}

/** A unit with a hull under the root and the wheel inserted onto it. */
function withWheel(module: LegoProject, count = 1): LegoProject {
  let project = doc([piece({ id: "hull", partId: "hull" })]);
  const newId = counter("n");
  for (let i = 0; i < count; i++) {
    project = insertCompound(project, module, "hull", newId, true).project;
  }
  return project;
}

describe("the content stamp", () => {
  it("is the same for the same content", () => {
    expect(moduleStamp(wheel())).toBe(moduleStamp(wheel()));
  });

  it("ignores a rename, a category, tags and the dates", () => {
    const same = wheel({
      name: "Big wheel",
      category: "Wheel",
      tags: ["round"],
      updatedAt: "2030-01-01T00:00:00Z",
    });
    expect(moduleStamp(same)).toBe(moduleStamp(wheel()));
  });

  it("changes when a piece moves, is renamed or is added", () => {
    const base = wheel();
    const moved = {
      ...base,
      pieces: base.pieces.map((p) =>
        p.id === "hub" ? { ...p, position: [0, 0.6, 0] as Vec3 } : p,
      ),
    };
    const renamed = {
      ...base,
      pieces: base.pieces.map((p) =>
        p.id === "hub" ? { ...p, name: "cap" } : p,
      ),
    };
    const added = {
      ...base,
      pieces: [...base.pieces, piece({ id: "nut", parentId: "hub" })],
    };
    const stamps = [base, moved, renamed, added].map(moduleStamp);
    expect(new Set(stamps).size).toBe(4);
  });

  it("changes when a preset or the mount changes", () => {
    const base = wheel();
    const preset = {
      ...base,
      animations: [{ presetId: "wheels.spin", params: { speed: 1 } }],
    };
    const mount = { ...base, mount: { piece: "tyre", connector: "+y" } };
    expect(moduleStamp(preset)).not.toBe(moduleStamp(base));
    expect(moduleStamp(mount)).not.toBe(moduleStamp(base));
  });

  it("does not depend on the order keys were written in", () => {
    const base = wheel();
    const flipped = {
      ...base,
      pieces: base.pieces.map((p) => ({
        scale: p.scale,
        rotation: p.rotation,
        position: p.position,
        partId: p.partId,
        parentId: p.parentId,
        name: p.name,
        id: p.id,
      })),
    };
    expect(moduleStamp(flipped)).toBe(moduleStamp(base));
  });
});

describe("an insert records the stamp", () => {
  it("writes the module's stamp on every piece of a module insert", () => {
    const project = withWheel(wheel());
    const added = project.pieces.filter((p) => p.module);
    expect(added).toHaveLength(2);
    expect(added.every((p) => p.module?.rev === moduleStamp(wheel()))).toBe(
      true,
    );
  });

  it("keeps the stamp on a duplicate", () => {
    const project = withWheel(wheel());
    const tyre = project.pieces.find((p) => p.name === "tyre") as LegoPiece;
    const copy = duplicatePiece(project, tyre.id, {
      now: "2026-10-17T00:00:00Z",
      newId: counter("d"),
    });
    const copied = copy?.project.pieces.find((p) => p.id === copy.rootPieceId);
    expect(copied?.module?.rev).toBe(tyre.module?.rev);
  });

  it("survives a save and a load", () => {
    const project = withWheel(wheel());
    const parsed = parseLegoProjectJson(JSON.stringify(project));
    expect(parsed?.pieces.map((p) => p.module)).toEqual(
      project.pieces.map((p) => p.module),
    );
  });
});

/** The unit as it was saved before stamps were recorded. */
function unstamped(project: LegoProject): LegoProject {
  return {
    ...project,
    pieces: project.pieces.map((p) => {
      if (!p.module) return p;
      const { rev: _rev, fp: _fp, ...rest } = p.module;
      return { ...p, module: rest };
    }),
  };
}

describe("which instances are out of date", () => {
  const improved = {
    ...wheel(),
    pieces: wheel().pieces.map((p) =>
      p.id === "hub" ? { ...p, position: [0, 0.7, 0] as Vec3 } : p,
    ),
  };

  it("offers nothing while the module is as inserted", () => {
    const found = moduleUpdates(withWheel(wheel()), [wheel()]);
    expect(found.outdated).toEqual([]);
    expect(found.missing).toEqual([]);
  });

  it("offers nothing after a rename of the module", () => {
    const found = moduleUpdates(withWheel(wheel()), [
      wheel({ name: "Renamed", updatedAt: "2031-01-01T00:00:00Z" }),
    ]);
    expect(found.outdated).toEqual([]);
  });

  it("names each older instance and the module it came from", () => {
    const project = withWheel(wheel(), 2);
    const found = moduleUpdates(project, [improved]);
    expect(found.outdated).toHaveLength(2);
    expect(found.outdated.every((u) => u.moduleName === "Wheel")).toBe(true);
    expect(found.outdated.map((u) => u.name)).toEqual(["tyre", "tyre2"]);
    expect(new Set(found.outdated.map((u) => u.instance)).size).toBe(2);
    expect(found.outdated[0].rootPieceId).toBeTruthy();
  });

  it("counts the pieces renamed or moved since the insert as edited", () => {
    const project = withWheel(wheel());
    const found = moduleUpdates(project, [improved]);
    // The module's own change is not an edit of the unit's.
    expect(found.outdated[0].edited).toBe(0);

    const edited = {
      ...project,
      pieces: project.pieces.map((p) =>
        p.name === "hub" ? { ...p, name: "spinner" } : p,
      ),
    };
    expect(moduleUpdates(edited, [wheel()]).outdated).toEqual([]);
    expect(moduleUpdates(edited, [improved]).outdated[0].edited).toBe(1);

    const moved = {
      ...project,
      pieces: project.pieces.map((p) =>
        p.name === "hub" ? { ...p, position: [1, 1, 1] as Vec3 } : p,
      ),
    };
    expect(moduleUpdates(moved, [improved]).outdated[0].edited).toBe(1);

    const slid = {
      ...project,
      pieces: project.pieces.map((p) =>
        p.name === "tyre" ? { ...p, position: [1, 1, 1] as Vec3 } : p,
      ),
    };
    expect(moduleUpdates(slid, [improved]).outdated[0].edited).toBe(0);
  });

  it("reports an instance whose module was deleted as missing", () => {
    const found = moduleUpdates(withWheel(wheel()), []);
    expect(found.outdated).toEqual([]);
    expect(found.missing).toHaveLength(1);
    expect(found.missing[0].moduleId).toBe("wheel");
  });

  it("leaves generated pieces out of both lists", () => {
    const generated = withWheel({ ...wheel(), id: BUILD_ARM_ID });
    const found = moduleUpdates(generated, []);
    expect(found.outdated).toEqual([]);
    expect(found.missing).toEqual([]);
  });

  it("lists an instance with no recorded stamp as untracked, not outdated", () => {
    const found = moduleUpdates(unstamped(withWheel(wheel())), [improved]);
    expect(found.outdated).toEqual([]);
    expect(found.untracked).toHaveLength(1);
    expect(found.untracked[0]).toMatchObject({
      moduleId: "wheel",
      moduleName: "Wheel",
      name: "tyre",
    });
  });

  it("lists an untracked instance whether or not its module changed", () => {
    const project = unstamped(withWheel(wheel()));
    expect(moduleUpdates(project, [wheel()]).untracked).toHaveLength(1);
    expect(moduleUpdates(project, [improved]).untracked).toHaveLength(1);
  });

  it("leaves stamped instances as they were", () => {
    const found = moduleUpdates(withWheel(wheel()), [wheel()]);
    expect(found.untracked).toEqual([]);
    expect(moduleUpdates(withWheel(wheel()), [improved]).untracked).toEqual([]);
  });

  it("treats a mirror twin sharing an instance as one instance", () => {
    const project = withWheel(wheel());
    const [first] = project.pieces.filter((p) => p.module);
    const shared = {
      ...project,
      pieces: project.pieces.map((p) =>
        p.module ? { ...p, module: { ...(first.module as object) } } : p,
      ),
    } as LegoProject;
    expect(moduleUpdates(shared, [improved]).outdated).toHaveLength(1);
  });
});

describe("updating an instance", () => {
  it("is a swap to the current module and clears the offer", () => {
    const improved = {
      ...wheel(),
      pieces: wheel().pieces.map((p) =>
        p.id === "hub" ? { ...p, position: [0, 0.7, 0] as Vec3 } : p,
      ),
    };
    const project = withWheel(wheel());
    const [offer] = moduleUpdates(project, [improved]).outdated;
    const result = swapModule(
      project,
      pack(),
      offer.rootPieceId,
      improved,
      counter("u"),
    );
    expect(result).not.toBeNull();
    const after = moduleUpdates(result?.project as LegoProject, [improved]);
    expect(after.outdated).toEqual([]);
    const hub = result?.project.pieces.find((p) => p.name === "hub");
    expect(hub?.position).toEqual([0, 0.7, 0]);
  });
});

describe("marking an untracked instance as current", () => {
  const improved = {
    ...wheel(),
    pieces: wheel().pieces.map((p) =>
      p.id === "hub" ? { ...p, position: [0, 0.7, 0] as Vec3 } : p,
    ),
  };

  function top(project: LegoProject, instance: string) {
    return project.pieces.find(
      (p) => p.module?.instance === instance && p.name.startsWith("tyre"),
    ) as LegoPiece;
  }

  it("records the module's stamp and a fingerprint on every piece", () => {
    const old = unstamped(withWheel(wheel()));
    const [offer] = moduleUpdates(old, [wheel()]).untracked;
    const marked = markModuleCurrent(old, offer.rootPieceId, wheel());
    const pieces = marked?.pieces.filter((p) => p.module) ?? [];
    expect(pieces).toHaveLength(2);
    expect(pieces.every((p) => p.module?.rev === moduleStamp(wheel()))).toBe(
      true,
    );
    expect(pieces.every((p) => p.module?.fp)).toBe(true);
    // Same record a stamped insert writes.
    expect(pieces.map((p) => p.module)).toEqual(
      withWheel(wheel())
        .pieces.filter((p) => p.module)
        .map((p) => p.module),
    );
  });

  it("is tracked normally afterwards, so a later module change is offered", () => {
    const old = unstamped(withWheel(wheel()));
    const [offer] = moduleUpdates(old, [wheel()]).untracked;
    const marked = markModuleCurrent(
      old,
      offer.rootPieceId,
      wheel(),
    ) as LegoProject;
    const now = moduleUpdates(marked, [wheel()]);
    expect(now.untracked).toEqual([]);
    expect(now.outdated).toEqual([]);
    expect(moduleUpdates(marked, [improved]).outdated).toHaveLength(1);
  });

  it("leaves other instances and stamped instances alone", () => {
    const stamped = withWheel(wheel(), 2);
    const [a, b] = [
      ...new Set(
        stamped.pieces.flatMap((p) => (p.module ? [p.module.instance] : [])),
      ),
    ];
    const half = {
      ...stamped,
      pieces: stamped.pieces.map((p) => {
        if (p.module?.instance !== a) return p;
        const { rev: _rev, fp: _fp, ...rest } = p.module;
        return { ...p, module: rest };
      }),
    };
    const marked = markModuleCurrent(half, top(half, a).id, wheel());
    expect(marked?.pieces.filter((p) => p.module?.instance === b)).toEqual(
      half.pieces.filter((p) => p.module?.instance === b),
    );
  });

  it("returns null for a piece in no instance", () => {
    const old = unstamped(withWheel(wheel()));
    expect(markModuleCurrent(old, "hull", wheel())).toBeNull();
  });

  it("marks a mirror twin that shares the instance with it", () => {
    const old = unstamped(withWheel(wheel(), 2));
    const [first] = old.pieces.filter((p) => p.module);
    const shared = {
      ...old,
      pieces: old.pieces.map((p) =>
        p.module ? { ...p, module: { ...first.module } } : p,
      ),
    } as LegoProject;
    const marked = markModuleCurrent(shared, first.id, wheel()) as LegoProject;
    expect(
      marked.pieces.filter((p) => p.module).every((p) => p.module?.rev),
    ).toBe(true);
    expect(moduleUpdates(marked, [wheel()]).untracked).toEqual([]);
  });

  it("marks a twin and ring copies in other instances only with symmetry", () => {
    const old = unstamped(withWheel(wheel(), 3));
    const instances = [
      ...new Set(
        old.pieces.flatMap((p) => (p.module ? [p.module.instance] : [])),
      ),
    ];
    const tops = instances.map((i) => top(old, i));
    const ringed = {
      ...old,
      pieces: old.pieces.map((p) => {
        const at = tops.findIndex((t) => t.id === p.id);
        return at < 0
          ? p
          : { ...p, ring: { next: tops[(at + 1) % 3].id, count: 3 } };
      }),
    };
    const plain = markModuleCurrent(ringed, tops[0].id, wheel()) as LegoProject;
    expect(moduleUpdates(plain, [wheel()]).untracked).toHaveLength(2);
    const all = markModuleCurrent(ringed, tops[0].id, wheel(), {
      symmetry: true,
    }) as LegoProject;
    expect(moduleUpdates(all, [wheel()]).untracked).toEqual([]);

    const twinned = {
      ...old,
      pieces: old.pieces.map((p) =>
        p.id === tops[0].id
          ? { ...p, twin: tops[1].id }
          : p.id === tops[1].id
            ? { ...p, twin: tops[0].id }
            : p,
      ),
    };
    const pair = markModuleCurrent(twinned, tops[0].id, wheel(), {
      symmetry: true,
    }) as LegoProject;
    expect(moduleUpdates(pair, [wheel()]).untracked).toHaveLength(1);
  });
});

describe("updating an untracked instance", () => {
  it("replaces it with the module and tracks it", () => {
    const improved = {
      ...wheel(),
      pieces: wheel().pieces.map((p) =>
        p.id === "hub" ? { ...p, position: [0, 0.7, 0] as Vec3 } : p,
      ),
    };
    const old = unstamped(withWheel(wheel()));
    const [offer] = moduleUpdates(old, [improved]).untracked;
    const result = swapModule(
      old,
      pack(),
      offer.rootPieceId,
      improved,
      counter("u"),
    );
    const after = moduleUpdates(result?.project as LegoProject, [improved]);
    expect(after.untracked).toEqual([]);
    expect(after.outdated).toEqual([]);
    expect(
      result?.project.pieces.find((p) => p.name === "hub")?.position,
    ).toEqual([0, 0.7, 0]);
  });
});
