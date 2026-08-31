import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const saveMock = vi.fn();
const deleteMock = vi.fn();
const mediaImportMock = vi.fn();
const mediaDeleteMock = vi.fn();
const mediaReadMock = vi.fn();
const mediaWriteMock = vi.fn();

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
  scenarioMediaRead: (...args: unknown[]) => mediaReadMock(...args),
  scenarioMediaWrite: (...args: unknown[]) => mediaWriteMock(...args),
}));

import { parseScenarioJson, type Scenario } from "./model";
import {
  deleteScenario,
  deleteScenarioMedia,
  ensureBundledScenarioMedia,
  gatherScenarioExport,
  importScenarioMedia,
  isEditable,
  listScenarios,
  saveScenario,
  storeScenario,
} from "./storage";
import { encodeScenarioExport, readScenarioExport } from "./transfer";

/** A local document as the plugin hands it back. */
function stored(id: string, updatedAt: string) {
  return {
    source: "local" as const,
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

const PORTRAIT = "data:image/png;base64,aGk=";

/** A scenario whose one dialogue line names a portrait. */
function withPortrait(): Scenario {
  return scenario({
    dialogue: [
      { id: "d1", speaker: "Vega", text: "Hold.", portrait: "abc.png" },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockResolvedValue({});
  deleteMock.mockResolvedValue({});
  mediaImportMock.mockResolvedValue({ file: "abc.png" });
  mediaDeleteMock.mockResolvedValue({});
  mediaReadMock.mockResolvedValue({ dataUrl: PORTRAIT });
  mediaWriteMock.mockResolvedValue({});
});

/**
 * A bundled scenario as it sits in `.coilbox/scenarios/`: the file the builder
 * exported, document and clips together (issue #786).
 */
function bundled(id: string, media: Record<string, string> = {}) {
  return {
    source: "bundled" as const,
    json: encodeScenarioExport({
      scenario: scenario({ id, name: id, dialogue: [] }),
      media,
    }),
  };
}

describe("listScenarios", () => {
  it("parses stored documents and orders them by most recent edit", async () => {
    listMock.mockResolvedValue({
      items: [
        stored("older", "2026-07-01T00:00:00.000Z"),
        stored("newer", "2026-07-30T00:00:00.000Z"),
      ],
    });

    const list = await listScenarios();

    expect(list.map((l) => l.scenario.id)).toEqual(["newer", "older"]);
    expect(list.map((l) => l.source)).toEqual(["local", "local"]);
  });

  it("skips a document that fails validation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    listMock.mockResolvedValue({
      items: [
        { source: "local" as const, json: "{ not json" },
        stored("good", ""),
      ],
    });

    const list = await listScenarios();

    expect(list.map((l) => l.scenario.id)).toEqual(["good"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  /**
   * A distribution drops the export file in as-is, so the document has to be
   * unwrapped out of the container. Getting this wrong would drop every bundled
   * scenario from the list, and with it from the media sweep's keep set.
   */
  it("unwraps a bundled export file and says where it came from", async () => {
    listMock.mockResolvedValue({
      items: [stored("mine", ""), bundled("shipped")],
    });

    const list = await listScenarios();

    expect(list.map((l) => [l.scenario.id, l.source])).toEqual([
      ["mine", "local"],
      ["shipped", "bundled"],
    ]);
  });
});

describe("ensureBundledScenarioMedia", () => {
  it("writes a bundled scenario's clips into the media store", async () => {
    listMock.mockResolvedValue({
      items: [bundled("b1", { "abc.png": PORTRAIT })],
    });

    await ensureBundledScenarioMedia("b1");

    expect(mediaWriteMock).toHaveBeenCalledWith({
      scenarioId: "b1",
      file: "abc.png",
      dataUri: PORTRAIT,
    });
  });

  it("writes them once, however many times the scenario is played", async () => {
    listMock.mockResolvedValue({
      items: [bundled("b2", { "abc.png": PORTRAIT })],
    });

    await ensureBundledScenarioMedia("b2");
    await ensureBundledScenarioMedia("b2");

    expect(mediaWriteMock).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for a scenario that is not bundled", async () => {
    listMock.mockResolvedValue({ items: [stored("local-one", "")] });

    await ensureBundledScenarioMedia("local-one");

    expect(mediaWriteMock).not.toHaveBeenCalled();
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

  it("stamps the runtime version the document's triggers need", async () => {
    const saved = await saveScenario(
      scenario({
        runtimeVersion: 7,
        triggers: [
          {
            id: "t1",
            enabled: true,
            repeat: false,
            conditions: {
              op: "all",
              conditions: [{ type: "var", params: {} }],
            },
            actions: [],
          },
        ],
      }),
    );

    // Every shipped type is version 1, so a stored 7 was never computed here.
    expect(saved.runtimeVersion).toBe(1);
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
    expect(deleteMock).toHaveBeenCalledWith({ id: "s1", keepMedia: false });
  });

  it("keeps the dialogue clips when a campaign still plays them", async () => {
    await deleteScenario("s1", { keepMedia: true });
    expect(deleteMock).toHaveBeenCalledWith({ id: "s1", keepMedia: true });
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

describe("gatherScenarioExport", () => {
  it("inlines every referenced clip into the container", async () => {
    const gathered = await gatherScenarioExport(withPortrait());
    const read = readScenarioExport(encodeScenarioExport(gathered));

    expect(mediaReadMock).toHaveBeenCalledWith({
      scenarioId: "s1",
      file: "abc.png",
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.payload.media).toEqual({ "abc.png": PORTRAIT });
    expect(read.payload.scenario.dialogue[0].portrait).toBe("abc.png");
  });

  it("leaves out a clip that cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mediaReadMock.mockRejectedValue(new Error("gone"));

    const gathered = await gatherScenarioExport(withPortrait());

    expect(gathered.media).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("storeScenario", () => {
  it("stores the document under a fresh id and writes its clips", async () => {
    const saved = await storeScenario({
      scenario: withPortrait(),
      media: { "abc.png": PORTRAIT },
    });

    expect(saved.id).not.toBe("s1");
    expect(saved.dialogue[0].portrait).toBe("abc.png");
    expect(mediaWriteMock).toHaveBeenCalledWith({
      scenarioId: saved.id,
      file: "abc.png",
      dataUri: PORTRAIT,
    });
    const [{ id, json }] = saveMock.mock.calls[0] as [
      { id: string; json: string },
    ];
    expect(id).toBe(saved.id);
    expect(parseScenarioJson(json)?.name).toBe("s1");
  });

  it("drops a dialogue reference whose clip did not arrive", async () => {
    const saved = await storeScenario({ scenario: withPortrait(), media: {} });

    expect(saved.dialogue[0].portrait).toBeUndefined();
    expect(mediaWriteMock).not.toHaveBeenCalled();
  });
});

describe("what may be edited", () => {
  const doc = { id: "x" } as never;

  it("lets a local scenario be edited", () => {
    expect(isEditable({ scenario: doc, source: "local" })).toBe(true);
  });

  it("refuses a bundled scenario", () => {
    expect(isEditable({ scenario: doc, source: "bundled" })).toBe(false);
  });

  it("lets a mission in a loose game be edited in place", () => {
    expect(
      isEditable({
        scenario: doc,
        source: "game",
        origin: {
          gameName: "SF",
          archivePath: "/games/sf.sdd",
          folder: "first-contact",
          loose: true,
        },
      }),
    ).toBe(true);
  });

  it("refuses a mission in a packaged game", () => {
    expect(
      isEditable({
        scenario: doc,
        source: "game",
        origin: {
          gameName: "SF",
          archivePath: "/games/sf.sd7",
          folder: "first-contact",
          loose: false,
        },
      }),
    ).toBe(false);
  });
});
