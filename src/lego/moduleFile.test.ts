import { describe, expect, it } from "vitest";

import { parseClipboardPiece } from "./clipboard";
import { type LegoProject, newProject } from "./model";
import {
  MODULE_FILE_VERSION,
  parseModuleFile,
  resolveLoad,
  serializeModuleFile,
} from "./moduleFile";
import { moduleStamp } from "./moduleUpdates";

function module(id: string, name: string, partId: string | null = null) {
  const base = newProject({
    id,
    rootPieceId: "root",
    name,
    packId: "lego",
    packVersion: "1",
    now: "2026-07-29T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      {
        id: "p1",
        name: "barrel",
        parentId: "root",
        partId,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
    ],
  } satisfies LegoProject;
}

const NEW = { id: "fresh", now: "2026-10-18T00:00:00Z" };

describe("the module file", () => {
  it("carries a version and the pack the module was made with", () => {
    const text = serializeModuleFile(module("a", "Turret"));
    const data = JSON.parse(text);
    expect(data.fileVersion).toBe(MODULE_FILE_VERSION);
    expect(data.project.packId).toBe("lego");
    expect(data.project.packVersion).toBe("1");
  });

  it("round trips and is the same envelope the clipboard reads", () => {
    const source = module("a", "Turret", "part1");
    const text = serializeModuleFile(source);
    const parsed = parseModuleFile(text, new Set(["part1"]));
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.piece.project).toEqual(source);
    expect(parsed.piece.missingParts).toEqual([]);
    expect(parseClipboardPiece(text, new Set(["part1"])).ok).toBe(true);
  });

  it("loads a module with missing parts and names the pieces", () => {
    const text = serializeModuleFile(module("a", "Turret", "gone"));
    const parsed = parseModuleFile(text, new Set());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.piece.missingParts).toEqual(["barrel"]);
  });

  it("refuses a file that is not a module, with the reason", () => {
    expect(parseModuleFile("nope", new Set())).toMatchObject({
      ok: false,
      reason: "The file does not hold JSON.",
    });
    expect(parseModuleFile('{"a":1}', new Set())).toMatchObject({
      ok: false,
      reason: "The file does not hold a module.",
    });
  });

  it("refuses a file from a newer version", () => {
    const data = JSON.parse(serializeModuleFile(module("a", "Turret")));
    data.fileVersion = MODULE_FILE_VERSION + 1;
    const parsed = parseModuleFile(JSON.stringify(data), new Set());
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.reason).toContain("newer");
  });
});

describe("resolveLoad", () => {
  it("adds a module with a new id and name as it is", () => {
    const loaded = module("a", "Turret");
    expect(
      resolveLoad(loaded, [module("b", "Wheel")], "keep-both", NEW),
    ).toEqual(loaded);
  });

  it("gives a clashing id a new id and keeps the name when it is free", () => {
    const loaded = module("a", "Turret");
    const out = resolveLoad(loaded, [module("a", "Wheel")], "keep-both", NEW);
    expect(out.id).toBe("fresh");
    expect(out.name).toBe("Turret");
    expect(out.createdAt).toBe(NEW.now);
  });

  it("replace keeps the id and does not count the replaced name as taken", () => {
    const loaded = module("a", "Turret");
    const out = resolveLoad(loaded, [module("a", "Turret")], "replace", NEW);
    expect(out.id).toBe("a");
    expect(out.name).toBe("Turret");
  });

  it("makes a name unique among the other modules, ignoring case", () => {
    const existing = [module("b", "turret"), module("c", "Turret 2")];
    const out = resolveLoad(module("a", "Turret"), existing, "keep-both", NEW);
    expect(out.name).toBe("Turret 3");
  });

  it("never replaces a built in module, whatever the choice", () => {
    const builtIn = module("builtin.wheel", "Wheel");
    const out = resolveLoad(builtIn, [builtIn], "replace", NEW);
    expect(out.id).toBe("fresh");
    expect(out.name).toBe("Wheel 2");
  });

  it("gives a file that claims a built in id a new id even when none is listed", () => {
    const out = resolveLoad(module("builtin.gone", "Gone"), [], "replace", NEW);
    expect(out.id).toBe("fresh");
  });
});

describe("the content stamp across a file", () => {
  it("is unchanged by a round trip, and differs after a replace with new content", () => {
    const source = module("a", "Turret", "part1");
    const parsed = parseModuleFile(serializeModuleFile(source), new Set());
    if (!parsed.ok) throw new Error("did not parse");
    expect(moduleStamp(parsed.piece.project)).toBe(moduleStamp(source));

    const edited = module("a", "Turret", "part2");
    const replaced = resolveLoad(edited, [source], "replace", NEW);
    expect(replaced.id).toBe("a");
    expect(moduleStamp(replaced)).not.toBe(moduleStamp(source));
  });
});
