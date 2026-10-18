import { describe, expect, it } from "vitest";
import { loadoutFamily } from "./loadoutFamily";
import {
  addLoadout,
  deleteLoadout,
  renameLoadout,
  switchLoadout,
} from "./loadouts";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectData,
} from "./model";
import type { UnitStats } from "./unitStats";
import {
  chainOrder,
  setUpgradesFrom,
  upgradeChainProblems,
  upgradeRefusal,
} from "./upgradeChain";

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

/** A hull with a turret mount, and four loadouts a, b, c, d in that order. */
function four(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Tank",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  let n = 0;
  let project: LegoProject = {
    ...base,
    unitName: "tank",
    pieces: [
      ...base.pieces,
      piece("hull", "root", {
        mountPoints: [{ connector: "top", name: "Turret", accepts: ["gun"] }],
      }),
    ],
  };
  for (const name of ["b", "c", "d"]) {
    project = addLoadout(project, { newId: () => `l${++n}`, name });
  }
  // The first addLoadout also made the unit's own loadout, l1.
  return switchLoadout(renameLoadout(project, "l1", "a"), "l1");
}

function ids(project: LegoProject): string[] {
  return chainOrder(project.loadouts ?? []).map((l) => l.id);
}

const link = (p: LegoProject, id: string, from: string | null) =>
  setUpgradesFrom(p, id, from);

describe("setUpgradesFrom", () => {
  it("sets and clears the predecessor", () => {
    const p = four();
    const set = link(p, "l3", "l2");
    expect(set.loadouts?.find((l) => l.id === "l3")?.upgradesFrom).toBe("l2");
    const cleared = link(set, "l3", null);
    expect(cleared.loadouts?.find((l) => l.id === "l3")).not.toHaveProperty(
      "upgradesFrom",
    );
  });

  it("refuses itself, an unknown loadout and a loop", () => {
    const p = link(link(four(), "l3", "l2"), "l2", "l1");
    expect(link(p, "l1", "l1")).toBe(p);
    expect(link(p, "l1", "nope")).toBe(p);
    expect(link(p, "l1", "l3")).toBe(p);
    expect(link(p, "l1", "l2")).toBe(p);
    expect(upgradeRefusal(p, "l1", "l3")).toMatch(/already upgrades from/);
  });

  it("refuses a second upgrade from the same loadout", () => {
    const p = link(four(), "l2", "l1");
    expect(link(p, "l3", "l1")).toBe(p);
  });

  it("returns the same project when nothing changes", () => {
    const p = four();
    expect(link(p, "l2", null)).toBe(p);
  });
});

describe("chainOrder", () => {
  it("lists a chain from its start, whatever order it was linked in", () => {
    const p = link(link(link(four(), "l1", "l4"), "l4", "l3"), "l3", "l2");
    // l2 starts the chain, then l3, l4, l1. Nothing else is loose.
    expect(ids(p)).toEqual(["l2", "l3", "l4", "l1"]);
  });

  it("keeps loose loadouts in list order after the chain before them", () => {
    const p = link(four(), "l1", "l3");
    expect(ids(p)).toEqual(["l2", "l3", "l1", "l4"]);
  });

  it("lists every loadout once even when a saved file loops", () => {
    const p = four();
    const looped: LegoProject = {
      ...p,
      loadouts: p.loadouts?.map((l) =>
        l.id === "l1"
          ? { ...l, upgradesFrom: "l2" }
          : l.id === "l2"
            ? { ...l, upgradesFrom: "l1" }
            : l,
      ),
    };
    expect(ids(looped).sort()).toEqual(["l1", "l2", "l3", "l4"]);
  });
});

describe("upgradeChainProblems", () => {
  it("is empty for a clean chain", () => {
    expect(upgradeChainProblems(link(four(), "l2", "l1"))).toEqual([]);
  });

  it("reports a loop once and a branch", () => {
    const p = four();
    const bad: LegoProject = {
      ...p,
      loadouts: p.loadouts?.map((l) =>
        l.id === "l1"
          ? { ...l, upgradesFrom: "l2" }
          : l.id === "l2"
            ? { ...l, upgradesFrom: "l1" }
            : l.id === "l3" || l.id === "l4"
              ? { ...l, upgradesFrom: "l1" }
              : l,
      ),
    };
    const texts = upgradeChainProblems(bad).map((x) => x.message);
    expect(texts.filter((t) => t.includes("in a loop"))).toHaveLength(1);
    expect(texts.some((t) => /both upgrade from/.test(t))).toBe(true);
  });
});

describe("deleteLoadout in a chain", () => {
  it("links the successor to the deleted loadout's predecessor", () => {
    const p = link(link(four(), "l2", "l1"), "l3", "l2");
    const gone = deleteLoadout(p, "l2");
    expect(gone.loadouts?.find((l) => l.id === "l3")?.upgradesFrom).toBe("l1");
    expect(ids(gone)).toEqual(["l1", "l3", "l4"]);
  });

  it("makes the successor a chain start when the first goes", () => {
    const p = link(four(), "l2", "l1");
    const gone = deleteLoadout(p, "l1");
    expect(gone.loadouts?.find((l) => l.id === "l2")).not.toHaveProperty(
      "upgradesFrom",
    );
  });

  it("works when the deleted loadout is the active one", () => {
    const p = link(link(four(), "l2", "l1"), "l3", "l2");
    const gone = deleteLoadout(switchLoadout(p, "l2"), "l2");
    expect(gone.loadouts?.find((l) => l.id === "l3")?.upgradesFrom).toBe("l1");
  });
});

describe("saving", () => {
  it("round trips the chain", () => {
    const p = link(link(four(), "l2", "l1"), "l3", "l2");
    const back = parseLegoProjectData(JSON.parse(JSON.stringify(p)));
    expect(back?.loadouts?.map((l) => l.upgradesFrom)).toEqual([
      undefined,
      "l1",
      "l2",
      undefined,
    ]);
  });

  it("loads an old project without any link", () => {
    const p = four();
    const back = parseLegoProjectData(JSON.parse(JSON.stringify(p)));
    expect(back?.loadouts?.some((l) => "upgradesFrom" in l)).toBe(false);
    expect(ids(back as LegoProject)).toEqual(["l1", "l2", "l3", "l4"]);
  });

  it("drops a link to a loadout that is not there or to itself", () => {
    const p = four();
    const raw = JSON.parse(JSON.stringify(p));
    raw.loadouts[1].upgradesFrom = "gone";
    raw.loadouts[2].upgradesFrom = raw.loadouts[2].id;
    const back = parseLegoProjectData(raw);
    expect(back?.loadouts?.some((l) => "upgradesFrom" in l)).toBe(false);
  });
});

describe("loadoutFamily in a chain", () => {
  const stats = (cost: number): UnitStats => ({
    cost,
    health: 500,
    speed: 50,
    range: 300,
    dps: 20,
  });

  it("has columns in chain order with the predecessor's name", () => {
    const p = link(link(four(), "l1", "l3"), "l3", "l2");
    const family = loadoutFamily(p, () => stats(100));
    expect(family?.columns.map((c) => c.id)).toEqual(["l2", "l3", "l1", "l4"]);
    expect(family?.columns.map((c) => c.upgradesFrom)).toEqual([
      undefined,
      "b",
      "c",
      undefined,
    ]);
  });

  it("reads a stat as the change from the predecessor", () => {
    const p = link(link(four(), "l2", "l1"), "l3", "l2");
    const cost: Record<string, number> = { l1: 100, l2: 150, l3: 140, l4: 90 };
    const family = loadoutFamily(p, (u) => stats(cost[u.activeLoadout ?? ""]));
    const row = family?.rows.find((r) => r.id === "cost");
    expect(row?.cells).toEqual(["100", "150", "140", "90"]);
    expect(row?.changes).toEqual([null, "+50", "-10", null]);
  });

  it("reads a mount as added, removed or changed", () => {
    let p = link(link(four(), "l2", "l1"), "l3", "l2");
    // l1 is active. Give l1 a cannon, l2 a rocket, l3 nothing.
    p = {
      ...p,
      pieces: [
        ...p.pieces,
        piece("cannon", "hull", {
          connection: { connector: "base", to: "top" },
          inLoadout: true,
        }),
      ],
    };
    p = switchLoadout(p, "l2");
    p = {
      ...p,
      pieces: [
        ...p.pieces,
        piece("rocket", "hull", {
          connection: { connector: "base", to: "top" },
          inLoadout: true,
        }),
      ],
    };
    const family = loadoutFamily(p, () => null);
    const turret = family?.rows.find((r) => r.id === "hull:top");
    expect(turret?.cells).toEqual(["cannon", "rocket", null, null]);
    expect(turret?.changes).toEqual([null, "was cannon", "removed", null]);
  });

  it("has no changes for a family without a chain", () => {
    const family = loadoutFamily(four(), () => stats(100));
    expect(family?.rows.every((r) => r.changes === undefined)).toBe(true);
    expect(family?.columns.every((c) => c.upgradesFrom === undefined)).toBe(
      true,
    );
  });
});
