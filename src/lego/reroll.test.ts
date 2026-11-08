import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { bodyPlanById } from "./bodyPlans";
import { resolveConnections } from "./connectors";
import { emptyDocument, reduceDocument } from "./document";
import { generateCheckedUnit } from "./generateChecked";
import { pieceStamp } from "./generatedStamps";
import { pruneInstanceSettings } from "./instanceSettings";
import {
  type LegoPiece,
  type LegoProject,
  parseLegoProjectJson,
} from "./model";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import {
  editedPieces,
  keptPieces,
  partPieces,
  rerollUnit,
  setPartLocked,
} from "./reroll";
import { starterModules } from "./starterModules";

/** The bundled parts with their geometry, which every check measures. */
function bundledPack(): LoadedPack {
  const dir = fileURLToPath(
    new URL("../../src-tauri/legoparts/", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${dir}pack.json`, "utf8"),
  ) as LegoPackManifest;
  const blob = new Uint8Array(gunzipSync(readFileSync(`${dir}parts.bin.gz`)));
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const vertexOffset = view.getUint32(16, true);
  const vertexBytes = view.getUint32(20, true);
  const indexOffset = view.getUint32(24, true);
  const indexBytes = view.getUint32(28, true);
  const vertices = new Float32Array(
    blob.slice(vertexOffset, vertexOffset + vertexBytes).buffer,
  );
  const indices = new Uint16Array(
    blob.slice(indexOffset, indexOffset + indexBytes).buffer,
  );
  const merged = mergePacks([{ manifest, vertices, indices }]);
  return {
    ...merged,
    vertices,
    indices,
    library: { packs: [manifest], atlases: [], dir: "", problems: [] },
  };
}

const pack = bundledPack();
const modules = starterModules(pack);

function generated(
  seed: number,
  planId: string,
  job: "assault" | "builder",
): LegoProject {
  const plan = bodyPlanById(planId);
  if (!plan) throw new Error(`no plan ${planId}`);
  const result = generateCheckedUnit(
    { seed, plan, job, size: "medium" },
    {
      id: "unit",
      rootPieceId: "root",
      now: "2026-11-08T00:00:00.000Z",
      pack,
      modules,
    },
  );
  if (result.status !== "ok") throw new Error(result.message);
  return result.unit;
}

function reroll(project: LegoProject): LegoProject {
  const result = rerollUnit(project, { pack, modules });
  if (result.status !== "ok") throw new Error(result.message);
  return result.unit;
}

/** A piece as it hangs in the unit: everything but its lock. */
function placed(piece: LegoPiece | undefined) {
  if (!piece) return undefined;
  const { locked: _locked, ...rest } = piece;
  return rest;
}

const unit = generated(1, "biped", "assault");
const slot = (project: LegoProject, name: string) =>
  project.generated?.modules.find((m) => m.slot === name)?.instance;
const instancePieces = (project: LegoProject, instance: string | undefined) =>
  project.pieces.filter((p) => p.module?.instance === instance);

describe("stamps on a generated unit", () => {
  it("say nothing was edited, also after saving and an edit's join pass", () => {
    expect(unit.generated?.stamps).toBeDefined();
    expect(editedPieces(unit).size).toBe(0);
    const reloaded = parseLegoProjectJson(JSON.stringify(unit));
    expect(reloaded && editedPieces(reloaded).size).toBe(0);
    const joined = pruneInstanceSettings(
      resolveConnections(unit, pack).project,
    );
    expect(editedPieces(joined).size).toBe(0);
  });

  it("tell a moved piece and an added piece from the generator's", () => {
    const covering = unit.generated?.covering?.[0]?.piece as string;
    const moved: LegoProject = {
      ...unit,
      pieces: [
        ...unit.pieces.map((p) =>
          p.id === covering
            ? {
                ...p,
                position: [
                  p.position[0] + 1,
                  p.position[1],
                  p.position[2],
                ] as LegoPiece["position"],
              }
            : p,
        ),
        {
          ...(unit.pieces[0] as LegoPiece),
          id: "added",
          parentId: unit.rootPieceId,
          bone: undefined,
        },
      ],
    };
    expect([...editedPieces(moved)].sort()).toEqual(["added", covering].sort());
  });

  it("ignore locking and hiding a piece", () => {
    const piece = unit.pieces[1] as LegoPiece;
    expect(pieceStamp({ ...piece, locked: true, hidden: true })).toBe(
      pieceStamp(piece),
    );
  });
});

describe("locks", () => {
  it("lock a module whole and survive saving", () => {
    const weapon = slot(unit, "weapon.1");
    const one = instancePieces(unit, weapon)[0] as LegoPiece;
    const locked = setPartLocked(unit, one.id, true);
    expect(partPieces(locked, one.id).length).toBe(
      instancePieces(unit, weapon).length,
    );
    const reloaded = parseLegoProjectJson(JSON.stringify(locked));
    expect(
      reloaded?.pieces.filter((p) => p.locked === true).map((p) => p.id),
    ).toEqual(instancePieces(unit, weapon).map((p) => p.id));
    expect(reloaded && keptPieces(reloaded)).toEqual(keptPieces(locked));
  });

  it("free a piece that was never edited by clearing its flag", () => {
    const id = unit.generated?.covering?.[0]?.piece as string;
    const freed = setPartLocked(setPartLocked(unit, id, true), id, false);
    expect(freed.pieces.find((p) => p.id === id)?.locked).toBeUndefined();
  });
});

describe("rerollUnit", () => {
  it("keeps a locked module in place with its joins and rerolls the rest", () => {
    const chassis = slot(unit, "chassis.1");
    const top = instancePieces(unit, chassis)[0] as LegoPiece;
    const locked = setPartLocked(unit, top.id, true);
    const after = reroll(locked);
    for (const piece of instancePieces(unit, chassis)) {
      expect(placed(after.pieces.find((p) => p.id === piece.id))).toEqual(
        placed(piece),
      );
    }
    expect(slot(after, "chassis.1")).toBe(chassis);
    // The weapon is new, and hangs on the kept chassis.
    const weapon = slot(after, "weapon.1");
    expect(weapon).not.toBe(slot(unit, "weapon.1"));
    const chassisIds = new Set(instancePieces(unit, chassis).map((p) => p.id));
    const weaponTop = instancePieces(after, weapon).find(
      (p) => !instancePieces(after, weapon).some((q) => q.id === p.parentId),
    );
    expect(chassisIds.has(weaponTop?.parentId ?? "")).toBe(true);
    expect(after.skeleton).toEqual(unit.skeleton);
  });

  it("keeps a hand-edited piece unless it is freed", () => {
    const covering = unit.generated?.covering?.[0]?.piece as string;
    const edited: LegoProject = {
      ...unit,
      pieces: unit.pieces.map((p) =>
        p.id === covering
          ? {
              ...p,
              scale: [
                p.scale[0] * 1.5,
                p.scale[1],
                p.scale[2],
              ] as LegoPiece["scale"],
            }
          : p,
      ),
    };
    const before = edited.pieces.find((p) => p.id === covering);
    const after = reroll(edited);
    expect(placed(after.pieces.find((p) => p.id === covering))).toEqual(
      placed(before),
    );
    // Still counts as edited, so a second reroll keeps it too.
    expect(editedPieces(after).has(covering)).toBe(true);

    const freed = reroll(setPartLocked(edited, covering, false));
    expect(freed.pieces.some((p) => p.id === covering)).toBe(false);
  });

  it("leaves a deleted part deleted, through a second reroll too", () => {
    const entry = unit.generated?.covering?.[0];
    if (!entry) throw new Error("no covering");
    const bone = entry.bone;
    const doomed = new Set([
      ...(unit.generated?.covering ?? [])
        .filter((c) => c.bone === bone)
        .map((c) => c.piece),
      ...instancePieces(unit, slot(unit, "weapon.1")).map((p) => p.id),
    ]);
    const deleted = {
      ...unit,
      pieces: unit.pieces.filter((p) => !doomed.has(p.id)),
    };
    const coveringOn = (project: LegoProject) => {
      const ids = new Set(project.pieces.map((p) => p.id));
      return (project.generated?.covering ?? []).filter(
        (c) => c.bone === bone && ids.has(c.piece),
      );
    };
    const once = reroll(deleted);
    const twice = reroll(once);
    for (const after of [once, twice]) {
      expect(coveringOn(after)).toEqual([]);
      expect(instancePieces(after, slot(after, "weapon.1"))).toEqual([]);
    }
  });

  it("treats a bone's covering as one part", () => {
    const covering = unit.generated?.covering ?? [];
    const bone = covering.find(
      (c) => covering.filter((d) => d.bone === c.bone).length > 1,
    )?.bone;
    if (!bone) throw new Error("no bone with two covering parts");
    const tiles = covering.filter((c) => c.bone === bone).map((c) => c.piece);
    const locked = setPartLocked(unit, tiles[0] as string, true);
    expect(partPieces(unit, tiles[0] as string).sort()).toEqual(
      [...tiles].sort(),
    );
    const after = reroll(locked);
    for (const id of tiles) {
      expect(placed(after.pieces.find((p) => p.id === id))).toEqual(
        placed(unit.pieces.find((p) => p.id === id)),
      );
    }
  });

  it("records the seed, and the same reroll gives the same unit", () => {
    const result = rerollUnit(unit, { pack, modules });
    if (result.status !== "ok") throw new Error(result.message);
    expect(result.seed).toBeGreaterThan(unit.generated?.seed ?? 0);
    expect(result.unit.generated?.seed).toBe(result.seed);
    expect(JSON.stringify(reroll(unit))).toBe(JSON.stringify(result.unit));
  });

  it("is one undo step", () => {
    const opened = reduceDocument(emptyDocument, {
      type: "open",
      project: unit,
    });
    const rerolled = reduceDocument(opened, {
      type: "edit",
      change: reroll,
      at: 1000,
      alone: true,
    });
    expect(rerolled.project).not.toBe(unit);
    const undone = reduceDocument(rerolled, { type: "undo" });
    expect(undone.project).toBe(unit);
  });

  // As for `generateUnit` (#5113): the engines differ in the last bit of these.
  it("calls no maths function the engines disagree on", () => {
    const names = [
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "log",
      "exp",
      "pow",
      "hypot",
      "cbrt",
    ] as const;
    const originals = new Map<string, unknown>();
    for (const name of names) {
      originals.set(name, Math[name]);
      Object.defineProperty(Math, name, {
        configurable: true,
        writable: true,
        value: () => {
          throw new Error(`rerollUnit called Math.${name}`);
        },
      });
    }
    try {
      const top = instancePieces(unit, slot(unit, "chassis.1"))[0] as LegoPiece;
      reroll(setPartLocked(unit, top.id, true));
      reroll(unit);
    } finally {
      for (const name of names) {
        Object.defineProperty(Math, name, {
          configurable: true,
          writable: true,
          value: originals.get(name),
        });
      }
    }
  });

  it("matches the stored reroll, on every engine", async () => {
    const chassis = instancePieces(
      unit,
      slot(unit, "chassis.1"),
    )[0] as LegoPiece;
    const after = reroll(setPartLocked(unit, chassis.id, true));
    await expect(`${JSON.stringify(after, null, 2)}\n`).toMatchFileSnapshot(
      "fixtures/generated/reroll-biped-assault-medium-1.json",
    );
  });
});
