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
} = vi.hoisted(() => ({
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

vi.mock("../../compile", () => ({
  useCompiledProject: () => mockCompiled,
  workshopCompile,
}));
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({
    data: { games: [GAME], maps: [MAP] },
    loading: false,
    error: null,
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

function draw() {
  installSettingsStorage(memorySettingsStorage());
  return render(
    <PersistentStoreProvider>
      {/** biome-ignore lint/suspicious/noExplicitAny: a trimmed test fixture, not the real ModProject */}
      <PlayLocallyButton project={project as any} />
    </PersistentStoreProvider>,
  );
}

afterEach(() => {
  cleanup();
  primeScan.mockClear();
  launch.mockClear();
  workshopTestMutator.mockClear();
  workshopPreflight.mockClear();
  settleTypedValuesTweaks.mockClear();
  workshopCompile.mockClear();
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
});
