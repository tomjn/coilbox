// @vitest-environment happy-dom

/**
 * Importing a warpath challenge when the content scan failed (issue #3423). The
 * scan has no games then because the engine could not start, so the import must
 * not tell the player the challenge's game "isn't installed". The shared form is
 * stood in for, to reach the `finish` this wrapper hands it.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { scan, shared } = vi.hoisted(() => ({
  scan: { error: null as string | null },
  shared: {
    finish: null as null | ((s: unknown, t: unknown) => Promise<unknown>),
  },
}));

vi.mock("../../../challenge/ImportChallengeForm", () => ({
  ImportChallengeForm: (props: { finish: typeof shared.finish }) => {
    shared.finish = props.finish;
    return null;
  },
}));

vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: scan.error ? null : { games: [], maps: [] },
    error: scan.error,
    loading: false,
  }),
}));

vi.mock("../../../content/mapEligibility", () => ({
  useMapEligibility: () => ({ eligible: (maps: unknown[]) => maps }),
}));

vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
  }),
}));

vi.mock("../../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../runs", () => ({ useRuns: () => ({ saveRun: vi.fn() }) }));

import { ImportChallengeForm } from "./ImportChallengeForm";

afterEach(() => {
  cleanup();
  scan.error = null;
  shared.finish = null;
});

const SETTINGS = { game: { shortname: "BAR" } };
const TARGET = { enginePath: "/engine", dataDir: "/data" };

async function finishMessage(): Promise<string> {
  render(<ImportChallengeForm onImported={() => {}} />);
  try {
    await shared.finish?.(SETTINGS, TARGET);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "";
}

describe("ImportChallengeForm finish", () => {
  it("says the content scan failed, with the reason, when it did", async () => {
    scan.error = "no space left on device";

    const message = await finishMessage();

    expect(message).toMatch(/content scan failed/);
    expect(message).toMatch(/no space left on device/);
    expect(message).not.toMatch(/isn't installed/);
  });

  it("still says the game is not installed when the scan answered without it", async () => {
    expect(await finishMessage()).toMatch(/"BAR", which isn't installed/);
  });
});
