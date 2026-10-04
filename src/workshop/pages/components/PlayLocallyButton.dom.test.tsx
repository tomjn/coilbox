// @vitest-environment happy-dom
/**
 * The one button that plays a workshop project on your own machine (issue
 * #1278). What matters here is which route each launch takes: the tweak-slot
 * route writes nothing and rescans nothing, and the mutator route writes the
 * test game and rescans for it before naming it in the launch. Everything
 * else (the compiler's own output, the base64 codec) is
 * `localTweakSlot.test.ts`'s.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const project = {
  id: "p1",
  name: "Faster commanders",
  gameName: "Balanced Annihilation V15.9.8",
  edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const GAME = {
  name: project.gameName,
  primaryArchive: { name: "ba.sdd", path: "/data/games/ba.sdd" },
};
const WORKSHOP_TEST_GAME = {
  name: "coilbox-workshop-test",
  primaryArchive: { name: "coilbox-workshop-test.sdd", path: "" },
};
const MAP = {
  name: "Comet Catcher Redux",
  archives: [{ name: "cometcatcherredux.sd7", path: "/maps/ccr.sd7" }],
  info: {},
};

const WRITTEN = {
  units: { armcom: { maxdamage: { typed: 0.5, written: 5.5555553 } } },
};

const {
  primeScan,
  launch,
  workshopTestMutator,
  workshopPreflight,
  settleTypedValues,
  settleTypedValuesTweaks,
  workshopCompile,
  writeStartWithUnit,
} = vi.hoisted(() => ({
  writeStartWithUnit: vi.fn(async (_args: unknown) => ({
    dir: "/data/games/coilbox-workshop-test.sdd",
  })),
  settleTypedValuesTweaks: vi.fn(
    async (_args: unknown): Promise<unknown> => ({
      ok: true,
      settled: {
        written: WRITTEN,
        fields: [
          {
            field: { kind: "unit", unit: "armcom", path: "maxdamage" },
            typed: 0.5,
            loadsAsTyped: 0.045,
            outcome: "written",
            written: 5.5555553,
          },
        ],
        loads: 3,
        elapsedMs: 1349,
      },
    }),
  ),
  workshopCompile: vi.fn(async (_args: unknown) => ({
    chunks: [],
    files: [],
    notes: [],
    tweakdefs: "do x = 5.5555553 end",
  })),
  settleTypedValues: vi.fn(
    async (_args: unknown): Promise<unknown> => ({
      ok: true,
      settled: {
        written: WRITTEN,
        fields: [
          {
            field: { kind: "unit", unit: "armcom", path: "maxdamage" },
            typed: 0.5,
            loadsAsTyped: 0.045,
            outcome: "written",
            written: 5.5555553,
          },
        ],
        loads: 3,
        elapsedMs: 900,
      },
    }),
  ),
  primeScan: vi.fn(async () => ({
    games: [GAME, WORKSHOP_TEST_GAME],
    maps: [MAP],
  })),
  launch: vi.fn(
    async (
      _kind: string,
      _opts: { config: { gameType: string; modOptions: unknown } },
    ) => ({ exitCode: 0 }),
  ),
  workshopPreflight: vi.fn(async () => ({
    blockers: [] as string[],
    review: [] as string[],
    passes: [] as string[],
  })),
  workshopTestMutator: vi.fn(async () => ({
    dir: "/data/games/coilbox-workshop-test.sdd",
    folder: "coilbox-workshop-test.sdd",
    files: ["modinfo.lua"],
  })),
}));

/** Reassigned per test, and read by the mocks below at call time. */
let mockCompiled: {
  compiled: {
    chunks: unknown[];
    files: { path: string; contents: string }[];
    notes: string[];
    tweakdefs: string | null;
  } | null;
  loading: boolean;
  error: string | null;
} = {
  compiled: { chunks: [], files: [], notes: [], tweakdefs: null },
  loading: false,
  error: null,
};
let mockGameInfoOptions: { key: string; name: string }[] = [];

vi.mock("../../compile", async () => ({
  ...(await vi.importActual<typeof import("../../compile")>("../../compile")),
  useCompiledProject: () => mockCompiled,
  workshopCompile,
}));
// Set to a reason to stand in a scan whose Init failed: the hook then returns
// no data and the engine's reason as the error (issue #3423).
let mockScanError: string | null = null;
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({
    data: mockScanError ? null : { games: [GAME], maps: [MAP] },
    loading: false,
    error: mockScanError,
  }),
  useUnitsyncGameInfo: () => ({ info: { options: mockGameInfoOptions } }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
  primeScan,
}));
vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launch }),
}));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engines/105",
      executable: "/engines/105/spring",
      dataDir: "/data",
      engineVersion: "105",
    },
    loading: false,
  }),
  gameOptionSchema: async () => [],
  mapOptionSchema: async () => [],
  initialParticipants: () => [
    { id: 1, kind: "you", name: "You", side: "", allyTeam: 0 },
  ],
  toBattleConfig: (opts: { gameType: string; modOptions: unknown }) => ({
    gameType: opts.gameType,
    modOptions: opts.modOptions,
  }),
}));
vi.mock("../../mutator", () => ({ workshopTestMutator }));
vi.mock("../../loadsAs", async () => {
  const actual =
    await vi.importActual<typeof import("../../loadsAs")>("../../loadsAs");
  return { ...actual, settleTypedValues, settleTypedValuesTweaks };
});
vi.mock("../../preflight", () => ({ workshopPreflight }));
vi.mock("../../testMission", async () => ({
  ...(await vi.importActual<typeof import("../../testMission")>(
    "../../testMission",
  )),
  writeStartWithUnit,
}));

const { PlayLocallyButton } = await import("./PlayLocallyButton");
const { PersistentStoreProvider } = await import("@picoframe/frame");
const { installSettingsStorage, memorySettingsStorage } = await import(
  "@/lib/storedSetting"
);

/** A `CompileState` with only the fields these tests care about. */
function compiled(over: {
  files?: { path: string; contents: string }[];
  tweakdefs?: string | null;
}) {
  return {
    compiled: {
      chunks: [],
      files: over.files ?? [],
      notes: [],
      tweakdefs: over.tweakdefs ?? null,
    },
    loading: false,
    error: null,
  };
}

const ZEUS = { key: "armzeus", label: "Zeus", inGame: true };

function draw(unit?: { key: string; label: string; inGame: boolean }) {
  installSettingsStorage(memorySettingsStorage());
  return render(
    <PersistentStoreProvider>
      {/** biome-ignore lint/suspicious/noExplicitAny: a trimmed test fixture, not the real ModProject */}
      <PlayLocallyButton project={project as any} unit={unit} />
    </PersistentStoreProvider>,
  );
}

afterEach(() => {
  cleanup();
  mockScanError = null;
  primeScan.mockClear();
  launch.mockClear();
  workshopTestMutator.mockClear();
  workshopPreflight.mockClear();
  settleTypedValuesTweaks.mockClear();
  workshopCompile.mockClear();
  writeStartWithUnit.mockClear();
  workshopPreflight.mockResolvedValue({ blockers: [], review: [], passes: [] });
  mockCompiled = compiled({});
  mockGameInfoOptions = [];
});

describe("PlayLocallyButton", () => {
  it("says there is nothing to test when the project has no edits", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    expect(screen.getByText(/this project has no edits yet/i)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /nothing to test yet/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("picks the map from the same thumbnail grid drawer as the Skirmish page, not a dropdown", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));

    // The trigger shows the current map and opens the searchable thumbnail
    // grid rather than a plain dropdown (issue #3164).
    fireEvent.click(screen.getByRole("button", { name: MAP.name }));
    const picker = screen.getByRole("dialog", { name: "Choose a map" });
    expect(within(picker).getByPlaceholderText(/Search 1 maps/)).toBeTruthy();

    // Picking the map's card closes the picker and leaves the Test drawer's
    // own trigger showing the chosen map, still open underneath.
    fireEvent.click(within(picker).getByText(MAP.name));
    expect(screen.queryByRole("dialog", { name: "Choose a map" })).toBeNull();
    expect(screen.getByRole("button", { name: MAP.name })).toBeTruthy();
    expect(screen.getByText("Play locally")).toBeTruthy();
  });

  it("offers only the mutator route when the game declares no tweakdefs slot", () => {
    mockCompiled = compiled({ files: [{ path: "modinfo.lua", contents: "" }] });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    expect(screen.queryByText("Local tweak-slot mod option")).toBeNull();
  });

  it("plays the tweak slot route with the values settled for the bare slot, with no mutator write and no rescan", async () => {
    mockCompiled = compiled({
      files: [{ path: "modinfo.lua", contents: "" }],
      tweakdefs: "do end",
    });
    mockGameInfoOptions = [{ key: "tweakdefs", name: "tweakdefs" }];
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));

    // The tweak-slot route is the default once it is available, so Play
    // launches it without any further selection.
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(workshopTestMutator).not.toHaveBeenCalled();
    expect(primeScan).not.toHaveBeenCalled();
    expect(settleTypedValuesTweaks).toHaveBeenCalledWith({
      enginePath: "/engines/105",
      dataDir: "/data",
      archive: "ba.sdd",
      project,
      route: "bare",
    });
    expect(workshopCompile).toHaveBeenCalledWith({ project, written: WRITTEN });
    const [, opts] = launch.mock.calls[0];
    expect(opts.config.gameType).toBe(project.gameName);
    expect(opts.config.modOptions).toEqual({
      tweakdefs: "ZG8geCA9IDUuNTU1NTU1MyBlbmQ",
    });
    expect(
      screen.getByText(/1 typed value is written so the game's own Lua/),
    ).toBeTruthy();
  });

  it("plays the tweak slot route as typed and says why when the game cannot be checked", async () => {
    mockCompiled = compiled({
      files: [{ path: "modinfo.lua", contents: "" }],
      tweakdefs: "do end",
    });
    mockGameInfoOptions = [{ key: "tweakdefs", name: "tweakdefs" }];
    settleTypedValuesTweaks.mockResolvedValueOnce({
      ok: false,
      message: "Coilbox could not load the game to check typed values",
    });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(workshopCompile).not.toHaveBeenCalled();
    const [, opts] = launch.mock.calls[0];
    expect(opts.config.modOptions).toEqual({ tweakdefs: "ZG8gZW5k" });
    expect(
      screen.getByText(/could not load the game to check typed values/),
    ).toBeTruthy();
  });

  it("plays the mutator route by writing the test game and rescanning for it", async () => {
    mockCompiled = compiled({
      files: [{ path: "modinfo.lua", contents: "return {}" }],
    });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(settleTypedValues).toHaveBeenCalledWith({
      enginePath: "/engines/105",
      dataDir: "/data",
      archive: "ba.sdd",
      project,
    });
    expect(workshopTestMutator).toHaveBeenCalledWith({
      dataDir: "/data",
      project,
      written: WRITTEN,
    });
    expect(primeScan).toHaveBeenCalledWith("/engines/105", "/data", true);
    const [, opts] = launch.mock.calls[0];
    expect(opts.config.gameType).toBe(WORKSHOP_TEST_GAME.name);
    expect(
      screen.getByText(/1 typed value is written so the game's own Lua/),
    ).toBeTruthy();
  });

  it("says the scan failed, and no map is missing, when Init failed", () => {
    mockScanError = "no space left on device";
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    expect(
      screen.getByText(/The content scan failed: no space left on device/),
    ).toBeTruthy();
    expect(screen.queryByText(/No map installed/)).toBeNull();
    expect(screen.queryByText(/is not installed here/)).toBeNull();
  });

  it("says the scan failed when the rescan after writing the test game fails", async () => {
    mockCompiled = compiled({
      files: [{ path: "modinfo.lua", contents: "return {}" }],
    });
    primeScan.mockRejectedValueOnce(new Error("no space left on device"));
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

    expect(
      await screen.findByText(
        /The content scan failed: no space left on device/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/did not pick up/)).toBeNull();
    expect(launch).not.toHaveBeenCalled();
  });

  it("writes the typed values and says why when the game cannot be checked", async () => {
    mockCompiled = compiled({
      files: [{ path: "modinfo.lua", contents: "return {}" }],
    });
    settleTypedValues.mockResolvedValueOnce({
      ok: false,
      message: "Coilbox could not load the game to check typed values",
    });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(workshopTestMutator).toHaveBeenCalledWith({
      dataDir: "/data",
      project,
      written: undefined,
    });
    expect(
      screen.getByText(/could not load the game to check typed values/),
    ).toBeTruthy();
  });

  it("refuses to launch when preflight finds a blocker, before writing anything", async () => {
    mockCompiled = compiled({
      files: [{ path: "modinfo.lua", contents: "return {}" }],
    });
    workshopPreflight.mockResolvedValue({
      blockers: ["supercom is defined by 2 copies"],
      review: [],
      passes: [],
    });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

    await vi.waitFor(() => expect(screen.getByText(/1 blocker/i)).toBeTruthy());
    expect(screen.getByText(/supercom is defined by 2 copies/)).toBeTruthy();
    expect(workshopTestMutator).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  describe("start with the unit on the map (issue #3178)", () => {
    const startOption = () =>
      screen.getByRole("checkbox", { name: /start with zeus on the map/i });
    /** The choice is a saved setting that outlives a test's own render, so a
     *  test sets it rather than clicking and trusting where it started. */
    const chooseStart = (on: boolean) => {
      const box = startOption();
      if ((box.getAttribute("aria-checked") === "true") !== on) {
        fireEvent.click(box);
      }
    };

    it("is offered only when a unit is open", () => {
      mockCompiled = compiled({
        files: [{ path: "modinfo.lua", contents: "return {}" }],
      });
      draw();
      fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
      expect(screen.queryByRole("checkbox")).toBeNull();
    });

    it("leaves the launch as it was while it is off", async () => {
      mockCompiled = compiled({
        files: [{ path: "modinfo.lua", contents: "return {}" }],
      });
      draw(ZEUS);
      fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
      chooseStart(false);
      fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

      await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
      expect(workshopTestMutator).toHaveBeenCalledWith({
        dataDir: "/data",
        project,
        written: WRITTEN,
      });
      expect(writeStartWithUnit).not.toHaveBeenCalled();
      expect(launch.mock.calls[0][1].config.modOptions).toEqual({});
    });

    it("on the mutator route copies the game's unit, adds the mission and names it in the mod options", async () => {
      mockCompiled = compiled({
        files: [{ path: "modinfo.lua", contents: "return {}" }],
      });
      draw(ZEUS);
      fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
      chooseStart(true);
      fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

      await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
      expect(workshopTestMutator).toHaveBeenCalledWith({
        dataDir: "/data",
        project,
        written: WRITTEN,
        baseCopies: ["armzeus"],
      });
      expect(writeStartWithUnit).toHaveBeenCalledTimes(1);
      const [args] = writeStartWithUnit.mock.calls[0] as unknown as [
        {
          scenario: { teams: Record<string, { startUnits: string[] }> };
          modinfo?: string;
        },
      ];
      expect(args.modinfo).toBeUndefined();
      expect(Object.values(args.scenario.teams)[0].startUnits).toEqual([
        "armzeus",
        "armzeus_coilbox_base",
      ]);
      // The mission is written before the rescan that registers the game.
      expect(writeStartWithUnit.mock.invocationCallOrder[0]).toBeLessThan(
        primeScan.mock.invocationCallOrder[0],
      );
      const [, opts] = launch.mock.calls[0];
      expect(opts.config.gameType).toBe(WORKSHOP_TEST_GAME.name);
      expect(opts.config.modOptions).toEqual({
        coilbox_mission: "coilbox-workshop-test",
      });
    });

    it("on the tweak slot route compiles the copy into the slot, writes a game with no compiled files and rescans", async () => {
      mockCompiled = compiled({
        files: [{ path: "modinfo.lua", contents: "" }],
        tweakdefs: "do end",
      });
      mockGameInfoOptions = [{ key: "tweakdefs", name: "tweakdefs" }];
      draw(ZEUS);
      fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
      chooseStart(true);
      fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

      await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
      expect(workshopCompile).toHaveBeenCalledWith({
        project,
        written: WRITTEN,
        baseCopies: ["armzeus"],
      });
      expect(workshopTestMutator).not.toHaveBeenCalled();
      const [args] = writeStartWithUnit.mock.calls[0] as unknown as [
        { modinfo?: string },
      ];
      expect(args.modinfo).toContain(project.gameName);
      expect(primeScan).toHaveBeenCalledWith("/engines/105", "/data", true);
      const [, opts] = launch.mock.calls[0];
      expect(opts.config.gameType).toBe(WORKSHOP_TEST_GAME.name);
      expect(opts.config.modOptions).toEqual({
        tweakdefs: "ZG8geCA9IDUuNTU1NTU1MyBlbmQ",
        coilbox_mission: "coilbox-workshop-test",
      });
    });

    it("places only the unit when the game has no version of it", async () => {
      mockCompiled = compiled({
        files: [{ path: "modinfo.lua", contents: "return {}" }],
      });
      draw({ ...ZEUS, inGame: false });
      fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
      chooseStart(true);
      fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

      await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
      expect(workshopTestMutator).toHaveBeenCalledWith({
        dataDir: "/data",
        project,
        written: WRITTEN,
      });
    });

    it("says the game's version is not on the map when the copy cannot be made, and does not ask for one", async () => {
      mockCompiled = compiled({
        files: [{ path: "modinfo.lua", contents: "return {}" }],
      });
      draw({ key: "arm-zeus", label: "Zeus", inGame: true });
      fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
      expect(
        screen.getByText(/lowercase letters, digits and underscores/i),
      ).toBeTruthy();
      chooseStart(true);
      fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

      await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
      expect(workshopTestMutator).toHaveBeenCalledWith({
        dataDir: "/data",
        project,
        written: WRITTEN,
      });
      const [args] = writeStartWithUnit.mock.calls[0] as unknown as [
        { scenario: { teams: Record<string, { startUnits: string[] }> } },
      ];
      expect(Object.values(args.scenario.teams)[0].startUnits).toEqual([
        "arm-zeus",
      ]);
    });

    it("shows the error and does not launch when the mission cannot be written", async () => {
      mockCompiled = compiled({
        files: [{ path: "modinfo.lua", contents: "return {}" }],
      });
      writeStartWithUnit.mockRejectedValueOnce(
        new Error("could not find the bundled mission runtime"),
      );
      draw(ZEUS);
      fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
      chooseStart(true);
      fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

      await vi.waitFor(() =>
        expect(
          screen.getByText(/could not find the bundled mission runtime/),
        ).toBeTruthy(),
      );
      expect(launch).not.toHaveBeenCalled();
    });
  });
});
