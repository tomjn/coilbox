import { describe, expect, it } from "vitest";

import { addLoadout, loadoutPieceIds, switchLoadout } from "./loadouts";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
} from "./model";
import { placeModule } from "./moduleMount";
import {
  markMountPoint,
  mountContents,
  mountRefusal,
  parseCategories,
  seatRefusal,
  unmarkMountPoint,
  updateMountPoint,
} from "./mountPoints";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { freeFace, placePart } from "./placePart";
import { dragPiece, type Seat } from "./seat";
import { swapModule, swapRefusal } from "./swapModule";

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
  };
}

function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("gun", [-0.25, -0.25, -0.25], [0.25, 0.25, 0.25]),
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

function chassis(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "tank",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  return {
    ...base,
    pieces: [...base.pieces, piece({ id: "hull", partId: "hull" })],
  };
}

function module(category?: string): LegoProject {
  return {
    ...chassis(),
    id: `module-${category ?? "none"}`,
    rootPieceId: "gun",
    pieces: [piece({ id: "gun", partId: "gun", parentId: null })],
    ...(category ? { category } : {}),
  };
}

let n = 0;
const newId = () => `id${++n}`;
const FACE = { parentId: "hull", to: "+y" };
const HERE = { cycle: 0, twist: 0 };

/** The hull with its top marked as a mount that takes turrets. */
function mounted(): LegoProject {
  const marked = markMountPoint(chassis(), pack(), "hull", "+y");
  return updateMountPoint(marked, "hull", "+y", {
    name: "Turret",
    accepts: ["Turret", "Side weapon"],
  });
}

describe("marking a mount point", () => {
  it("names a connector and the categories that fit", () => {
    const hull = mounted().pieces.find((p) => p.id === "hull");
    expect(hull?.mountPoints).toEqual([
      { connector: "+y", name: "Turret", accepts: ["Turret", "Side weapon"] },
    ]);
  });

  it("names a new mount Mount 1 and then Mount 2", () => {
    const one = markMountPoint(chassis(), pack(), "hull", "+y");
    const two = markMountPoint(one, pack(), "hull", "-y");
    expect(
      two.pieces.find((p) => p.id === "hull")?.mountPoints?.map((m) => m.name),
    ).toEqual(["Mount 1", "Mount 2"]);
  });

  it("ignores a connector the piece does not have, and a second mark", () => {
    const project = mounted();
    expect(markMountPoint(project, pack(), "hull", "nope")).toBe(project);
    expect(markMountPoint(project, pack(), "hull", "+y")).toBe(project);
  });

  it("takes the mark off, leaving the piece without the field", () => {
    const hull = unmarkMountPoint(mounted(), "hull", "+y").pieces.find(
      (p) => p.id === "hull",
    );
    expect("mountPoints" in (hull as LegoPiece)).toBe(false);
  });

  it("reads categories from a comma separated field", () => {
    expect(parseCategories(" Turret, ,Side weapon ")).toEqual([
      "Turret",
      "Side weapon",
    ]);
  });
});

describe("saving", () => {
  it("keeps mount points when the chassis is saved and reopened", () => {
    const json = JSON.stringify({ ...mounted(), schemaVersion: 1 });
    const hull = parseLegoProjectJson(json)?.pieces.find(
      (p) => p.id === "hull",
    );
    expect(hull?.mountPoints?.[0]).toEqual({
      connector: "+y",
      name: "Turret",
      accepts: ["Turret", "Side weapon"],
    });
  });

  it("loads a project saved before mount points unchanged", () => {
    const json = JSON.stringify({ ...chassis(), schemaVersion: 1 });
    const loaded = parseLegoProjectJson(json);
    expect(loaded?.pieces.some((p) => "mountPoints" in p)).toBe(false);
  });

  it("drops a mount point entry that names no connector", () => {
    const bad = {
      ...chassis(),
      schemaVersion: 1,
      pieces: chassis().pieces.map((p) =>
        p.id === "hull"
          ? { ...p, mountPoints: [{ name: "x" }, "no", { connector: "+y" }] }
          : p,
      ),
    };
    const hull = parseLegoProjectJson(JSON.stringify(bad))?.pieces.find(
      (p) => p.id === "hull",
    );
    expect(hull?.mountPoints).toEqual([
      { connector: "+y", name: "", accepts: [] },
    ]);
  });
});

describe("placing a module on a mount point", () => {
  it("accepts a module whose category fits, whatever its case", () => {
    const out = placeModule(
      mounted(),
      module("turret"),
      pack(),
      FACE,
      HERE,
      newId,
    );
    expect(out).not.toBeNull();
    const root = out?.project.pieces.find((p) => p.id === out.rootPieceIds[0]);
    expect(root?.connection?.to).toBe("+y");
  });

  it("refuses a module of another category and names what fits", () => {
    const project = mounted();
    expect(
      placeModule(project, module("Engine"), pack(), FACE, HERE, newId),
    ).toBeNull();
    expect(mountRefusal(project, "hull", "+y", module("Engine"))).toBe(
      "Turret takes Turret, Side weapon only.",
    );
  });

  it("refuses a module with no category", () => {
    expect(
      placeModule(mounted(), module(), pack(), FACE, HERE, newId),
    ).toBeNull();
  });

  it("refuses everything on a mount with no categories yet", () => {
    const project = markMountPoint(chassis(), pack(), "hull", "+y");
    expect(mountRefusal(project, "hull", "+y", module("Turret"))).toBe(
      "Mount 1 takes no category yet.",
    );
  });

  it("takes anything on a connector that is not a mount", () => {
    const out = placeModule(
      mounted(),
      module("Engine"),
      pack(),
      { parentId: "hull", to: "-y" },
      HERE,
      newId,
    );
    expect(out).not.toBeNull();
  });

  it("refuses a plain part on a mount", () => {
    const part = pack().byId.get("gun") as LegoPartInfo;
    expect(placePart(mounted(), pack(), part, FACE, HERE, "x")).toBeNull();
  });

  it("is never the face a paste or a strip click picks", () => {
    const project = mounted();
    expect(freeFace(project, pack(), "hull")?.to).not.toBe("+y");
  });
});

describe("loadouts", () => {
  it("puts a module placed on a mount into the active loadout", () => {
    n = 0;
    const two = addLoadout(mounted(), { newId, name: "Second" });
    const out = placeModule(two, module("Turret"), pack(), FACE, HERE, newId);
    const project = out?.project as LegoProject;
    expect(loadoutPieceIds(project).has(out?.rootPieceIds[0] as string)).toBe(
      true,
    );
  });

  it("leaves a module on a mount alone when there are no loadouts", () => {
    const out = placeModule(
      mounted(),
      module("Turret"),
      pack(),
      FACE,
      HERE,
      newId,
    );
    expect(out?.project.pieces.some((p) => p.inLoadout)).toBe(false);
  });

  it("keeps the mount, and reads what is on it per loadout", () => {
    n = 0;
    const first = addLoadout(mounted(), { newId, name: "Second" });
    const firstId = first.activeLoadout as string;
    const filled = placeModule(
      first,
      module("Turret"),
      pack(),
      FACE,
      HERE,
      newId,
    )?.project as LegoProject;
    const other = first.loadouts?.find((l) => l.id !== firstId)?.id as string;

    const hull = (project: LegoProject) =>
      project.pieces.find((p) => p.id === "hull") as LegoPiece;
    const there = switchLoadout(filled, other);
    expect(hull(there).mountPoints).toEqual(hull(filled).mountPoints);
    expect(mountContents(there, hull(there))[0].onIt).toBeNull();

    const back = switchLoadout(there, firstId);
    expect(mountContents(back, hull(back))[0].onIt).toBe("gun");
  });
});

describe("swapping on a mount point", () => {
  it("keeps the new module on the mount and in the loadout", () => {
    n = 0;
    const two = addLoadout(mounted(), { newId, name: "Second" });
    const placed = placeModule(
      two,
      module("Turret"),
      pack(),
      FACE,
      HERE,
      newId,
    ) as NonNullable<ReturnType<typeof placeModule>>;
    const swapped = swapModule(
      placed.project,
      pack(),
      placed.rootPieceIds[0],
      module("Side weapon"),
      newId,
    );
    expect(swapped).not.toBeNull();
    const root = swapped?.project.pieces.find(
      (p) => p.id === swapped.rootPieceIds[0],
    );
    expect(root?.connection?.to).toBe("+y");
    expect(root?.parentId).toBe("hull");
    expect(root?.inLoadout).toBe(true);
  });

  it("refuses a module that does not fit the mount", () => {
    const placed = placeModule(
      mounted(),
      module("Turret"),
      pack(),
      FACE,
      HERE,
      newId,
    ) as NonNullable<ReturnType<typeof placeModule>>;
    const id = placed.rootPieceIds[0];
    expect(
      swapModule(placed.project, pack(), id, module("Engine"), newId),
    ).toBeNull();
    expect(swapRefusal(placed.project, id, module("Engine"))).toBe(
      "Turret takes Turret, Side weapon only.",
    );
    expect(swapRefusal(placed.project, id, module("Turret"))).toBeNull();
  });
});

describe("dragging onto a mount point", () => {
  const seat: Seat = { parentId: "hull", connector: "-y", to: "+y" };
  const drop = {
    position: [0, 0.8, 0] as Vec3,
    rotation: [0, 0, 0] as Vec3,
    scale: [1, 1, 1] as Vec3,
  };
  const ref = { id: "module-Turret", instance: "i1" };

  function withDragged(extra: Partial<LegoPiece>): LegoProject {
    const base = mounted();
    return {
      ...base,
      pieces: [...base.pieces, piece({ id: "gun", partId: "gun", ...extra })],
    };
  }

  it("joins a fitting module to the mount and the active loadout", () => {
    n = 0;
    const two = addLoadout(withDragged({ module: ref }), {
      newId,
      name: "Second",
    });
    const out = dragPiece(two, pack(), "gun", drop, seat, null, [
      module("Turret"),
    ]);
    const gun = out.pieces.find((p) => p.id === "gun");
    expect(gun?.parentId).toBe("hull");
    expect(gun?.connection?.to).toBe("+y");
    expect(gun?.inLoadout).toBe(true);
  });

  it("does not join a module of another category", () => {
    const out = dragPiece(
      withDragged({ module: ref }),
      pack(),
      "gun",
      drop,
      seat,
      null,
      [module("Engine")],
    );
    const gun = out.pieces.find((p) => p.id === "gun");
    expect(gun?.connection).toBeUndefined();
    expect(gun?.parentId).toBe("root");
    expect(
      seatRefusal(withDragged({ module: ref }), "gun", seat, [
        module("Engine"),
      ]),
    ).toBe("Turret takes Turret, Side weapon only.");
  });

  it("does not join a plain part", () => {
    const project = withDragged({});
    const out = dragPiece(project, pack(), "gun", drop, seat, null, []);
    expect(out.pieces.find((p) => p.id === "gun")?.connection).toBeUndefined();
    expect(seatRefusal(project, "gun", seat, [])).toBe(
      "Turret takes modules only.",
    );
  });

  it("joins anything to a connector that is not a mount", () => {
    const off: Seat = { parentId: "hull", connector: "-y", to: "-y" };
    const out = dragPiece(withDragged({}), pack(), "gun", drop, off, null, []);
    expect(out.pieces.find((p) => p.id === "gun")?.connection?.to).toBe("-y");
  });
});
