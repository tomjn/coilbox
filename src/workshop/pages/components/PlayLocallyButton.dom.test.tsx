// @vitest-environment happy-dom
/**
 * The one button that plays a workshop project on your own machine (issue
 * #1278). What matters here is which route each launch takes: the BAR route
 * writes nothing and rescans nothing, and the mutator route writes the test
 * game and rescans for it before naming it in the launch. Everything else
 * (the compiler's own output, the base64 codec) is `localBar.test.ts`'s.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const MAP = { name: "Comet Catcher Redux" };

const { primeScan, launch, workshopTestMutator } = vi.hoisted(() => ({
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
    barTweakdefs: string | null;
  } | null;
  loading: boolean;
  error: string | null;
} = {
  compiled: { chunks: [], files: [], notes: [], barTweakdefs: null },
  loading: false,
  error: null,
};
let mockGameInfoOptions: { key: string; name: string }[] = [];

vi.mock("../../compile", () => ({ useCompiledProject: () => mockCompiled }));
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({
    data: { games: [GAME], maps: [MAP] },
    loading: false,
    error: null,
  }),
  useUnitsyncGameInfo: () => ({ info: { options: mockGameInfoOptions } }),
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
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const { PlayLocallyButton } = await import("./PlayLocallyButton");
const { PersistentStoreProvider } = await import("@picoframe/frame");
const { installSettingsStorage, memorySettingsStorage } = await import(
  "@/lib/storedSetting"
);

/** A `CompileState` with only the fields these tests care about. */
function compiled(over: {
  files?: { path: string; contents: string }[];
  barTweakdefs?: string | null;
}) {
  return {
    compiled: {
      chunks: [],
      files: over.files ?? [],
      notes: [],
      barTweakdefs: over.barTweakdefs ?? null,
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
  mockCompiled = compiled({});
  mockGameInfoOptions = [];
});

describe("PlayLocallyButton", () => {
  it("says there is nothing to test when the project has no edits", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /play locally/i }));
    expect(screen.getByText(/this project has no edits yet/i)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /nothing to test yet/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("offers only the mutator route when the game declares no tweakdefs slot", () => {
    mockCompiled = compiled({ files: [{ path: "modinfo.lua", contents: "" }] });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /play locally/i }));
    expect(screen.queryByText("Beyond All Reason mod options")).toBeNull();
  });

  it("plays the BAR route with no mutator write and no rescan", async () => {
    mockCompiled = compiled({
      files: [{ path: "modinfo.lua", contents: "" }],
      barTweakdefs: "do end",
    });
    mockGameInfoOptions = [{ key: "tweakdefs", name: "tweakdefs" }];
    draw();
    fireEvent.click(screen.getByRole("button", { name: /play locally/i }));

    // The BAR route is the default once it is available, so Play launches
    // it without any further selection.
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(workshopTestMutator).not.toHaveBeenCalled();
    expect(primeScan).not.toHaveBeenCalled();
    const [, opts] = launch.mock.calls[0];
    expect(opts.config.gameType).toBe(project.gameName);
    expect(opts.config.modOptions).toEqual({ tweakdefs: "ZG8gZW5k" });
  });

  it("plays the mutator route by writing the test game and rescanning for it", async () => {
    mockCompiled = compiled({
      files: [{ path: "modinfo.lua", contents: "return {}" }],
    });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /play locally/i }));
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(workshopTestMutator).toHaveBeenCalledWith({
      dataDir: "/data",
      project,
    });
    expect(primeScan).toHaveBeenCalledWith("/engines/105", "/data", true);
    const [, opts] = launch.mock.calls[0];
    expect(opts.config.gameType).toBe(WORKSHOP_TEST_GAME.name);
  });
});
