import { describe, expect, it } from "vitest";

import type { UnitDatasetEntry } from "../content/bindings";
import { gameModelRows, modelKey } from "./gameModels";
import { LEGO_SCHEMA_VERSION, type LegoProject } from "./model";

function unit(name: string, objectName?: string, fullName?: string) {
  return { name, objectName, fullName } satisfies UnitDatasetEntry;
}

function project(id: string, imported: LegoProject["imported"]): LegoProject {
  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id,
    name: id,
    unitName: id,
    packId: "base",
    packVersion: "1",
    imported,
    createdAt: "now",
    updatedAt: "now",
    rootPieceId: "root",
    pieces: [],
  };
}

describe("modelKey", () => {
  it("ignores case, the objects3d prefix, the extension and the slash used", () => {
    expect(modelKey("Objects3D/Mech/Anubis.s3o")).toBe("mech/anubis");
    expect(modelKey("mech\\anubis")).toBe("mech/anubis");
    expect(modelKey("MECH/ANUBIS.S3O")).toBe("mech/anubis");
  });

  it("keeps a bare objectname, which is how most games write one", () => {
    expect(modelKey("AAFUS")).toBe("aafus");
  });
});

describe("gameModelRows", () => {
  const files = [
    { path: "objects3d/Mech/anubis.s3o" },
    { path: "objects3d/wreck.s3o" },
    { path: "objects3d/peewee.3do" },
    { path: "unittextures/anubis.dds" },
    { path: ".git/HEAD" },
  ];

  it("names a model after the unit that names it, not after its file", () => {
    const { rows } = gameModelRows({
      files,
      units: [unit("cc_anubis", "mech/Anubis.s3o", "Anubis ABS-3L")],
      projects: [],
      archive: "Game.sdd",
    });

    const anubis = rows.find((r) => r.member === "objects3d/Mech/anubis.s3o");
    expect(anubis?.label).toBe("Anubis ABS-3L");
    expect(anubis?.unit).toBe("cc_anubis");
  });

  it("shows a model no unitdef names under its file name rather than hiding it", () => {
    const { rows } = gameModelRows({
      files,
      units: [unit("cc_anubis", "mech/Anubis.s3o")],
      projects: [],
      archive: "Game.sdd",
    });

    const wreck = rows.find((r) => r.member === "objects3d/wreck.s3o");
    expect(wreck?.label).toBe("wreck");
    expect(wreck?.unit).toBeUndefined();
  });

  it("counts a 3do unit out rather than listing one that cannot be opened", () => {
    const { rows, threeDoUnits, unresolvedUnits } = gameModelRows({
      files,
      units: [unit("peewee", "PEEWEE")],
      projects: [],
      archive: "Game.sdd",
    });

    expect(rows.some((r) => r.member.endsWith(".3do"))).toBe(false);
    expect(threeDoUnits).toBe(1);
    // Not both: a 3do is a format this cannot read, not a missing file, and a
    // footnote claiming the wrong reason is worse than no footnote.
    expect(unresolvedUnits).toBe(0);
  });

  it("counts a unit whose model this archive does not hold apart from a 3do one", () => {
    const { threeDoUnits, unresolvedUnits } = gameModelRows({
      files,
      units: [unit("ghost", "nothing/here")],
      projects: [],
      archive: "Game.sdd",
    });

    expect(unresolvedUnits).toBe(1);
    expect(threeDoUnits).toBe(0);
  });

  it("says which project a model is already open as, so it is not opened twice", () => {
    const already = project("p1", {
      source: "/games/Game.sdd/objects3d/Mech/anubis.s3o",
      game: {
        name: "A Game",
        archive: "Game.sdd",
        member: "objects3d/mech/ANUBIS.s3o",
      },
    });

    const { rows } = gameModelRows({
      files,
      units: [unit("cc_anubis", "mech/Anubis.s3o")],
      projects: [already],
      archive: "Game.sdd",
    });

    expect(
      rows.find((r) => r.member === "objects3d/Mech/anubis.s3o")?.openedAs,
    ).toBe("p1");
    expect(
      rows.find((r) => r.member === "objects3d/wreck.s3o")?.openedAs,
    ).toBeUndefined();
  });

  it("matches a unit opened through the file dialog before the picker existed", () => {
    const already = project("p2", {
      source: "/games/Game.sdd/objects3d/Mech/anubis.s3o",
    });

    const { rows } = gameModelRows({
      files,
      units: [],
      projects: [already],
      archive: "Game.sdd",
      archivePath: "/games/Game.sdd",
    });

    expect(
      rows.find((r) => r.member === "objects3d/Mech/anubis.s3o")?.openedAs,
    ).toBe("p2");
  });

  it("does not claim a model is open because another game holds one like it", () => {
    const already = project("p3", {
      source: "/games/Other.sdd/objects3d/Mech/anubis.s3o",
      game: {
        name: "Other",
        archive: "Other.sdd",
        member: "objects3d/Mech/anubis.s3o",
      },
    });

    const { rows } = gameModelRows({
      files,
      units: [],
      projects: [already],
      archive: "Game.sdd",
      archivePath: "/games/Game.sdd",
    });

    expect(
      rows.find((r) => r.member === "objects3d/Mech/anubis.s3o")?.openedAs,
    ).toBeUndefined();
  });

  it("gives two units that share one model a row each, under their own names", () => {
    const { rows } = gameModelRows({
      files,
      units: [
        unit("cc_anubis", "mech/Anubis.s3o", "Anubis"),
        unit("cc_anubis_hat", "mech/Anubis.s3o", "Anubis with a hat"),
      ],
      projects: [],
      archive: "Game.sdd",
    });

    const both = rows.filter((r) => r.member === "objects3d/Mech/anubis.s3o");
    expect(both.map((r) => r.label)).toEqual(["Anubis", "Anubis with a hat"]);
  });

  it("sorts by what the row is called, so a list reads alphabetically", () => {
    const { rows } = gameModelRows({
      files: [
        { path: "objects3d/zebra.s3o" },
        { path: "objects3d/apple.s3o" },
        { path: "objects3d/mid.s3o" },
      ],
      units: [unit("mid", "mid", "Middle")],
      projects: [],
      archive: "Game.sdd",
    });

    expect(rows.map((r) => r.label)).toEqual(["apple", "Middle", "zebra"]);
  });

  it("ignores files outside objects3d, so a texture is never offered as a model", () => {
    const { rows } = gameModelRows({
      files: [
        { path: "unittextures/thing.s3o" },
        { path: "objects3d/thing.s3o" },
      ],
      units: [],
      projects: [],
      archive: "Game.sdd",
    });

    expect(rows.map((r) => r.member)).toEqual(["objects3d/thing.s3o"]);
  });
});
