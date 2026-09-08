import { describe, expect, it } from "vitest";
import { digestsOf, forgetStale, recordExport, samePath } from "./exportRecord";
import type { ExportedFile, LegoExport, StaleExport } from "./model";

const BA = "/Users/someone/.spring/games/BA.sdd";
const SF = "/Users/someone/.spring/games/SF.sdd";

const DEF: Record<string, unknown> = { objectname: "skyfort" };

function file(path: string, sha256 = path): ExportedFile {
  return { path, sha256 };
}

function exported(over: Partial<LegoExport> = {}): LegoExport {
  return {
    dir: BA,
    at: "2026-09-07T12:00:00.000Z",
    unitName: "skyfort",
    def: DEF,
    files: [file(`${BA}/objects3d/skyfort.s3o`)],
    ...over,
  };
}

function next(over: Partial<Omit<LegoExport, "files">> = {}) {
  return {
    dir: BA,
    at: "2026-09-08T12:00:00.000Z",
    unitName: "skyfort",
    def: DEF,
    ...over,
  };
}

describe("samePath", () => {
  it("reads one folder written two ways as one folder", () => {
    expect(samePath(BA, `${BA}/`)).toBe(true);
    expect(samePath("C:\\games\\BA.sdd\\", "C:/Games/BA.sdd")).toBe(true);
    expect(samePath(BA, SF)).toBe(false);
  });
});

describe("digestsOf", () => {
  it("says each digest once, however many files carry it", () => {
    // Two units that override no collision volumes both get an empty
    // `_collision.lua`, so a repeated digest is ordinary rather than a bug.
    expect(digestsOf([file("a.lua", "empty"), file("b.lua", "empty")])).toEqual(
      ["empty"],
    );
  });
});

describe("recordExport", () => {
  it("has nothing to leave behind on a project's first export", () => {
    const written = [file(`${BA}/objects3d/skyfort.s3o`, "model")];
    const record = recordExport({}, next(), written);
    expect(record.staleExports).toEqual([]);
    expect(record.exported.files).toEqual(written);
  });

  /**
   * The bug in issue #2680. The old name's files are still in the folder and
   * the receipt about to be overwritten is the only thing that knows the name,
   * so it is moved aside rather than dropped.
   */
  it("keeps the old name when the unit is renamed and exported again", () => {
    const before = exported();
    const record = recordExport(
      { exported: before },
      next({ unitName: "skyfort2" }),
      [file(`${BA}/objects3d/skyfort2.s3o`, "model2")],
    );
    expect(record.staleExports).toEqual([
      {
        dir: BA,
        at: before.at,
        unitName: "skyfort",
        files: before.files,
      },
    ]);
    expect(record.exported.unitName).toBe("skyfort2");
  });

  /**
   * The export writes the script and the definition once and then leaves them
   * alone, so a second run under the same name writes neither. Dropping their
   * digests would lose the only proof that coilbox wrote them, and a later
   * rename would then refuse to clear its own files.
   */
  it("keeps the digests of files an earlier run wrote and this one kept", () => {
    const before = exported({
      files: [
        file(`${BA}/objects3d/skyfort.s3o`, "model1"),
        file(`${BA}/units/skyfort.lua`, "def1"),
      ],
    });
    const record = recordExport({ exported: before }, next(), [
      file(`${BA}/objects3d/skyfort.s3o`, "model2"),
    ]);
    expect(record.exported.files).toEqual([
      file(`${BA}/objects3d/skyfort.s3o`, "model2"),
      file(`${BA}/units/skyfort.lua`, "def1"),
    ]);
  });

  /**
   * Exporting into a second game is an install somebody asked for, not
   * something a rename left behind, so the first game's copy is left alone.
   */
  it("does not call another game's copy stale", () => {
    const record = recordExport(
      { exported: exported() },
      next({ dir: SF }),
      [],
    );
    expect(record.staleExports).toEqual([]);
  });

  it("clears the entry when the unit is renamed back", () => {
    const stale: StaleExport = {
      dir: BA,
      at: "",
      unitName: "skyfort",
      files: [file(`${BA}/units/skyfort.lua`, "def1")],
    };
    const record = recordExport(
      { exported: exported({ unitName: "skyfort2" }), staleExports: [stale] },
      next({ unitName: "skyfort" }),
      [],
    );
    expect(record.staleExports.map((e) => e.unitName)).toEqual(["skyfort2"]);
  });

  it("does not list one old name twice however often it is renamed away from", () => {
    const first = recordExport(
      { exported: exported() },
      next({ unitName: "skyfort2" }),
      [],
    );
    const second = recordExport(
      { exported: first.exported, staleExports: first.staleExports },
      next({ unitName: "skyfort3" }),
      [],
    );
    expect(second.staleExports.map((e) => e.unitName)).toEqual([
      "skyfort",
      "skyfort2",
    ]);
  });
});

describe("forgetStale", () => {
  it("drops the name whose files have gone and keeps the rest", () => {
    const one: StaleExport = {
      dir: BA,
      at: "",
      unitName: "skyfort",
      files: [],
    };
    const two: StaleExport = {
      dir: BA,
      at: "",
      unitName: "guntower",
      files: [],
    };
    expect(forgetStale([one, two], one)).toEqual([two]);
  });
});
