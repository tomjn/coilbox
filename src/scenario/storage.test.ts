import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const saveMock = vi.fn();
const deleteMock = vi.fn();
const mediaImportMock = vi.fn();
const mediaDeleteMock = vi.fn();

// storage.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbing the
// bindings module keeps the storage logic testable, the way pack.test.ts and
// luaReplSession.test.ts stub theirs.
vi.mock("./bindings", () => ({
  scenarioList: (...args: unknown[]) => listMock(...args),
  scenarioSave: (...args: unknown[]) => saveMock(...args),
  scenarioDelete: (...args: unknown[]) => deleteMock(...args),
  scenarioMediaImport: (...args: unknown[]) => mediaImportMock(...args),
  scenarioMediaDelete: (...args: unknown[]) => mediaDeleteMock(...args),
}));

import { parseScenarioJson, type Scenario } from "./model";
import {
  deleteScenario,
  deleteScenarioMedia,
  importScenarioMedia,
  listScenarios,
  saveScenario,
} from "./storage";

/** A stored document as the plugin hands it back. */
function stored(id: string, updatedAt: string): { json: string } {
  return {
    json: JSON.stringify({
      id,
      name: id,
      setup: { gameName: "BAR", mapName: "Comet Catcher" },
      updatedAt,
    }),
  };
}

/** A scenario in memory, as a caller would hold one. */
function scenario(overrides: Partial<Scenario> = {}): Scenario {
  const base = parseScenarioJson(stored("s1", "").json);
  if (!base) throw new Error("fixture is not a valid scenario");
  return { ...base, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockResolvedValue({});
  deleteMock.mockResolvedValue({});
  mediaImportMock.mockResolvedValue({ file: "abc.png" });
  mediaDeleteMock.mockResolvedValue({});
});

describe("listScenarios", () => {
  it("parses stored documents and orders them by most recent edit", async () => {
    listMock.mockResolvedValue({
      items: [
        stored("older", "2026-07-01T00:00:00.000Z"),
        stored("newer", "2026-07-30T00:00:00.000Z"),
      ],
    });

    const list = await listScenarios();

    expect(list.map((s) => s.id)).toEqual(["newer", "older"]);
  });

  it("skips a document that fails validation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    listMock.mockResolvedValue({
      items: [{ json: "{ not json" }, stored("good", "")],
    });

    const list = await listScenarios();

    expect(list.map((s) => s.id)).toEqual(["good"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("saveScenario", () => {
  it("stamps both timestamps on a first save", async () => {
    const saved = await saveScenario(
      scenario({ createdAt: "", updatedAt: "" }),
    );

    expect(saved.createdAt).not.toBe("");
    expect(saved.updatedAt).toBe(saved.createdAt);
  });

  it("keeps the original createdAt and moves updatedAt on a later save", async () => {
    const saved = await saveScenario(
      scenario({
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(saved.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(saved.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("writes JSON the parser accepts, under the scenario's id", async () => {
    await saveScenario(scenario({ name: "Ambush at the pass" }));

    const [{ id, json }] = saveMock.mock.calls[0] as [
      { id: string; json: string },
    ];
    expect(id).toBe("s1");
    expect(parseScenarioJson(json)?.name).toBe("Ambush at the pass");
  });
});

describe("deleteScenario and media", () => {
  it("deletes by id", async () => {
    await deleteScenario("s1");
    expect(deleteMock).toHaveBeenCalledWith({ id: "s1" });
  });

  it("returns the stored filename an import produced", async () => {
    const file = await importScenarioMedia("s1", "/tmp/portrait.png");

    expect(file).toBe("abc.png");
    expect(mediaImportMock).toHaveBeenCalledWith({
      scenarioId: "s1",
      srcPath: "/tmp/portrait.png",
    });
  });

  it("deletes a stored clip by name", async () => {
    await deleteScenarioMedia("s1", "abc.png");
    expect(mediaDeleteMock).toHaveBeenCalledWith({
      scenarioId: "s1",
      file: "abc.png",
    });
  });
});
