// @vitest-environment happy-dom

/**
 * Applying parts of a skirmish preset to a live room, in the same sheet shape
 * Singleplayer uses.
 *
 * Two things worth holding down. The map gate: reading a map's checksum used to
 * block the whole apply, so a preset's options could not be applied without
 * owning its map, which is exactly when taking only the options is worth doing.
 * And the list: presets for other games belong in it, because the panel blocks
 * the game-keyed parts by itself and an exact game-name match left the list
 * empty for anyone whose game had moved a version.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "@/play/participants";
import type { PresetSelection } from "@/play/presetParts";
import type { SkirmishPreset } from "@/play/presets";
import { ApplySkirmishPresetDrawer } from "./ApplySkirmishPresetDrawer";
import type { TweakDelivery } from "./useTweakDelivery";

const mapStatus = vi.hoisted(() => ({ value: "ready" as string }));
// What unitsync would say about each map, by name. A map not listed has no
// options and no start positions, which is what an unread one looks like.
const maps = vi.hoisted(() => ({
  games: {} as Record<
    string,
    { key: string; name: string; type?: string; default?: string }[]
  >,
  options: {} as Record<
    string,
    { key: string; name: string; type?: string; default?: string }[]
  >,
  positions: {} as Record<string, number>,
  // The maps the player has, or null while the install has not been read.
  installed: null as string[] | null,
}));

vi.mock("@/content/config", () => ({
  THUMB_MINIMAP_MIP: 3,
  useUnitsyncScan: () => ({
    data: maps.installed
      ? { maps: maps.installed.map((name) => ({ name })) }
      : null,
  }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
  useUnitsyncGameInfo: (
    _engine?: string,
    _data?: string,
    archive?: string,
  ) => ({
    info: archive ? { options: maps.games[archive] ?? [] } : null,
    status: archive ? "ready" : "idle",
    loading: false,
  }),
  useUnitsyncMapInfo: (_engine?: string, _data?: string, map?: string) => ({
    status: mapStatus.value,
    info:
      mapStatus.value === "ready"
        ? { checksum: "0x1234", options: maps.options[map ?? ""] ?? [] }
        : undefined,
  }),
  useUnitsyncMinimap: (_engine?: string, _data?: string, map?: string) => ({
    loading: false,
    startPositions: Array.from({ length: maps.positions[map ?? ""] ?? 0 }),
  }),
}));

// The tweaks row reads the project library, which lives in the frame's
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

afterEach(() => {
  cleanup();
  decode.run.mockReset();
  mapStatus.value = "ready";
  maps.games = {};
  maps.options = {};
  maps.positions = {};
  maps.installed = null;
});

const _idleDelivery = (): TweakDelivery => ({
  progress: null,
  running: false,
  start: vi.fn(async () => null),
  cancel: vi.fn(),
  clear: vi.fn(),
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

const preset = (over: Partial<SkirmishPreset> = {}): SkirmishPreset => ({
  id: "preset-1",
  name: "Ruleset",
  createdAt: "",
  lastUsedAt: "",
  participants: [you],
  gameName: "A Game",
  mapName: "Preset Map",
  startPosType: 2,
  startRects: { "0": { left: 0, top: 0, right: 100, bottom: 200 } },
  modOptionValues: { maxunits: "8000", tweakdefs: "PRESET" },
  restrictions: { disabledUnits: ["armcom"] },
  ...over,
});

function renderDrawer(
  over: Partial<Parameters<typeof ApplySkirmishPresetDrawer>[0]> = {},
) {
  const onApply = vi.fn();
  render(
    <ApplySkirmishPresetDrawer
      open={true}
      onOpenChange={vi.fn()}
      presets={[preset()]}
      gameName="A Game"
      currentMapName="Room Map"
      currentStartPosType={0}
      modOptionsSchema={[]}
      onApplyTweaks={vi.fn()}
      onApply={onApply}
      saveLabel="Save this battle"
      onSave={vi.fn()}
      onImport={vi.fn()}
      onSaveFromReplay={vi.fn()}
      onBrowseHub={vi.fn()}
      {...over}
    />,
  );
  return { onApply };
}

const openPanel = (name = "Ruleset") => fireEvent.click(screen.getByText(name));

// Exact, because "Map" and "Map options" are both rows.
const checkbox = (label: string) =>
  screen.getByRole("checkbox", { name: label });

const selectionOf = (onApply: ReturnType<typeof vi.fn>) =>
  (onApply.mock.calls[0][2] as PresetSelection).parts;

describe("the room's preset library", () => {
  it("offers the same four ways in that Singleplayer does", () => {
    renderDrawer();
    for (const label of [
      "Save this battle",
      "Import",
      "Create from replay",
      "Browse the hub",
    ])
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });

  it("names the preset before saving, the way the sheet always has", () => {
    const onSave = vi.fn();
    renderDrawer({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Save this battle" }));
    const field = screen.getByPlaceholderText("Preset name");
    fireEvent.change(field, { target: { value: "Simian Simmers" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(onSave).toHaveBeenCalledWith("Simian Simmers");
  });
});

describe("the room's preset list", () => {
  it("reads the same as Singleplayer's, a row that opens a panel", () => {
    renderDrawer();
    openPanel();
    expect(
      screen.getByRole("button", { name: "Back to presets" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Apply all/ })).toBeTruthy();
  });

  it("lists a preset saved under another game", () => {
    renderDrawer({ presets: [preset({ gameName: "Some Other Game 9.9" })] });
    expect(screen.getByText("Ruleset")).toBeTruthy();
  });
});

describe("the room's preset panel", () => {
  it("never offers the game, because the room cannot change it", () => {
    renderDrawer();
    openPanel();
    expect(screen.queryByRole("checkbox", { name: "Game" })).toBeNull();
  });

  it("applies every part it offers", () => {
    const { onApply } = renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Apply all 6 parts" }));
    expect(selectionOf(onApply)).toEqual([
      "map",
      "startPositions",
      "modOptions",
      "tweakSlots",
      "teams",
      "restrictions",
    ]);
  });

  it("blocks the game-keyed parts of a preset from another game, saying why", () => {
    const { onApply } = renderDrawer({
      presets: [preset({ gameName: "Some Other Game 9.9" })],
    });
    openPanel();
    expect(
      screen.getAllByText(
        "Belongs to Some Other Game 9.9, and this room is running A Game.",
      ).length,
    ).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Apply all 3 parts" }));
    expect(selectionOf(onApply)).toEqual(["map", "startPositions", "teams"]);
  });

  it("waits on the map checksum when we run the game ourselves", () => {
    mapStatus.value = "loading";
    renderDrawer({ selfHost: true });
    openPanel();
    expect(
      screen
        .getByRole("button", { name: "Reading map…" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("does not wait on a checksum a bot-hosted room never needs", () => {
    // The map goes out as `!map <name>` there, which names the map rather than
    // hashing it, so waiting on unitsync would block an apply for nothing.
    mapStatus.value = "loading";
    const { onApply } = renderDrawer({ selfHost: false });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Apply all 6 parts" }));
    expect(onApply).toHaveBeenCalled();
  });

  it("says who owns the restrictions when they cannot be sent here", () => {
    const { onApply } = renderDrawer({ canEditRestrictions: false });
    openPanel();
    expect(
      screen.getByText("The host owns these. There is no autohost command."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply all 5 parts" }));
    expect(selectionOf(onApply)).not.toContain("restrictions");
  });

  it("applies the options without the map or the teams", () => {
    const { onApply } = renderDrawer();
    openPanel();
    fireEvent.click(checkbox("Map"));
    fireEvent.click(checkbox("Start positions"));
    fireEvent.click(checkbox("Teams and bots"));
    fireEvent.click(checkbox("Unit restrictions"));
    fireEvent.click(screen.getByRole("button", { name: "Apply 2 parts" }));
    expect(selectionOf(onApply)).toEqual(["modOptions", "tweakSlots"]);
  });
});

describe("the room's preset panel, warning about what does not fit", () => {
  const twoPlayers = (): Participant[] => [
    you,
    { ...you, id: "p1", kind: "ai", name: "Bot", allyTeam: 1 },
  ];
  const threePlayers = (): Participant[] => [
    ...twoPlayers(),
    { ...you, id: "p2", kind: "ai", name: "Bot 2", allyTeam: 2 },
  ];

  it("names a mod option the game does not declare", () => {
    maps.games["a-game.sdz"] = [{ key: "maxunits", name: "Max units" }];
    renderDrawer({
      archive: "a-game.sdz",
      presets: [
        preset({ modOptionValues: { maxunits: "8000", bogus: "1", odd: "2" } }),
      ],
    });
    openPanel();
    expect(
      screen.getByText("A Game does not declare bogus, odd."),
    ).toBeTruthy();
  });

  it("names a map option the preset's map does not declare", () => {
    maps.options["Preset Map"] = [{ key: "fog", name: "Fog" }];
    renderDrawer({
      presets: [preset({ mapOptionValues: { fog: "1", wind: "3" } })],
    });
    openPanel();
    expect(screen.getByText("Preset Map does not declare wind.")).toBeTruthy();
  });

  it("checks map options against the room's map when the map is left out", () => {
    maps.options["Room Map"] = [{ key: "wind", name: "Wind" }];
    maps.options["Preset Map"] = [{ key: "fog", name: "Fog" }];
    renderDrawer({
      presets: [preset({ mapOptionValues: { wind: "3" } })],
    });
    openPanel();
    // The preset's map does not declare wind, so with the map ticked it warns.
    expect(screen.getByText("Preset Map does not declare wind.")).toBeTruthy();
    fireEvent.click(checkbox("Map"));
    expect(screen.queryByText(/does not declare/)).toBeNull();
  });

  it("warns when the roster has more teams than the map has start positions", () => {
    maps.positions["Preset Map"] = 2;
    renderDrawer({
      presets: [preset({ startPosType: 0, participants: threePlayers() })],
    });
    openPanel();
    expect(
      screen.getByText("3 teams, but Preset Map has 2 start positions."),
    ).toBeTruthy();
  });

  it("does not count start positions when the boxes decide", () => {
    maps.positions["Preset Map"] = 2;
    renderDrawer({
      presets: [preset({ startPosType: 2, participants: threePlayers() })],
    });
    openPanel();
    expect(screen.queryByText(/start positions\./)).toBeNull();
  });

  it("warns on the map before it is sent when the player does not have it", () => {
    maps.installed = ["Room Map"];
    renderDrawer();
    openPanel();
    expect(screen.getByText("You do not have Preset Map.")).toBeTruthy();
  });

  it("makes no map check when the map is left out or already installed", () => {
    maps.installed = ["Room Map"];
    renderDrawer();
    openPanel();
    fireEvent.click(checkbox("Map"));
    expect(screen.queryByText(/You do not have/)).toBeNull();
    cleanup();
    maps.installed = ["Room Map", "Preset Map"];
    renderDrawer();
    openPanel();
    expect(screen.queryByText(/You do not have/)).toBeNull();
  });

  it("shows no warning for a preset that fits", () => {
    maps.positions["Preset Map"] = 2;
    maps.options["Preset Map"] = [{ key: "fog", name: "Fog" }];
    maps.games["a-game.sdz"] = [{ key: "maxunits", name: "Max units" }];
    renderDrawer({
      archive: "a-game.sdz",
      presets: [
        preset({
          startPosType: 0,
          participants: twoPlayers(),
          modOptionValues: { maxunits: "8000" },
          mapOptionValues: { fog: "1" },
        }),
      ],
    });
    openPanel();
    expect(screen.queryByText(/does not declare|start positions\./)).toBeNull();
  });
});

describe("what a preset changes, in the room", () => {
  const schema = [
    { key: "maxunits", name: "Max units", type: "number", default: "1000" },
    { key: "fog", name: "Fog", type: "bool", default: "true" },
  ];

  /** Open the list under one part's row. */
  const showChanges = (part: string) => {
    const row = screen.getByText(part).closest("li");
    if (!row) throw new Error(`no row for ${part}`);
    fireEvent.click(
      within(row).getByRole("button", { name: "What it changes" }),
    );
  };

  it("shows one row for one option off its default, with the room's value beside it", () => {
    maps.games["a-game.sdz"] = schema;
    renderDrawer({
      archive: "a-game.sdz",
      presets: [preset({ modOptionValues: { maxunits: "8000", fog: "1" } })],
      scriptTags: { "game/modoptions/maxunits": "2000" },
    });
    openPanel();
    showChanges("Mod options");
    expect(screen.getByText("Max units")).toBeTruthy();
    expect(screen.getByText("Preset 8000, default 1000")).toBeTruthy();
    expect(screen.getByText("Now 2000")).toBeTruthy();
    expect(screen.queryByText("Fog")).toBeNull();
  });

  it("says a preset equal to the defaults changes nothing", () => {
    maps.games["a-game.sdz"] = schema;
    renderDrawer({
      archive: "a-game.sdz",
      presets: [preset({ modOptionValues: { maxunits: "1000", fog: "true" } })],
    });
    openPanel();
    showChanges("Mod options");
    expect(screen.getByText("Changes nothing from the defaults.")).toBeTruthy();
  });

  it("says so when the game's options are not available", () => {
    renderDrawer({
      presets: [preset({ modOptionValues: { maxunits: "8000" } })],
    });
    openPanel();
    showChanges("Mod options");
    expect(
      screen.getByText(/The options for A Game are not available/),
    ).toBeTruthy();
  });

  it("compares map options with the map's defaults", () => {
    maps.options["Preset Map"] = [
      { key: "wind", name: "Wind", type: "number", default: "5" },
    ];
    renderDrawer({
      presets: [preset({ mapOptionValues: { wind: "9" } })],
    });
    openPanel();
    showChanges("Map options");
    expect(screen.getByText("Wind")).toBeTruthy();
    expect(screen.getByText("Preset 9, default 5")).toBeTruthy();
  });

  it("lists a tweak slot's units and fields from the decode", async () => {
    decode.run.mockResolvedValue({
      tweakdefs: [
        {
          key: "tweakdefs",
          kind: "tweakdefs",
          slot: 0,
          lua: "",
          manifest: null,
          form: "table",
          table: { armcom: { health: 5000 } },
          error: null,
        },
      ],
      tweakunits: [],
      unrecognised: [],
    });
    renderDrawer();
    openPanel();
    showChanges("Unit tweaks");
    expect(await screen.findByText("health = 5000")).toBeTruthy();
    expect(decode.run).toHaveBeenCalledWith({
      entries: { tweakdefs: "PRESET" },
    });
  });
});
