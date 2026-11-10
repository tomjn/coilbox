import { describe, expect, it } from "vitest";
import type { BlueprintFileIO } from "@/blueprint/gameFile";
import type { RoleFindings } from "./inferRoles";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { mergeSkeletonFile, writeSkeletonEntries } from "./skeletonFile";
import {
  countOutcomes,
  judgeUnit,
  runSkeletonScan,
  type ScanDeps,
  type ScanUnit,
  scanEntries,
  scanUnit,
  unitsToScan,
} from "./skeletonScan";

function piece(
  id: string,
  parentId: string | null,
  position: [number, number, number],
): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

function unit(
  pieces: LegoPiece[],
  def: Record<string, unknown> | null = {},
): LegoProject {
  const base = newProject({
    id: "u",
    rootPieceId: "root",
    name: "Unit",
    packId: "p",
    packVersion: "1",
    now: "2026-11-10T00:00:00.000Z",
  });
  return {
    ...base,
    pieces: [base.pieces[0] as LegoPiece, ...pieces],
    ...(def ? { gameUnitDef: def } : {}),
  };
}

const findings = (
  proposals: RoleFindings["proposals"] = [],
  error: string | null = null,
): RoleFindings => ({ proposals, legs: [], notes: [], error });

const turret = (pieceName: string) => ({
  pieceName,
  role: "turret",
  evidence: "observed" as const,
  callin: "AimWeapon1",
});

const scanned: ScanUnit = { unit: "armllt", label: "LLT", member: "a.s3o" };

describe("judgeUnit", () => {
  it("counts a building whose one bone is its root as a full plan", () => {
    const scan = judgeUnit(scanned, unit([]), findings());
    expect(scan.outcome).toBe("full");
    expect(scan.missing).toEqual([]);
    expect(scan.entry?.evidence).toBe("observed");
    expect(Object.keys(scan.entry?.pieces ?? {})).toEqual(["base"]);
  });

  it("counts a plan with bones left unpicked as partial, naming them", () => {
    const scan = judgeUnit(
      scanned,
      unit([piece("turret", "root", [0, 10, 0])]),
      findings([turret("turret")]),
    );
    expect(scan.outcome).toBe("partial");
    expect(scan.plan).toBe("Turret building");
    expect(scan.missing).toEqual(["Barrel", "Muzzle flare"]);
    expect(scan.entry?.pieces.turret?.bone).toBe("turret");
  });

  it("gives no plan and no entry to a unit with no definition", () => {
    const scan = judgeUnit(scanned, unit([], null), findings());
    expect(scan.outcome).toBe("none");
    expect(scan.entry).toBeNull();
    expect(scan.note).toMatch(/no game definition/);
  });

  it("gives no plan to a script that would not run, with its reason", () => {
    const scan = judgeUnit(scanned, unit([]), findings([], "boom"));
    expect(scan.outcome).toBe("none");
    expect(scan.note).toBe("boom");
  });
});

function deps(over: Partial<ScanDeps> = {}): ScanDeps {
  return {
    read: async () => ({ project: unit([]), script: "", notes: [] }),
    infer: async () => findings(),
    ...over,
  };
}

describe("scanUnit", () => {
  it("reports a unit that will not read as having no plan", async () => {
    const scan = await scanUnit(
      scanned,
      deps({
        read: async () => {
          throw new Error("no model");
        },
      }),
    );
    expect(scan).toMatchObject({ outcome: "none", note: "no model" });
  });

  it("does not ask a unit with no script", async () => {
    let asked = false;
    const scan = await scanUnit(
      scanned,
      deps({
        read: async () => ({
          project: unit([]),
          script: null,
          notes: ["armllt has no animation script in Game."],
        }),
        infer: async () => {
          asked = true;
          return findings();
        },
      }),
    );
    expect(asked).toBe(false);
    expect(scan.note).toBe("armllt has no animation script in Game.");
  });
});

describe("runSkeletonScan", () => {
  const units = ["a", "b", "c"].map((name) => ({
    unit: name,
    label: name,
    member: `${name}.s3o`,
  }));

  it("scans every unit and reports each", async () => {
    const seen: number[] = [];
    const out = await runSkeletonScan(units, deps(), {
      signal: new AbortController().signal,
      onUnit: (_, done) => seen.push(done),
    });
    expect(out.map((s) => s.unit)).toEqual(["a", "b", "c"]);
    expect(seen).toEqual([1, 2, 3]);
    expect(countOutcomes(out)).toEqual({ full: 3, partial: 0, none: 0 });
  });

  it("stops at once, without waiting for the unit in hand", async () => {
    const controller = new AbortController();
    const out = await runSkeletonScan(
      units,
      deps({
        read: async (u) => {
          if (u.unit === "b") {
            controller.abort();
            return new Promise(() => {});
          }
          return { project: unit([]), script: "", notes: [] };
        },
      }),
      { signal: controller.signal },
    );
    expect(out.map((s) => s.unit)).toEqual(["a"]);
  });
});

describe("unitsToScan", () => {
  it("joins each unit to its model and keeps one with none", () => {
    const out = unitsToScan({
      files: [{ path: "objects3d/armllt.s3o" }],
      units: [
        { name: "armllt", fullName: "Light Laser Tower", objectName: "armllt" },
        { name: "ghost", objectName: "missing" },
      ],
      archive: "game.sdd",
    });
    expect(out).toEqual([
      {
        unit: "armllt",
        label: "Light Laser Tower",
        member: "objects3d/armllt.s3o",
      },
      { unit: "ghost", label: "ghost", member: null },
    ]);
  });
});

describe("writing a scan", () => {
  it("keeps a built entry and adds the observed ones", async () => {
    const files = new Map<string, string>();
    const io: BlueprintFileIO = {
      read: async (path) => files.get(path) ?? null,
      write: async (path, text) => {
        files.set(path, text);
      },
    } as BlueprintFileIO;
    const built = {
      evidence: "built" as const,
      pieces: { base: { bone: "base", label: "Base" } },
    };
    const write = await writeSkeletonEntries(io, "/root", "TG", {});
    files.set(write.path, mergeSkeletonFile(null, { armllt: built }));

    const scans = [
      judgeUnit(scanned, unit([]), findings()),
      judgeUnit({ ...scanned, unit: "armmex" }, unit([]), findings()),
    ];
    const out = await writeSkeletonEntries(
      io,
      "/root",
      "TG",
      scanEntries(scans),
    );
    expect(out.units).toEqual(["armmex"]);
    const file = JSON.parse(files.get(out.path) ?? "");
    expect(file.units.armllt).toEqual(built);
    expect(file.units.armmex.evidence).toBe("observed");
  });
});
