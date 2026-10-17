import { describe, expect, it } from "vitest";

import { identify } from "@/container/container";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import {
  moduleShareCode,
  readSharedModule,
  sharedModuleToSave,
} from "./moduleShare";

function module(extra: Partial<LegoPiece> = {}): LegoProject {
  const base = newProject({
    id: "m1",
    rootPieceId: "root",
    name: "Turret",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      {
        id: "p1",
        name: "barrel",
        parentId: "root",
        partId: "part1",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        ...extra,
      },
    ],
  };
}

const lifted = {
  partId: null,
  meshId: "m0",
  lifted: {
    game: { name: "Beyond All Reason", archive: "bar.sdd" },
    member: "objects3d/armcom.s3o",
  },
};

describe("moduleShareCode", () => {
  it("makes a module code that names the kind", () => {
    const made = moduleShareCode(module());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(identify(made.code).kind).toBe("module");
  });

  it("refuses a module holding a lifted piece and says why", () => {
    expect(moduleShareCode(module(lifted))).toEqual({
      ok: false,
      reason:
        "This module holds a piece from Beyond All Reason: barrel. Geometry lifted from a game cannot be uploaded to the hub.",
    });
  });
});

describe("readSharedModule", () => {
  it("round trips a module of parts", () => {
    const source = module();
    const made = moduleShareCode(source);
    if (!made.ok) throw new Error(made.reason);
    const read = readSharedModule(made.code, new Set(["part1"]));
    expect(read).toEqual({ ok: true, project: source, missingParts: [] });
  });

  it("lists the pieces whose part the loaded pack lacks", () => {
    const made = moduleShareCode(module());
    if (!made.ok) throw new Error(made.reason);
    const read = readSharedModule(made.code, new Set());
    expect(read.ok && read.missingParts).toEqual(["barrel"]);
  });

  it("never loads a module holding a lifted piece", () => {
    // Built by hand, the way a code from somewhere other than coilbox would be.
    const code = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "module",
      kindVersion: 1,
      payload: module(lifted),
    });
    expect(readSharedModule(code, new Set())).toEqual({
      ok: false,
      reason:
        "This module holds geometry from a game or a model, which a shared module cannot carry.",
    });
  });

  it("refuses something that is not a module", () => {
    expect(readSharedModule("hello", new Set())).toEqual({
      ok: false,
      reason: "That is not a coilbox module.",
    });
  });
});

describe("sharedModuleToSave", () => {
  const fresh = { id: "fresh", now: "2026-10-18T00:00:00Z" };

  it("keeps a module whose id and name are new as it came", () => {
    const made = moduleShareCode(module());
    if (!made.ok) throw new Error(made.reason);
    const saved = sharedModuleToSave(made.code, [], new Set(["part1"]), fresh);
    expect(saved.ok && saved.project.id).toBe("m1");
  });

  it("never replaces a module already there", () => {
    const made = moduleShareCode(module());
    if (!made.ok) throw new Error(made.reason);
    const saved = sharedModuleToSave(made.code, [module()], new Set(), fresh);
    expect(saved.ok && [saved.project.id, saved.project.name]).toEqual([
      "fresh",
      "Turret 2",
    ]);
  });
});
