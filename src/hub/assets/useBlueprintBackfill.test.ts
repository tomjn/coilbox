import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The leaves this module reaches for through React hooks. Nothing here renders,
// so the stubs are never called, the way assetUploads.test.ts stubs the same two.
vi.mock("@picoframe/frame", () => ({ useSetting: () => [false, () => {}] }));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("@/play/config", () => ({ usePreferredTarget: () => ({}) }));
vi.mock("../config", () => ({ useTrustedHubUrl: () => null }));

/** Who is signed in, which is one of the gates. */
const account = { signedIn: true };
vi.mock("../account", () => ({
  hubAccountSnapshot: () => account,
}));

/** What the run was asked to do, without doing any of it. The orchestrator has
 *  its own tests, and this file is about whether it is reached. */
const runs: { units: string[]; affordable: number; game: string }[] = [];
const wrote = { count: 0 };
vi.mock("./blueprintBackfill", async (importOriginal) => {
  const real = await importOriginal<typeof import("./blueprintBackfill")>();
  return {
    ...real,
    backfillBlueprintUnits: async (
      target: { game: string },
      units: { name: string }[],
      affordable: number,
    ) => {
      runs.push({
        game: target.game,
        units: units.map((unit) => unit.name),
        affordable,
      });
      // Honours the budget the way the real one does, so a test can read the
      // limit's effect off the report as well as off the argument.
      const working = units.slice(0, affordable);
      return {
        units: working.length,
        asked: working.length,
        rendered: working.length,
        offered: working.length * 2,
        written: wrote.count,
      };
    },
  };
});

import type { UnitDatasetEntry } from "@/content/bindings";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "@/lib/storedSetting";
import { ASSET_UPLOAD_SETTING_KEY } from "../assetUploads";
import { readLedger, WRITES_PER_GAME_PER_HOUR } from "./budget";
import {
  forgetBlueprintBackfills,
  runBlueprintBackfill,
} from "./useBlueprintBackfill";

const DATASET: UnitDatasetEntry[] = Array.from({ length: 564 }, (_, at) => ({
  name: `unit${at}`,
  objectName: `unit${at}.s3o`,
  footprintX: 2,
  footprintZ: 2,
}));

type Inputs = Parameters<typeof runBlueprintBackfill>[0];

const LAYOUT: NonNullable<Inputs["blueprint"]> = {
  id: "layout-1",
  buildings: [{ def: "unit0" }, { def: "unit1" }, { def: "unit2" }],
  gameName: "Beyond All Reason test-1",
  shortname: "bar",
};

function inputs(over: Partial<Inputs> = {}): Inputs {
  return {
    blueprint: LAYOUT,
    dataset: DATASET,
    archive: "Beyond All Reason test-1",
    hubUrl: "https://hub.example",
    target: { enginePath: "/engines/105", dataDir: "/data" },
    ...over,
  };
}

function installStorage(seed: Record<string, string> = {}) {
  const entries = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  });
  return entries;
}

/** Agree to send pictures, which is what the consent gate reads. */
function agree(agreed: boolean) {
  const storage = memorySettingsStorage();
  storage.set(ASSET_UPLOAD_SETTING_KEY, JSON.stringify(agreed));
  installSettingsStorage(storage);
}

beforeEach(() => {
  runs.length = 0;
  wrote.count = 0;
  account.signedIn = true;
  forgetBlueprintBackfills();
  installStorage();
  agree(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  installSettingsStorage(null);
});

describe("what has to be true before a blueprint is backfilled", () => {
  it("runs on the units the layout names once everything is ready", async () => {
    const report = await runBlueprintBackfill(inputs());
    expect(report?.units).toBe(3);
    expect(runs).toEqual([
      {
        game: "bar",
        units: ["unit0", "unit1", "unit2"],
        affordable: WRITES_PER_GAME_PER_HOUR / 2,
      },
    ]);
  });

  it("does nothing until the user has agreed to send pictures", async () => {
    agree(false);
    expect(await runBlueprintBackfill(inputs())).toBeNull();
    expect(runs).toEqual([]);
  });

  it("does nothing when nobody is signed in", async () => {
    account.signedIn = false;
    expect(await runBlueprintBackfill(inputs())).toBeNull();
    expect(runs).toEqual([]);
  });

  it("does nothing without a hub this session trusts", async () => {
    expect(await runBlueprintBackfill(inputs({ hubUrl: null }))).toBeNull();
    expect(runs).toEqual([]);
  });

  it("does nothing before the game's archive is known", async () => {
    expect(
      await runBlueprintBackfill(inputs({ archive: undefined })),
    ).toBeNull();
    expect(runs).toEqual([]);
  });

  /** A game with no modinfo shortname cannot key a unit picture, and keying one
   *  on the archive name would mint an identity that dies at the next version. */
  it("does nothing for a game with no shortname to key on", async () => {
    const { shortname: _dropped, ...unkeyable } = LAYOUT;
    expect(
      await runBlueprintBackfill(inputs({ blueprint: unkeyable })),
    ).toBeNull();
    expect(runs).toEqual([]);
  });

  /**
   * The plugin's own consent check reads the settings file, and this webview
   * writes it a beat after the switch moves. Somebody who agreed and came
   * straight to a layout would be refused for an answer they had already given
   * (issue #1674), so a run waits for that write.
   */
  it("waits for a fresh answer to reach the file before it asks", async () => {
    const entries = new Map<string, string>([
      [ASSET_UPLOAD_SETTING_KEY, JSON.stringify(true)],
    ]);
    let land = () => {};
    const write = new Promise<void>((done) => {
      land = done;
    });
    installSettingsStorage({
      get: (key) => entries.get(key) ?? null,
      set: (key, value) => {
        entries.set(key, value);
      },
      flush: () => write,
    });

    const run = runBlueprintBackfill(inputs());
    await new Promise((done) => setTimeout(done, 0));
    expect(runs).toEqual([]);

    land();
    expect((await run)?.units).toBe(3);
    expect(runs).toHaveLength(1);
  });

  it("does nothing for a layout of units this game has not got", async () => {
    expect(
      await runBlueprintBackfill(
        inputs({
          blueprint: { ...LAYOUT, buildings: [{ def: "somebody-elses-unit" }] },
        }),
      ),
    ).toBeNull();
    expect(runs).toEqual([]);
  });
});

describe("firing once", () => {
  it("does not run again for the same layout in one session", async () => {
    await runBlueprintBackfill(inputs());
    expect(await runBlueprintBackfill(inputs())).toBeNull();
    expect(runs).toHaveLength(1);
  });

  /** Two renders of the page a moment apart must not be two runs, so the layout
   *  is claimed before the work rather than after it. */
  it("claims the layout before the run, not after", async () => {
    const both = await Promise.all([
      runBlueprintBackfill(inputs()),
      runBlueprintBackfill(inputs()),
    ]);
    expect(runs).toHaveLength(1);
    expect(both.filter(Boolean)).toHaveLength(1);
  });

  it("still runs for a different layout of the same game", async () => {
    await runBlueprintBackfill(inputs());
    await runBlueprintBackfill(
      inputs({ blueprint: { ...LAYOUT, id: "layout-2" } }),
    );
    expect(runs).toHaveLength(2);
  });
});

describe("charging the rate limit", () => {
  it("records what the hub took, and reads it back next time", async () => {
    wrote.count = 6;
    await runBlueprintBackfill(inputs());
    expect(readLedger().bar).toHaveLength(6);

    forgetBlueprintBackfills();
    await runBlueprintBackfill(inputs());
    expect(runs[1].affordable).toBe(
      Math.floor((WRITES_PER_GAME_PER_HOUR - 6) / 2),
    );
  });

  it("charges nothing for a run the hub took nothing from", async () => {
    wrote.count = 0;
    await runBlueprintBackfill(inputs());
    expect(readLedger()).toEqual({});
  });

  /**
   * The limit is only a limit if it survives being relaunched. The stored file
   * is carried over, the modules are loaded fresh, and the next launch is still
   * refused.
   */
  it("holds across a restart", async () => {
    wrote.count = WRITES_PER_GAME_PER_HOUR;
    const stored = installStorage();
    await runBlueprintBackfill(inputs());

    vi.resetModules();
    installStorage(Object.fromEntries(stored));
    // The fresh modules have their own settings storage, so the agreement has
    // to be installed into that one and not into the one this test started with.
    const freshSettings = await import("@/lib/storedSetting");
    const settings = freshSettings.memorySettingsStorage();
    settings.set(ASSET_UPLOAD_SETTING_KEY, JSON.stringify(true));
    freshSettings.installSettingsStorage(settings);
    const relaunched = await import("./useBlueprintBackfill");
    const report = await relaunched.runBlueprintBackfill(inputs());

    expect(report?.units).toBe(0);
    expect(runs[runs.length - 1].affordable).toBe(0);
  });
});
