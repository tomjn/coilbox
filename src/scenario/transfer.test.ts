import { describe, expect, it } from "vitest";
import { encodeContainerJson, identify } from "../container/container";
import { parseScenario, type Scenario } from "./model";
import {
  dropMissingDialogueMedia,
  encodeScenarioExport,
  readScenarioExport,
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
