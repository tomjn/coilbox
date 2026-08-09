import { describe, expect, it } from "vitest";
import { encodeContainerJson, identify } from "../container/container";
import { computeMissingRequirements } from "../content/resolveContent";
import { parseScenario, type Scenario } from "./model";
import {
  dropMissingDialogueMedia,
  encodeScenarioCode,
  encodeScenarioExport,
  readScenarioExport,
  scenarioContentRequirements,
  scenarioImportErrorMessage,
  scenarioMediaFiles,
} from "./transfer";

const PORTRAIT = "data:image/png;base64,aGk=";
const VOICE = "data:audio/ogg;base64,b2dn";

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  const base = parseScenario({
    id: "s1",
    name: "Ambush at the pass",
    setup: { gameName: "BAR", mapName: "Comet Catcher", participants: [] },
    zones: [
      {
        id: "pass",
        name: "The pass",
        shape: "circle",
        center: { x: 1, z: 2 },
        radius: 300,
      },
    ],
    dialogue: [
      {
        id: "d1",
        speaker: "Vega",
        text: "Hold the line.",
        portrait: "a.png",
        audio: "a.ogg",
      },
      { id: "d2", speaker: "Vega", text: "Again.", portrait: "a.png" },
    ],
    triggers: [],
  });
  if (!base) throw new Error("fixture is not a valid scenario");
  return { ...base, ...overrides };
}

const exported = () => ({
  scenario: scenario(),
  media: { "a.png": PORTRAIT, "a.ogg": VOICE },
});

describe("scenarioMediaFiles", () => {
  it("lists each referenced clip once", () => {
    expect(scenarioMediaFiles(scenario()).sort()).toEqual(["a.ogg", "a.png"]);
  });

  it("is empty for a scenario with no dialogue media", () => {
    expect(scenarioMediaFiles(scenario({ dialogue: [] }))).toEqual([]);
  });
});

describe("scenarioContentRequirements", () => {
  /** What the shared gate measures a requirement against. */
  const installed = (games: string[], maps: string[]) => ({
    games: games.map((name) => ({ name })),
    maps,
    engineVersions: [],
  });

  it("asks for the game and the map the setup names", () => {
    const reqs = scenarioContentRequirements(scenario());

    expect(reqs.map((r) => [r.kind, r.label])).toEqual([
      ["game", "BAR"],
      ["map", "Comet Catcher"],
    ]);
  });

  it("is satisfied by an install that has both", () => {
    const missing = computeMissingRequirements(
      scenarioContentRequirements(scenario()),
      installed(["BAR"], ["Comet Catcher"]),
    );

    expect(missing).toEqual([]);
  });

  it("reports whichever of the two is not installed", () => {
    const missing = computeMissingRequirements(
      scenarioContentRequirements(scenario()),
      installed(["Some Other Game"], ["Comet Catcher"]),
    );

    expect(missing.map((r) => r.label)).toEqual(["BAR"]);
  });

  it("asks for nothing when the scenario names no game or map", () => {
    const draft = scenario({
      setup: { ...scenario().setup, gameName: "", mapName: "" },
    });

    // A requirement for a game called "" could never be satisfied or
    // downloaded, so the gate would hold a draft import open forever.
    expect(scenarioContentRequirements(draft)).toEqual([]);
  });
});

describe("scenario container round trip", () => {
  it("returns the same document and media it wrote", () => {
    const read = readScenarioExport(encodeScenarioExport(exported()));

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.payload.scenario).toEqual(scenario());
    expect(read.payload.media).toEqual({ "a.png": PORTRAIT, "a.ogg": VOICE });
  });

  it("identifies an exported file as a scenario this build can read", () => {
    const id = identify(encodeScenarioExport(exported()));

    expect(id.kind).toBe("scenario");
    expect(id.compatibility).toBe("ok");
    expect(id.warnings).toEqual([]);
  });

  it("names the game both ways when the exporting machine has it", () => {
    const text = encodeScenarioExport(exported(), [
      { name: "BAR", info: { shortname: "byar" } },
    ]);

    expect(identify(text).game).toEqual({ name: "BAR", shortname: "byar" });
    expect(readScenarioExport(text).ok).toBe(true);
  });

  it("names the game by archive name alone when it isn't installed here", () => {
    expect(identify(encodeScenarioExport(exported())).game).toEqual({
      name: "BAR",
    });
  });

  it("reads the game out of a scenario shared before the shared field", () => {
    const json = encodeContainerJson("scenario", 1, {
      scenario: scenario(),
      media: {},
    });

    expect(identify(json).game).toEqual({ name: "BAR" });
    expect(readScenarioExport(json).ok).toBe(true);
  });
});

describe("encodeScenarioCode", () => {
  /** A clip of `bytes` real bytes, as random as an already-compressed one. */
  function clip(bytes: number): string {
    const buf = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i += 65536) {
      crypto.getRandomValues(buf.subarray(i, Math.min(i + 65536, bytes)));
    }
    return `data:audio/ogg;base64,${Buffer.from(buf).toString("base64")}`;
  }

  it("produces a code that reads back as the same scenario", () => {
    const result = encodeScenarioCode(exported());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code.startsWith("cbz1.")).toBe(true);
    const read = readScenarioExport(result.code);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.payload.scenario).toEqual(scenario());
    expect(read.payload.media).toEqual({ "a.png": PORTRAIT, "a.ogg": VOICE });
  });

  it("identifies a pasted code as a scenario", () => {
    const result = encodeScenarioCode(exported());
    if (!result.ok) throw new Error("expected a code");

    expect(identify(result.code).kind).toBe("scenario");
  });

  // The two routes must not disagree about what a scenario says its game is
  // (issue #1335), so they build the same payload and this pins that down.
  it("names the game exactly as the file export does", () => {
    const installed = [{ name: "BAR", info: { shortname: "byar" } }];
    const result = encodeScenarioCode(exported(), installed);
    if (!result.ok) throw new Error("expected a code");

    expect(identify(result.code).game).toEqual({
      name: "BAR",
      shortname: "byar",
    });
    expect(identify(result.code).game).toEqual(
      identify(encodeScenarioExport(exported(), installed)).game,
    );
  });

  // The point of the check: a scenario whose clips push it past the ceiling
  // must be refused while the author can still choose the file instead, not
  // handed out as a code that fails to inflate on someone else's machine.
  it("refuses a scenario whose dialogue clips are too big, and says why", () => {
    const result = encodeScenarioCode({
      scenario: scenario(),
      media: { "a.png": PORTRAIT, "a.ogg": clip(400 * 1024) },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("2 dialogue clips");
    expect(result.message).toContain("512 KB");
    expect(result.message).toContain("file");
  });

  it("blames nothing but the size when the scenario carries no clips", () => {
    const result = encodeScenarioCode({
      scenario: scenario({
        description: "x".repeat(600 * 1024),
        dialogue: [],
      }),
      media: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain("dialogue");
  });

  it("still encodes a scenario whose clips sit just under the ceiling", () => {
    const result = encodeScenarioCode({
      scenario: scenario({ dialogue: [] }),
      media: { "a.ogg": clip(300 * 1024) },
    });

    expect(result.ok).toBe(true);
  });
});

describe("readScenarioExport rejections", () => {
  it("reports a campaign file as the wrong kind", () => {
    const json = encodeContainerJson("campaign", 1, {
      type: "ta",
      missions: [],
    });

    expect(readScenarioExport(json)).toEqual({
      ok: false,
      error: "wrong-kind",
    });
  });

  it("reports text that is not a container at all", () => {
    expect(readScenarioExport("not a scenario")).toEqual({
      ok: false,
      error: "unknown-format",
    });
    expect(readScenarioExport(JSON.stringify(scenario()))).toEqual({
      ok: false,
      error: "unknown-format",
    });
  });

  it("reports a scenario container whose document is malformed", () => {
    const json = encodeContainerJson("scenario", 1, {
      scenario: { id: "s1" },
      media: {},
    });

    expect(readScenarioExport(json)).toEqual({ ok: false, error: "malformed" });
  });

  it("reports a payload schema version this build cannot read", () => {
    const json = encodeContainerJson("scenario", 2, exported());

    expect(readScenarioExport(json)).toEqual({
      ok: false,
      error: "unsupported-version",
    });
  });

  it("drops a media entry that is not a data URI, keeping the document", () => {
    const json = encodeContainerJson("scenario", 1, {
      scenario: scenario(),
      media: { "a.png": PORTRAIT, "a.ogg": "/home/someone/voice.ogg" },
    });

    const read = readScenarioExport(json);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.payload.media).toEqual({ "a.png": PORTRAIT });
  });
});

describe("scenarioImportErrorMessage", () => {
  it("tells a wrong-kind file apart from a damaged one", () => {
    expect(scenarioImportErrorMessage("wrong-kind")).toContain(
      "not a scenario",
    );
    expect(scenarioImportErrorMessage("malformed")).toContain("damaged");
    expect(scenarioImportErrorMessage("unsupported-version")).toContain(
      "newer version",
    );
    expect(scenarioImportErrorMessage("unknown-format")).toContain(
      "coilbox scenario",
    );
  });
});

describe("dropMissingDialogueMedia", () => {
  it("keeps references whose clip is present and drops the rest", () => {
    const kept = dropMissingDialogueMedia(scenario(), new Set(["a.png"]));

    expect(kept.dialogue[0].portrait).toBe("a.png");
    expect(kept.dialogue[0].audio).toBeUndefined();
    expect(kept.dialogue[1].portrait).toBe("a.png");
  });

  it("leaves the rest of the document untouched", () => {
    const kept = dropMissingDialogueMedia(scenario(), new Set());

    expect(kept.zones).toEqual(scenario().zones);
    expect(kept.dialogue.map((d) => d.text)).toEqual([
      "Hold the line.",
      "Again.",
    ]);
  });
});
