import { describe, expect, it, vi } from "vitest";

// `presets.ts` pulls in the frame package, whose `AppFrame` subpath does not
// resolve under vitest's node resolver.
vi.mock("@picoframe/frame", () => ({ useSetting: vi.fn() }));

import { mergeResult, type ResultRecord } from "../records/bestResult";
import type { SkirmishDraft } from "./drafts";
import type { Participant } from "./participants";
import {
  describeChange,
  launchedPreset,
  presetRecordKey,
  recordSummary,
} from "./presetRecord";
import { presetPayload, type SkirmishPreset } from "./presets";

const you: Participant = {
  id: "p0",
  kind: "you",
  name: "You",
  side: "arm",
  color: [0.5, 0.5, 0.5],
  allyTeam: 0,
  spectator: false,
};
const bot: Participant = {
  id: "p1",
  kind: "ai",
  name: "Bot",
  ai: { shortName: "NullAI", kind: "native" },
  side: "core",
  color: [0.9, 0.1, 0.1],
  allyTeam: 1,
  spectator: false,
};

const setup: SkirmishDraft = {
  participants: [you, bot],
  gameName: "Some Game 1.0",
  mapName: "Some Map",
  startPosType: 0,
  modOptionValues: { maxunits: "500" },
};

const preset = (draft: SkirmishDraft, name = "Hard one"): SkirmishPreset => ({
  ...draft,
  id: "preset-1",
  name,
  createdAt: "",
  lastUsedAt: "",
});

describe("presetRecordKey", () => {
  it("is the same after a rename", () => {
    const a = preset(setup, "Hard one");
    const b = { ...preset(setup, "Renamed"), lastUsedAt: "later" };
    expect(presetRecordKey(a)).toBe(presetRecordKey(b));
    expect(presetRecordKey(a)).not.toBe("");
  });

  it("changes when an option is edited", () => {
    const edited = { ...setup, modOptionValues: { maxunits: "1000" } };
    expect(presetRecordKey(edited)).not.toBe(presetRecordKey(setup));
  });

  it("changes when the map, game or an opponent is edited", () => {
    const key = presetRecordKey(setup);
    expect(presetRecordKey({ ...setup, mapName: "Other" })).not.toBe(key);
    expect(presetRecordKey({ ...setup, gameName: "Other 2.0" })).not.toBe(key);
    expect(
      presetRecordKey({
        ...setup,
        participants: [you, { ...bot, handicap: 10 }],
      }),
    ).not.toBe(key);
  });

  it("changes when a map option is edited", () => {
    expect(
      presetRecordKey({ ...setup, mapOptionValues: { wind: "high" } }),
    ).not.toBe(presetRecordKey(setup));
  });

  it("ignores per-session participant ids and option key order", () => {
    const reshuffled: SkirmishDraft = {
      ...setup,
      participants: [
        { ...you, id: "p7" },
        { ...bot, id: "p8" },
      ],
      modOptionValues: { maxunits: "500" },
    };
    expect(presetRecordKey(reshuffled)).toBe(presetRecordKey(setup));
  });

  it("treats no start boxes and an empty set of them as the same", () => {
    expect(presetRecordKey({ ...setup, startRects: {} })).toBe(
      presetRecordKey(setup),
    );
  });
});

describe("launchedPreset", () => {
  const saved = preset(setup);

  it("counts a setup that matches a saved preset", () => {
    expect(launchedPreset([saved], setup)).toEqual({
      key: presetRecordKey(setup),
      name: "Hard one",
    });
  });

  it("counts a setup changed and then changed back", () => {
    const changed = { ...setup, modOptionValues: { maxunits: "900" } };
    expect(launchedPreset([saved], changed)).toBeNull();
    const back = { ...changed, modOptionValues: { maxunits: "500" } };
    expect(launchedPreset([saved], back)).not.toBeNull();
  });

  it("does not count a setup that was edited", () => {
    const edited = { ...setup, mapName: "Other" };
    expect(launchedPreset([saved], edited)).toBeNull();
  });

  it("does not count anything when there are no presets", () => {
    expect(launchedPreset([], setup)).toBeNull();
  });

  it("follows a renamed preset", () => {
    const renamed = preset(setup, "Renamed");
    expect(launchedPreset([renamed], setup)?.name).toBe("Renamed");
  });
});

describe("a shared preset", () => {
  it("carries no record", () => {
    const record: ResultRecord = {
      attempts: 4,
      wins: 2,
      best: { durationSec: 777, replayFilename: "secret-best.sdfz" },
      seen: ["secret-best.sdfz"],
    };
    const json = JSON.stringify(presetPayload(preset(setup)));
    expect(json).not.toContain(record.best?.replayFilename);
    expect(json).not.toContain("attempts");
    expect(json).not.toContain("best");
  });
});

describe("recordSummary", () => {
  const rec = (over: Partial<ResultRecord>): ResultRecord => ({
    attempts: 0,
    wins: 0,
    best: null,
    seen: [],
    ...over,
  });

  it("gives the best win and the counts", () => {
    expect(
      recordSummary(
        rec({
          attempts: 5,
          wins: 2,
          best: { durationSec: 754, replayFilename: "a" },
        }),
      ),
    ).toBe("Best win 12:34 · 2 wins in 5 attempts");
  });

  it("gives only the attempts when there are only losses", () => {
    expect(recordSummary(rec({ attempts: 3 }))).toBe("3 attempts, no wins");
    expect(recordSummary(rec({ attempts: 1 }))).toBe("1 attempt, no wins");
  });

  it("counts wins without a best when no win had a readable time", () => {
    expect(recordSummary(rec({ attempts: 2, wins: 1 }))).toBe(
      "1 win in 2 attempts",
    );
  });
});

describe("describeChange", () => {
  const name = "Hard one";

  it("says nothing about a game already recorded", () => {
    expect(describeChange({ kind: "duplicate" }, name)).toBeNull();
  });

  it("names the first win", () => {
    expect(describeChange({ kind: "first-win", durationSec: 600 }, name)).toBe(
      'First win on "Hard one", in 10:00.',
    );
  });

  it("says by how much a win beat the best", () => {
    expect(
      describeChange({ kind: "faster", durationSec: 540, bySec: 60 }, name),
    ).toBe('New best on "Hard one": 1:00 faster than before.');
  });

  it("says by how much a win missed the best", () => {
    expect(
      describeChange({ kind: "slower", bestSec: 600, bySec: 100 }, name),
    ).toBe(
      'Not a new best on "Hard one". This win was 1:40 slower than 10:00.',
    );
  });

  it("covers a tie, a loss and a game with no winner", () => {
    expect(describeChange({ kind: "equal", bestSec: 600 }, name)).toBe(
      'Matches your best on "Hard one", 10:00.',
    );
    expect(describeChange({ kind: "loss" }, name)).toBe(
      'Attempt recorded on "Hard one".',
    );
    expect(describeChange({ kind: "no-winner" }, name)).toBe(
      'Attempt recorded on "Hard one", with no winner.',
    );
    expect(describeChange({ kind: "win-no-time" }, name)).toBe(
      'Win recorded on "Hard one", but the replay gave no time.',
    );
  });

  it("is what a merge produces for a real second win", () => {
    const first = mergeResult(undefined, {
      replayFilename: "a",
      outcome: "victory",
      durationSec: 600,
    });
    const second = mergeResult(first.record, {
      replayFilename: "b",
      outcome: "victory",
      durationSec: 540,
    });
    expect(describeChange(second.change, name)).toContain("faster");
  });
});
