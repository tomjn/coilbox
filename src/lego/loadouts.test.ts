import { describe, expect, it } from "vitest";

import { emptyDocument, reduceDocument } from "./document";
import {
  addLoadout,
  claimForLoadout,
  deleteLoadout,
  duplicateLoadout,
  loadoutPieceIds,
  parkedPieces,
  renameLoadout,
  setInLoadout,
  switchLoadout,
} from "./loadouts";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
} from "./model";

function piece(
  id: string,
  parentId: string | null,
  extra: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

const turretModule = { id: "turret-module", instance: "t1" };

/** A hull with a cannon module on it, saved before loadouts existed. */
function hull(): LegoProject {
  const project = newProject({
    id: "p",
    rootPieceId: "base",
    name: "Tank",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  return {
    ...project,
    pieces: [
      ...project.pieces,
      piece("hull", "base"),
      piece("cannon", "hull", { module: turretModule }),
      piece("barrel", "cannon", { module: turretModule }),
    ],
    animations: [{ presetId: "turret-track", params: { speed: 2 } }],
    unitDef: { buildcostmetal: 100 },
  };
}

let next = 0;
const newId = () => `id${++next}`;

/** Two loadouts: "Cannon", which keeps the cannon, and an empty "Rockets". */
function twoLoadouts(): LegoProject {
  next = 0;
  // Adding shows the cannon in both, from the chassis. Making it the loadout's
  // own gives each loadout a copy, and Rockets then takes its copy off.
  const added = addLoadout(hull(), { newId, name: "Rockets" });
  const owned = setInLoadout(added, "cannon", true);
  const bare = {
    ...owned,
    pieces: owned.pieces.filter((p) => p.id !== "cannon" && p.id !== "barrel"),
  };
  return switchLoadout(bare, owned.loadouts?.[0].id as string);
}

const names = (project: LegoProject) => project.pieces.map((p) => p.name);

describe("a project without loadouts", () => {
  it("parses as it did and writes no loadout fields", () => {
    const json = JSON.stringify(hull());
    const parsed = parseLegoProjectJson(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.loadouts).toBeUndefined();
    expect(parsed?.activeLoadout).toBeUndefined();
    expect(parsed).toEqual(hull());
  });

  it("has no loadout pieces", () => {
    expect(loadoutPieceIds(hull()).size).toBe(0);
  });

  it("drops a loadout flag left on a piece of a project with none", () => {
    const flagged = {
      ...hull(),
      pieces: hull().pieces.map((p) =>
        p.id === "cannon" ? { ...p, inLoadout: true as const } : p,
      ),
    };
    const parsed = parseLegoProjectJson(JSON.stringify(flagged));
    expect(parsed?.pieces.some((p) => p.inLoadout)).toBe(false);
  });
});

describe("adding a loadout", () => {
  it("turns the unit into a first loadout and switches to the new one", () => {
    next = 0;
    const added = addLoadout(hull(), { newId, name: "Rockets" });
    expect(added.loadouts?.map((l) => l.name)).toEqual([
      "Loadout 1",
      "Rockets",
    ]);
    expect(added.activeLoadout).toBe(added.loadouts?.[1].id);
  });

  it("starts the new loadout with the chassis and the old one's settings", () => {
    const project = twoLoadouts();
    const rockets = project.loadouts?.[1].id as string;
    const on = switchLoadout(project, rockets);
    expect(names(on)).toEqual(["base", "hull"]);
    expect(on.unitDef).toEqual({ buildcostmetal: 100 });
  });
});

describe("switching", () => {
  it("keeps each loadout's own pieces and settings", () => {
    const project = twoLoadouts();
    const [cannon, rockets] = (project.loadouts ?? []).map((l) => l.id);

    // Rockets: put a launcher on and change the cost.
    const onRockets = switchLoadout(project, rockets);
    const armed: LegoProject = {
      ...onRockets,
      pieces: [
        ...onRockets.pieces,
        piece("launcher", "hull", {
          module: { id: "rocket-module", instance: "r1" },
          inLoadout: true,
        }),
      ],
      unitDef: { buildcostmetal: 150 },
    };

    const back = switchLoadout(armed, cannon);
    expect(names(back)).toEqual(["base", "hull", "cannon", "barrel"]);
    expect(back.unitDef).toEqual({ buildcostmetal: 100 });
    expect(back.animations).toEqual(hull().animations);

    const again = switchLoadout(back, rockets);
    expect(names(again)).toEqual(["base", "hull", "launcher"]);
    expect(again.unitDef).toEqual({ buildcostmetal: 150 });
  });

  it("shares an edit to the chassis with every loadout", () => {
    const project = twoLoadouts();
    const [cannon, rockets] = (project.loadouts ?? []).map((l) => l.id);
    const moved = {
      ...project,
      pieces: project.pieces.map((p) =>
        p.id === "hull"
          ? { ...p, position: [0, 5, 0] as [number, number, number] }
          : p,
      ),
    };
    const onRockets = switchLoadout(moved, rockets);
    expect(onRockets.pieces.find((p) => p.id === "hull")?.position).toEqual([
      0, 5, 0,
    ]);
    expect(switchLoadout(onRockets, cannon).pieces).toHaveLength(4);
  });

  it("is the same project when the loadout is already active", () => {
    const project = twoLoadouts();
    expect(switchLoadout(project, project.activeLoadout as string)).toBe(
      project,
    );
  });

  it("puts a loadout's piece on the root when its chassis parent was deleted", () => {
    const project = twoLoadouts();
    const [cannon, rockets] = (project.loadouts ?? []).map((l) => l.id);
    const onRockets = switchLoadout(project, rockets);
    const noHull = {
      ...onRockets,
      pieces: onRockets.pieces.filter((p) => p.id !== "hull"),
    };
    const back = switchLoadout(noHull, cannon);
    expect(back.pieces.find((p) => p.id === "cannon")?.parentId).toBe("base");
  });

  it("renames a returning piece whose name the chassis took meanwhile", () => {
    const project = twoLoadouts();
    const [cannon, rockets] = (project.loadouts ?? []).map((l) => l.id);
    const onRockets = switchLoadout(project, rockets);
    const clash = {
      ...onRockets,
      pieces: [...onRockets.pieces, piece("other", "hull", { name: "cannon" })],
    };
    const back = switchLoadout(clash, cannon);
    expect(names(back)).toContain("cannon2");
    expect(new Set(names(back)).size).toBe(back.pieces.length);
  });
});

describe("undo across a switch", () => {
  it("steps back through each loadout's edits in order", () => {
    const project = twoLoadouts();
    const [cannon, rockets] = (project.loadouts ?? []).map((l) => l.id);
    const rename = (name: string, at: number) => ({
      type: "edit" as const,
      change: (p: LegoProject) => ({
        ...p,
        pieces: p.pieces.map((x) => (x.id === "hull" ? { ...x, name } : x)),
      }),
      at,
    });
    const actions = [
      { type: "open" as const, project },
      rename("hull_a", 1000),
      {
        type: "edit" as const,
        change: (p: LegoProject) => switchLoadout(p, rockets),
        at: 1010,
        alone: true,
      },
      rename("hull_b", 1020),
    ];
    let state = actions.reduce(reduceDocument, emptyDocument);
    expect(state.project?.activeLoadout).toBe(rockets);

    state = reduceDocument(state, { type: "undo" });
    expect(state.project?.activeLoadout).toBe(rockets);
    expect(names(state.project as LegoProject)).toContain("hull_a");

    state = reduceDocument(state, { type: "undo" });
    expect(state.project?.activeLoadout).toBe(cannon);
    expect(names(state.project as LegoProject)).toEqual([
      "base",
      "hull_a",
      "cannon",
      "barrel",
    ]);

    state = reduceDocument(state, { type: "redo" });
    expect(state.project?.activeLoadout).toBe(rockets);
  });
});

describe("duplicate, rename and delete", () => {
  it("duplicates the active loadout, its pieces included", () => {
    const project = twoLoadouts();
    const copy = duplicateLoadout(project, { newId });
    expect(copy.loadouts?.map((l) => l.name)).toEqual([
      "Loadout 1",
      "Loadout 1 copy",
      "Rockets",
    ]);
    expect(copy.activeLoadout).toBe(copy.loadouts?.[1].id);
    expect(names(copy)).toEqual(["base", "hull", "cannon", "barrel"]);
  });

  it("keeps the copy's edits apart from the original's", () => {
    const project = twoLoadouts();
    const original = project.activeLoadout as string;
    const copy = duplicateLoadout(project, { newId });
    const trimmed = {
      ...copy,
      pieces: copy.pieces.filter((p) => p.id !== "barrel"),
    };
    expect(names(switchLoadout(trimmed, original))).toContain("barrel");
  });

  it("duplicates a unit with no loadouts into two", () => {
    next = 0;
    const copy = duplicateLoadout(hull(), { newId });
    expect(copy.loadouts?.map((l) => l.name)).toEqual([
      "Loadout 1",
      "Loadout 1 copy",
    ]);
  });

  it("renames, refusing an empty name", () => {
    const project = twoLoadouts();
    const id = project.loadouts?.[1].id as string;
    expect(renameLoadout(project, id, " Missiles ").loadouts?.[1].name).toBe(
      "Missiles",
    );
    expect(renameLoadout(project, id, "  ")).toBe(project);
  });

  it("deletes an inactive loadout and its pieces", () => {
    const project = duplicateLoadout(twoLoadouts(), { newId });
    const rockets = project.loadouts?.[2].id as string;
    const gone = deleteLoadout(project, rockets);
    expect(gone.loadouts?.map((l) => l.name)).toEqual([
      "Loadout 1",
      "Loadout 1 copy",
    ]);
    expect(names(gone)).toEqual(names(project));
  });

  it("deletes the active loadout by switching to its neighbour", () => {
    const project = duplicateLoadout(twoLoadouts(), { newId });
    const active = project.activeLoadout as string;
    const gone = deleteLoadout(project, active);
    expect(gone.activeLoadout).toBe(project.loadouts?.[0].id);
    expect(gone.loadouts).toHaveLength(2);
  });

  it("goes back to a plain unit when one loadout is left", () => {
    const project = twoLoadouts();
    const rockets = project.loadouts?.[1].id as string;
    const plain = deleteLoadout(project, rockets);
    expect(plain.loadouts).toBeUndefined();
    expect(plain.activeLoadout).toBeUndefined();
    expect(plain.pieces.some((p) => p.inLoadout)).toBe(false);
    expect(names(plain)).toEqual(["base", "hull", "cannon", "barrel"]);
  });
});

describe("what belongs to a loadout", () => {
  it("makes a shared piece the loadout's own and gives every other loadout a copy", () => {
    next = 0;
    const project = addLoadout(hull(), { newId, name: "Rockets" });
    // Both loadouts show the cannon, from the chassis.
    const owned = setInLoadout(project, "cannon", true);
    expect([...loadoutPieceIds(owned)].sort()).toEqual(["barrel", "cannon"]);
    const first = owned.loadouts?.[0].id as string;
    expect(names(switchLoadout(owned, first))).toContain("cannon");
  });

  it("shares a loadout's piece with every loadout, dropping the others' copies", () => {
    const project = twoLoadouts();
    const rockets = project.loadouts?.[1].id as string;
    const shared = setInLoadout(project, "cannon", false);
    expect(loadoutPieceIds(shared).size).toBe(0);
    expect(names(switchLoadout(shared, rockets))).toContain("cannon");
  });

  it("claims a module dropped in while there are loadouts", () => {
    const project = twoLoadouts();
    const rockets = project.loadouts?.[1].id as string;
    const onRockets = switchLoadout(project, rockets);
    const dropped = {
      ...onRockets,
      pieces: [
        ...onRockets.pieces,
        piece("launcher", "hull", {
          module: { id: "rocket-module", instance: "r1" },
        }),
        piece("plate", "hull"),
      ],
    };
    const claimed = claimForLoadout(dropped, ["launcher", "plate"]);
    expect([...loadoutPieceIds(claimed)]).toEqual(["launcher"]);
  });

  it("claims nothing in a unit without loadouts", () => {
    const project = hull();
    expect(claimForLoadout(project, ["cannon"])).toBe(project);
  });

  it("lists the pieces parked in other loadouts", () => {
    const project = twoLoadouts();
    const rockets = project.loadouts?.[1].id as string;
    expect(
      parkedPieces(switchLoadout(project, rockets)).map((p) => p.id),
    ).toEqual(["cannon", "barrel"]);
  });
});

describe("a saved project with loadouts", () => {
  it("round trips", () => {
    const project = twoLoadouts();
    const onRockets = switchLoadout(
      project,
      project.loadouts?.[1].id as string,
    );
    const parsed = parseLegoProjectJson(JSON.stringify(onRockets));
    expect(parsed).toEqual(onRockets);
  });

  it("keeps the live unit when the active loadout is not in the list", () => {
    const project = twoLoadouts();
    const broken = { ...project, activeLoadout: "missing" };
    const parsed = parseLegoProjectJson(JSON.stringify(broken)) as LegoProject;
    expect(names(parsed)).toEqual(names(project));
    expect(parsed.loadouts?.some((l) => l.id === parsed.activeLoadout)).toBe(
      true,
    );
    expect(
      parsed.loadouts?.find((l) => l.id === parsed.activeLoadout)?.content,
    ).toBeUndefined();
  });
});
