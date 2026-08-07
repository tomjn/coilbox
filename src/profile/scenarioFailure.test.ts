import { describe, expect, it, vi } from "vitest";

// Same shim as authoring.test.ts: `parseStoredScenario` sits beside the scenario
// bindings, whose published plugin-sdk dist uses extensionless relative imports
// Vitest's node resolver won't load. Nothing here invokes a command.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { newScenario } from "../scenario/create";
import { parseStoredScenario } from "../scenario/storage";
import { encodeScenarioExport } from "../scenario/transfer";
import { describeScenarioFailure } from "./scenarioFailure";

/**
 * Fixtures are built the way a package would build them, then damaged, rather
 * than written out as the shape this file expects. Each one is checked against
 * `parseStoredScenario` first, so a fixture that would actually load cannot
 * quietly pass as a failure.
 */
function exported(name: string): string {
  return encodeScenarioExport({ scenario: newScenario(name), media: {} });
}

/** An export file's envelope, as much of it as a test reaches into. */
interface RawExport {
  kind?: string;
  kindVersion?: number;
  payload?: { scenario?: Record<string, unknown> };
}

/** The same file, edited by hand, the way a broken package would carry it. */
function edited(json: string, change: (o: RawExport) => void): string {
  const o = JSON.parse(json) as RawExport;
  change(o);
  return JSON.stringify(o, null, 2);
}

describe("describeScenarioFailure", () => {
  it("does not fire on a file that loads", () => {
    expect(parseStoredScenario(exported("Ambush"))).not.toBeNull();
  });

  it("names a scenario made by a newer coilbox, and says so", () => {
    const json = edited(exported("Ambush"), (o) => {
      o.kindVersion = 99;
    });
    expect(parseStoredScenario(json)).toBeNull();
    const failure = describeScenarioFailure(json);
    expect(failure.name).toBe("Ambush");
    expect(failure.error).toContain("newer version of coilbox");
  });

  it("says so when the file is a coilbox file of another kind", () => {
    const json = edited(exported("Ambush"), (o) => {
      o.kind = "campaign";
    });
    expect(parseStoredScenario(json)).toBeNull();
    expect(describeScenarioFailure(json).error).toContain("not a scenario");
  });

  it("says so when the document inside is damaged", () => {
    const json = edited(exported("Ambush"), (o) => {
      if (o.payload?.scenario) o.payload.scenario.groups = "not a list";
    });
    expect(parseStoredScenario(json)).toBeNull();
    const failure = describeScenarioFailure(json);
    expect(failure.name).toBe("Ambush");
    expect(failure.error).toContain("damaged");
  });

  it("locates a JSON syntax error", () => {
    // An unquoted key, which is the shape of a hand-edited file gone wrong.
    const json = exported("Ambush").replace('"kind"', "kind");
    expect(parseStoredScenario(json)).toBeNull();
    const failure = describeScenarioFailure(json);
    expect(failure.name).toBe("(unnamed)");
    expect(failure.error).toMatch(/line/i);
  });

  it("calls a file that is not a coilbox file at all what it is", () => {
    const json = '{"hello": "world"}';
    expect(parseStoredScenario(json)).toBeNull();
    const failure = describeScenarioFailure(json);
    expect(failure.name).toBe("(unnamed)");
    expect(failure.error).toContain("does not match the scenario schema");
  });
});
