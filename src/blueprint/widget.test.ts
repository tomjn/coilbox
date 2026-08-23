import { describe, expect, it } from "vitest";
import type { StoredBlueprint } from "./library";
import {
  WIDGET_LIBRARY_FILE,
  WIDGET_SPOOL_FILE,
  emptySpoolText,
  readSpool,
  spoolRecords,
  widgetLibraryText,
} from "./widget";

const record = (patch: Partial<StoredBlueprint> = {}): StoredBlueprint => ({
  id: "b1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  layout: {
    game: { name: "Beyond All Reason test-1", shortname: "BAR" },
    name: "Eco",
    ordered: true,
    buildings: [
      { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
      {
        def: "armwin",
        offset: { x: 32, z: -16 },
        facing: 3,
        originalName: "corwin",
      },
    ],
    footprints: { armsolar: { x: 4, z: 4 } },
  },
  ...patch,
});

describe("the library file the widget reads", () => {
  it("lives under the content root's LuaUI config", () => {
    expect(WIDGET_LIBRARY_FILE).toBe("LuaUI/Config/coilbox_blueprints.json");
    expect(WIDGET_SPOOL_FILE).toBe(
      "LuaUI/Config/coilbox_blueprints_spool.json",
    );
  });

  it("is version 1 with one entry per record, the id beside the payload", () => {
    const doc = JSON.parse(widgetLibraryText([record()]));
    expect(doc.version).toBe(1);
    expect(doc.blueprints).toHaveLength(1);
    expect(doc.blueprints[0]).toEqual({
      id: "b1",
      game: { name: "Beyond All Reason test-1", shortname: "BAR" },
      name: "Eco",
      ordered: true,
      buildings: [
        { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
        {
          def: "armwin",
          offset: { x: 32, z: -16 },
          facing: 3,
          originalName: "corwin",
        },
      ],
      footprints: { armsolar: { x: 4, z: 4 } },
    });
  });

  it("leaves timestamps and provenance out, which the widget has no use for", () => {
    const text = widgetLibraryText([record()]);
    expect(text).not.toContain("createdAt");
    expect(text).not.toContain("source");
  });

  it("writes an empty library as an empty list", () => {
    expect(JSON.parse(widgetLibraryText([]))).toEqual({
      version: 1,
      blueprints: [],
    });
  });
});

describe("the spool the widget writes", () => {
  const spool = JSON.stringify({
    version: 1,
    blueprints: [
      {
        name: "Base on Supreme Isthmus 1",
        game: { name: "Beyond All Reason test-1", shortname: "BAR" },
        designedFor: "Supreme Isthmus v1.9",
        recordedAt: 1787000000,
        ordered: false,
        buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 2 }],
        footprints: { armsolar: { x: 4, z: 4 } },
      },
      { name: "broken", buildings: "no" },
      {
        name: "Base on Supreme Isthmus 2",
        buildings: [],
        footprints: {},
      },
    ],
  });

  it("reads the entries that are payloads and counts the ones that are not", () => {
    const read = readSpool(spool);
    expect(read.entries).toHaveLength(2);
    expect(read.skipped).toBe(1);
    expect(read.entries[0].layout.name).toBe("Base on Supreme Isthmus 1");
    expect(read.entries[0].layout.designedFor).toBe("Supreme Isthmus v1.9");
    expect(read.entries[0].layout.buildings[0].facing).toBe(2);
    expect(read.entries[0].recordedAt).toBe(1787000000);
    expect(read.entries[1].recordedAt).toBeUndefined();
  });

  it("treats no file as nothing to collect", () => {
    expect(readSpool(null)).toEqual({ entries: [], skipped: 0 });
    expect(readSpool("")).toEqual({ entries: [], skipped: 0 });
  });

  it("refuses a file it cannot read rather than calling it empty", () => {
    expect(() => readSpool("{ nope")).toThrow(/not JSON|could not/i);
    expect(() => readSpool(JSON.stringify({ version: 2, blueprints: [] }))).toThrow(
      /version 2/,
    );
    expect(() => readSpool("[]")).toThrow();
  });

  it("reads a spool with no blueprints key as empty", () => {
    expect(readSpool(JSON.stringify({ version: 1 }))).toEqual({
      entries: [],
      skipped: 0,
    });
  });

  it("writes back an empty spool the widget will accept", () => {
    expect(readSpool(emptySpoolText())).toEqual({ entries: [], skipped: 0 });
  });

  it("mints library records with fresh ids and a widget source", () => {
    const at = new Date("2026-08-23T12:00:00.000Z");
    const records = spoolRecords(readSpool(spool).entries, "2025.04.08", at);
    expect(records).toHaveLength(2);
    expect(records[0].id).not.toBe(records[1].id);
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(records[0].createdAt).toBe("");
    expect(records[0].layout.name).toBe("Base on Supreme Isthmus 1");
    expect(records[0].source).toEqual({
      kind: "widget",
      engine: "2025.04.08",
      at: "2026-08-23T12:00:00.000Z",
    });
  });
});
