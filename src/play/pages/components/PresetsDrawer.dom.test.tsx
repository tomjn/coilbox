// @vitest-environment happy-dom

/**
 * The presets sheet, now that clicking a preset opens its own panel instead of
 * loading it outright. Two things worth holding down: the row no longer carries
 * the whole-preset actions, and a part blocked for belonging to another game
 * must not ride along in what loads just because it was ticked before.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FollowedPack } from "../../followedPacks";
import type { Participant } from "../../participants";
import type { PresetSelection } from "../../presetParts";
import type { SkirmishPreset } from "../../presets";
import { PresetsDrawer } from "./PresetsDrawer";

// What unitsync would say, by name. The real minimap hook reads a persistent
// value that needs the app frame, and a bare render has none. A name not listed
// is an unread game or map, which is the state that must warn about nothing.
const unitsync = vi.hoisted(() => ({
  games: {} as Record<
    string,
    { key: string; name: string; type?: string; default?: string }[]
  >,
  mapOptions: {} as Record<
    string,
    { key: string; name: string; type?: string; default?: string }[]
  >,
  positions: {} as Record<string, number>,
}));

vi.mock("@/content/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/content/config")>()),
  useUnitsyncGameInfo: (_e?: string, _d?: string, archive?: string) => ({
    info: archive ? { options: unitsync.games[archive] ?? [] } : null,
    status: "ready",
    loading: false,
  }),
  useUnitsyncMapInfo: (_e?: string, _d?: string, map?: string) => ({
    status: "ready",
    info: map ? { options: unitsync.mapOptions[map] ?? [] } : null,
  }),
  useUnitsyncMinimap: (_e?: string, _d?: string, map?: string) => ({
    loading: false,
    startPositions: Array.from({ length: unitsync.positions[map ?? ""] ?? 0 }),
  }),
}));

// The tweaks panel reads the project library, which lives in the frame's
// settings store and has no provider in a bare render.
vi.mock("@/workshop/project", () => ({
  useModProjects: () => ({ projects: [] }),
}));

// The decode command runs Lua in Rust, which a bare render has no way to reach.
const decode = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/workshop/decodeTweakSet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/workshop/decodeTweakSet")>()),
  workshopDecodeTweakSet: decode.run,
}));

// Which `optionsPresets.json` files the search finds. The face itself has a
// test of its own.
const chobbyFiles = vi.fn<() => string[]>(() => []);
vi.mock("../../useChobbyPresetFiles", () => ({
  useChobbyPresetFiles: () => chobbyFiles(),
}));
vi.mock("../../ChobbyPresetsView", () => ({
  ChobbyPresetsView: () => <div>chobby face</div>,
}));

// The followed packs store reads the frame's settings, which a bare render has
// not got. Its own tests cover the store, so this holds what a store would hand
// back and sees what the sheet asks it to do.
const packs = vi.hoisted(() => ({
  list: [] as FollowedPack[],
  markSeen: vi.fn(),
}));
vi.mock("../../followedPacks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../followedPacks")>()),
  useFollowedPacks: () => ({
    packs: packs.list,
    follow: vi.fn(),
    refreshAll: vi.fn(),
    unfollow: vi.fn(),
    markSeen: packs.markSeen,
  }),
}));

afterEach(() => {
  cleanup();
  packs.list = [];
  packs.markSeen.mockReset();
  chobbyFiles.mockReset();
  chobbyFiles.mockReturnValue([]);
  unitsync.games = {};
  unitsync.mapOptions = {};
  unitsync.positions = {};
  decode.run.mockReset();
});

const you: Participant = {
  id: "p0",
  kind: "you",
  name: "You",
  side: "arm",
  color: [0.5, 0.5, 0.5],
  allyTeam: 0,
  spectator: false,
};

const preset: SkirmishPreset = {
  id: "preset-1",
  name: "8v8 ruleset",
  createdAt: "",
  lastUsedAt: "",
  participants: [you],
  gameName: "Preset Game",
  mapName: "Preset Map",
  startPosType: 2,
  startRects: { "0": { left: 0, top: 0, right: 100, bottom: 200 } },
  modOptionValues: { maxunits: "8000", tweakdefs: "PRESET" },
  restrictions: { disabledUnits: ["armcom"] },
};

function renderDrawer(over: Partial<Parameters<typeof PresetsDrawer>[0]> = {}) {
  const handlers = {
    onLoad: vi.fn(),
    onDelete: vi.fn(),
    onSaveCopy: vi.fn(),
    onExportPreset: vi.fn(),
    onCopyPresetLink: vi.fn(),
    onHostAsBattle: vi.fn(),
  };
  render(
    <PresetsDrawer
      open={true}
      onOpenChange={vi.fn()}
      presets={[preset]}
      thumbs={new Map()}
      currentGameName="Preset Game"
      currentMapName="Current Map"
      currentStartPosType={0}
      gameArchiveFor={(name) => `${name}.sdz`}
      modOptionsSchema={[]}
      onApplyTweaks={vi.fn()}
      // Singleplayer always has the archive route, so "no slots" is never the
      // reason there: no projects for the game is.
      onApplyMutator={vi.fn()}
      onSave={vi.fn()}
      onImport={vi.fn()}
      onSaveFromReplay={vi.fn()}
      onBrowseHub={vi.fn()}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

const openPanel = () => fireEvent.click(screen.getByText("8v8 ruleset"));

// Exact, because "Map" and "Map options" are both rows.
const checkbox = (label: string) =>
  screen.getByRole("checkbox", { name: label });

describe("a followed preset", () => {
  const followed: SkirmishPreset = {
    ...preset,
    id: "pack-1/Community 8v8",
    name: "Community 8v8",
  };
  const pack = (seenKey: string | null, updated: boolean): FollowedPack => ({
    id: "pack-1",
    url: "https://raw.githubusercontent.com/o/r/main/pack.json",
    title: "Community pack",
    lastUpdatedAt: "2026-10-31T10:00:00.000Z",
    lastError: null,
    presets: [{ preset: followed, contentKey: "v2", seenKey, updated }],
  });
  const openFollowedPanel = () =>
    fireEvent.click(screen.getByText("Community 8v8"));

  it("is listed with its pack's name and the player's own stay above it", () => {
    packs.list = [pack("v2", false)];
    renderDrawer();
    expect(screen.getByText("Community pack")).toBeTruthy();
    expect(screen.getByText("8v8 ruleset")).toBeTruthy();
    expect(screen.queryByText("Updated")).toBeNull();
  });

  it("is marked as updated when a refresh changed it", () => {
    packs.list = [pack("v1", true)];
    renderDrawer();
    expect(screen.getByText("Updated")).toBeTruthy();
  });

  it("records the version opened, and only when it is opened", () => {
    packs.list = [pack("v1", true)];
    renderDrawer();
    expect(packs.markSeen).not.toHaveBeenCalled();
    openFollowedPanel();
    expect(packs.markSeen).toHaveBeenCalledWith(
      "pack-1",
      "pack-1/Community 8v8",
      "v2",
    );
  });

  it("brings its tweak slots to a load once it has been opened", () => {
    packs.list = [pack("v1", true)];
    const { onLoad } = renderDrawer();
    openFollowedPanel();
    fireEvent.click(screen.getByRole("button", { name: /^Load/ }));
    expect(onLoad.mock.calls[0][0].modOptionValues.tweakdefs).toBe("PRESET");
  });

  it("can be copied but not deleted", () => {
    packs.list = [pack("v2", false)];
    const { onSaveCopy, onDelete } = renderDrawer();
    openFollowedPanel();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    expect(onSaveCopy.mock.calls[0][0].id).toBe(followed.id);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("leaves the player's own preset deletable and not copied", () => {
    packs.list = [pack("v2", false)];
    renderDrawer();
    openPanel();
    expect(screen.getByRole("button", { name: /^Delete/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save a copy" })).toBeNull();
  });

  it("is on the list with no own presets, without saying there are none", () => {
    packs.list = [pack("v2", false)];
    renderDrawer({ presets: [] });
    expect(screen.getByText("Community 8v8")).toBeTruthy();
    expect(screen.queryByText(/^No presets yet/)).toBeNull();
  });

  it("opens the followed packs face from its row", () => {
    renderDrawer();
    fireEvent.click(screen.getByText("Followed packs"));
    expect(screen.getByRole("textbox", { name: "Pack address" })).toBeTruthy();
  });
});

describe("the preset list", () => {
  it("carries no per-preset actions at all, just the row", () => {
    renderDrawer();
    for (const gone of [
      /^Host /,
      /^Export/,
      /^Copy a link/,
      /^Copy link/,
      /^Delete/,
    ])
      expect(screen.queryByRole("button", { name: gone })).toBeNull();
  });

  it("opens the preset's panel rather than loading it", () => {
    const { onLoad } = renderDrawer();
    openPanel();
    expect(onLoad).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Back to presets" }),
    ).toBeTruthy();
  });

  it("goes back to the list", () => {
    renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Back to presets" }));
    expect(screen.getByText("8v8 ruleset")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Map" })).toBeNull();
  });

  it("offers creating a preset from a replay", () => {
    renderDrawer();
    expect(
      screen.getByRole("button", { name: "Create from replay" }),
    ).toBeTruthy();
  });

  it("will not open unit tweaks when there is nothing behind it", () => {
    // The mocked library holds no projects for this game, so the row says so
    // rather than opening onto an empty list.
    renderDrawer();
    expect(screen.getByText("No projects for Preset Game yet")).toBeTruthy();
    fireEvent.click(screen.getByText("Unit tweaks"));
    expect(
      screen.queryByRole("button", { name: "Back to presets" }),
    ).toBeNull();
  });

  it("shows none of the Chobby controls when no data folder has its file", () => {
    renderDrawer();
    expect(screen.queryByText("Chobby presets")).toBeNull();
  });

  it("opens Chobby's presets from a row when a data folder has the file, and comes back", () => {
    chobbyFiles.mockReturnValue(["/data/optionsPresets.json"]);
    renderDrawer();
    fireEvent.click(screen.getByText("Chobby presets"));
    expect(screen.getByText("chobby face")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to presets" }));
    expect(screen.getByText("Chobby presets")).toBeTruthy();
    expect(screen.queryByText("chobby face")).toBeNull();
  });

  it("will not open Chobby's presets while a game is running", () => {
    chobbyFiles.mockReturnValue(["/data/optionsPresets.json"]);
    renderDrawer({ disabled: true });
    expect(
      (
        screen
          .getByText("Chobby presets")
          .closest("button") as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("sends you to the hub for presets you have not made yourself", () => {
    const onBrowseHub = vi.fn();
    renderDrawer({ onBrowseHub });
    fireEvent.click(screen.getByRole("button", { name: "Browse the hub" }));
    expect(onBrowseHub).toHaveBeenCalled();
  });
});

describe("a preset's panel", () => {
  it("names the full load rather than leaving it implied", () => {
    renderDrawer();
    openPanel();
    expect(
      screen.getByRole("button", { name: "Load all 7 parts" }),
    ).toBeTruthy();
  });

  it("loads every part", () => {
    const { onLoad } = renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Load all 7 parts" }));
    expect((onLoad.mock.calls[0][1] as PresetSelection).parts).toHaveLength(7);
  });

  it("loads only what is ticked", () => {
    const { onLoad } = renderDrawer();
    openPanel();
    fireEvent.click(checkbox("Teams and bots"));
    fireEvent.click(checkbox("Mod options"));
    fireEvent.click(screen.getByRole("button", { name: "Load 5 parts" }));
    const parts = (onLoad.mock.calls[0][1] as PresetSelection).parts;
    expect(parts).not.toContain("teams");
    expect(parts).not.toContain("modOptions");
  });

  it("offers select all only once something is unticked", () => {
    renderDrawer();
    openPanel();
    expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
    fireEvent.click(checkbox("Map"));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(
      screen.getByRole("button", { name: "Load all 7 parts" }),
    ).toBeTruthy();
  });

  it("blocks the game-keyed parts when the game is left behind", () => {
    const { onLoad } = renderDrawer({ currentGameName: "A Different Game" });
    openPanel();
    fireEvent.click(checkbox("Game"));
    expect(
      screen.getAllByText(
        "Belongs to Preset Game. Take the game as well, or leave this out.",
      ).length,
    ).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Load 3 parts" }));
    expect((onLoad.mock.calls[0][1] as PresetSelection).parts).toEqual([
      "map",
      "startPositions",
      "teams",
    ]);
  });

  it("cautions that the boxes were drawn for another map", () => {
    renderDrawer();
    openPanel();
    fireEvent.click(checkbox("Map"));
    expect(
      screen.getByText(
        "These boxes were drawn for Preset Map, not the map you are on.",
      ),
    ).toBeTruthy();
  });

  it("carries the whole-preset actions moved off the row", () => {
    const { onExportPreset, onCopyPresetLink, onHostAsBattle } = renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Host as battle" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onHostAsBattle).toHaveBeenCalledWith(preset);
    expect(onExportPreset).toHaveBeenCalledWith(preset);
    expect(onCopyPresetLink).toHaveBeenCalledWith(preset);
  });

  it("hides hosting where it is impossible", () => {
    renderDrawer({ onHostAsBattle: undefined });
    openPanel();
    expect(screen.queryByRole("button", { name: "Host as battle" })).toBeNull();
  });

  it("deletes the preset and returns to the list", () => {
    const { onDelete } = renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Delete preset" }));
    expect(onDelete).toHaveBeenCalledWith("preset-1");
    // The panel was about a preset that no longer exists, so it cannot stay.
    expect(
      screen.queryByRole("button", { name: "Back to presets" }),
    ).toBeNull();
  });
});

describe("a preset's panel, warning about what does not fit", () => {
  const bot = (id: string, allyTeam: number): Participant => ({
    ...you,
    id,
    kind: "ai",
    name: id,
    allyTeam,
  });

  it("names a mod option the game does not declare", () => {
    unitsync.games["Preset Game.sdz"] = [
      { key: "maxunits", name: "Max units" },
    ];
    renderDrawer({
      archive: "Preset Game.sdz",
      presets: [{ ...preset, modOptionValues: { maxunits: "1", bogus: "2" } }],
    });
    openPanel();
    expect(
      screen.getByText("Preset Game does not declare bogus."),
    ).toBeTruthy();
  });

  it("reads the options of the preset's own game when the game is taken", () => {
    unitsync.games["Other Game.sdz"] = [{ key: "bogus", name: "Bogus" }];
    unitsync.games["Current Game.sdz"] = [
      { key: "maxunits", name: "Max units" },
    ];
    renderDrawer({
      currentGameName: "Current Game",
      archive: "Current Game.sdz",
      presets: [
        {
          ...preset,
          gameName: "Other Game",
          modOptionValues: { bogus: "2", maxunits: "1" },
        },
      ],
    });
    openPanel();
    expect(
      screen.getByText("Other Game does not declare maxunits."),
    ).toBeTruthy();
  });

  it("warns when the roster has more teams than the map has start positions", () => {
    unitsync.positions["Preset Map"] = 2;
    renderDrawer({
      presets: [
        {
          ...preset,
          startPosType: 0,
          participants: [you, bot("b", 1), bot("c", 2)],
        },
      ],
    });
    openPanel();
    expect(
      screen.getByText("3 teams, but Preset Map has 2 start positions."),
    ).toBeTruthy();
  });

  it("shows no warning for a preset that fits", () => {
    unitsync.positions["Preset Map"] = 2;
    unitsync.mapOptions["Preset Map"] = [{ key: "fog", name: "Fog" }];
    unitsync.games["Preset Game.sdz"] = [
      { key: "maxunits", name: "Max units" },
    ];
    renderDrawer({
      archive: "Preset Game.sdz",
      presets: [
        {
          ...preset,
          startPosType: 0,
          participants: [you, bot("b", 1)],
          modOptionValues: { maxunits: "1" },
          mapOptionValues: { fog: "1" },
        },
      ],
    });
    openPanel();
    expect(screen.queryByText(/does not declare|start positions\./)).toBeNull();
  });
});

describe("what a preset changes", () => {
  const GAME = "Preset Game.sdz";
  const schema = [
    { key: "maxunits", name: "Max units", type: "number", default: "1000" },
    { key: "fog", name: "Fog", type: "bool", default: "true" },
    { key: "speed", name: "Speed", type: "number", default: "1" },
  ];

  /** Open the list under one part's row. */
  const showChanges = (part: string) => {
    const row = screen.getByText(part).closest("li");
    if (!row) throw new Error(`no row for ${part}`);
    fireEvent.click(
      within(row).getByRole("button", { name: "What it changes" }),
    );
  };

  const withOptions = (modOptionValues: Record<string, string>) => ({
    presets: [{ ...preset, modOptionValues }],
    archive: GAME,
  });

  it("shows one row for one option off its default, however many it stores", () => {
    unitsync.games[GAME] = schema;
    renderDrawer(withOptions({ maxunits: "8000", fog: "true", speed: "1" }));
    openPanel();
    showChanges("Mod options");
    expect(screen.getByText("Max units")).toBeTruthy();
    expect(screen.getByText("Preset 8000, default 1000")).toBeTruthy();
    expect(screen.queryByText("Fog")).toBeNull();
    expect(screen.queryByText("Speed")).toBeNull();
  });

  it("says a preset equal to the defaults changes nothing", () => {
    unitsync.games[GAME] = schema;
    renderDrawer(withOptions({ maxunits: "1000", speed: "1" }));
    openPanel();
    showChanges("Mod options");
    expect(screen.getByText("Changes nothing from the defaults.")).toBeTruthy();
  });

  it("reads 1 as true for a bool whose default is true", () => {
    unitsync.games[GAME] = schema;
    renderDrawer(withOptions({ fog: "1" }));
    openPanel();
    showChanges("Mod options");
    expect(screen.getByText("Changes nothing from the defaults.")).toBeTruthy();
  });

  it("says which changes the setup already has, and the value it has instead", () => {
    unitsync.games[GAME] = schema;
    renderDrawer({
      ...withOptions({ maxunits: "8000", speed: "3" }),
      currentOptions: {
        modOptionValues: { maxunits: "8000.0", speed: "2" },
        mapOptionValues: {},
      },
    });
    openPanel();
    showChanges("Mod options");
    expect(screen.getByText("Already set this way")).toBeTruthy();
    expect(screen.getByText("Now 2")).toBeTruthy();
  });

  it("lists options the game does not declare apart from the changes", () => {
    unitsync.games[GAME] = schema;
    renderDrawer(withOptions({ maxunits: "8000", bogus: "7" }));
    openPanel();
    showChanges("Mod options");
    expect(
      screen.getByText("Preset Game does not declare this option:"),
    ).toBeTruthy();
    expect(screen.getByText("bogus")).toBeTruthy();
  });

  it("says so when the game's options are not available, rather than listing every value", () => {
    renderDrawer({
      presets: [{ ...preset, modOptionValues: { maxunits: "1" } }],
    });
    openPanel();
    showChanges("Mod options");
    expect(
      screen.getByText(/The options for Preset Game are not available/),
    ).toBeTruthy();
    expect(screen.queryByText(/^Preset 1,/)).toBeNull();
  });

  it("compares map options with the preset's map", () => {
    unitsync.mapOptions["Preset Map"] = [
      { key: "wind", name: "Wind", type: "number", default: "5" },
    ];
    renderDrawer({
      presets: [{ ...preset, mapOptionValues: { wind: "9" } }],
    });
    openPanel();
    showChanges("Map options");
    expect(screen.getByText("Wind")).toBeTruthy();
    expect(screen.getByText("Preset 9, default 5")).toBeTruthy();
  });

  it("lists a tweak slot's units and fields from the decode", async () => {
    decode.run.mockResolvedValue({
      tweakdefs: [],
      tweakunits: [
        {
          key: "tweakunits",
          kind: "tweakunits",
          slot: 0,
          lua: "",
          manifest: null,
          form: "table",
          table: { armcom: { health: 5000 } },
          error: null,
        },
      ],
      unrecognised: [],
    });
    renderDrawer(withOptions({ tweakunits: "PAYLOAD" }));
    openPanel();
    showChanges("Unit tweaks");
    expect(await screen.findByText("health = 5000")).toBeTruthy();
    expect(screen.getByText("armcom")).toBeTruthy();
    expect(decode.run).toHaveBeenCalledWith({
      entries: { tweakunits: "PAYLOAD" },
    });
  });

  it("says a slot cannot be read and offers its raw text", async () => {
    decode.run.mockResolvedValue({
      tweakdefs: [
        {
          key: "tweakdefs",
          kind: "tweakdefs",
          slot: 0,
          lua: "for k in pairs(UnitDefs) do end",
          manifest: null,
          form: "block",
          table: null,
          error: null,
        },
      ],
      tweakunits: [],
      unrecognised: [],
    });
    renderDrawer(withOptions({ tweakdefs: "PAYLOAD" }));
    openPanel();
    showChanges("Unit tweaks");
    expect(await screen.findByText(/Cannot be listed as changes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Raw text" }));
    expect(screen.getByText("for k in pairs(UnitDefs) do end")).toBeTruthy();
  });

  it("offers the stored text of every slot when the decode itself fails", async () => {
    decode.run.mockRejectedValue(new Error("decode is unavailable"));
    renderDrawer(withOptions({ tweakdefs: "STORED-PAYLOAD" }));
    openPanel();
    showChanges("Unit tweaks");
    expect(await screen.findByText(/decode is unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Raw text" }));
    expect(screen.getByText("STORED-PAYLOAD")).toBeTruthy();
  });
});
