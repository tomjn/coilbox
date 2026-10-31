// @vitest-environment happy-dom
/**
 * A player's dossier says which named start position they won from (#3883).
 * The join itself is `playerStarts.test.ts`. This file is what the section
 * shows: a row per named position, nothing for a map with no names, and
 * nothing from a match on another version of the map.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatRecord } from "../../bindings";
import type { ReplayCounts } from "../../mapAggregate";
import type { NameBook } from "../../startNames";

const FRONT = { x: 1000, z: 1000 };
const BACK = { x: 7000, z: 7000 };
const MAP = "Some Map 1.0";

let BOOK: NameBook = {};
let HEIGHTMAP: { width: number; height: number } | undefined;
let COUNTS = new Map<string, ReplayCounts>();

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, fallback: unknown) => [
    Object.keys(BOOK).length > 0 ? BOOK : fallback,
    () => {},
  ],
}));
vi.mock("../../config", () => ({
  THUMB_MINIMAP_MIP: 3,
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncHeightmap: () => ({ data: HEIGHTMAP, loading: false }),
  useUnitsyncMinimap: () => ({
    startPositions: [FRONT, BACK],
    loading: false,
  }),
}));
vi.mock("../../useMapAggregate", () => ({
  useMapReplayCounts: (asks: unknown[]) => ({
    counts: COUNTS,
    failed: [],
    done: COUNTS.size,
    total: asks.length,
    reading: false,
  }),
}));

const { PlayerNamedStarts } = await import("./PlayerNamedStarts");

afterEach(() => {
  cleanup();
  BOOK = {};
  HEIGHTMAP = { width: 1025, height: 1025 };
  COUNTS = new Map();
});

HEIGHTMAP = { width: 1025, height: 1025 };

function played(
  filename: string,
  won: boolean,
  mapName = MAP,
  at = FRONT,
): StatRecord {
  const record = {
    filename,
    path: `/demos/${filename}`,
    mapName,
    winnersKnown: true,
    winningAllyTeams: [won ? 0 : 1],
    remixed: false,
    ais: [],
    players: [
      { name: "Ann", team: 0, allyTeam: 0, spectator: false },
      { name: "Ben", team: 1, allyTeam: 1, spectator: false },
    ],
  } as unknown as StatRecord;
  COUNTS.set(record.path, {
    path: record.path,
    starts: [
      { team: 0, ...at },
      { team: 1, ...BACK },
    ],
  } as ReplayCounts);
  return record;
}

const named = (mapName: string): NameBook => ({
  [mapName]: [
    { key: "d1", name: "front", ...FRONT },
    { key: "d2", name: "back", ...BACK },
  ],
});

function show(records: StatRecord[]) {
  return render(
    <MemoryRouter>
      <PlayerNamedStarts
        records={records}
        playerName="Ann"
        refightFilenames={new Set()}
      />
    </MemoryRouter>,
  );
}

describe("PlayerNamedStarts", () => {
  it("says how often a named position was taken and how many of those were won", () => {
    BOOK = named(MAP);
    show([
      ...[true, true, true, true, false, false].map((won, i) =>
        played(`front${i}`, won),
      ),
      played("back0", true, MAP, BACK),
    ]);
    const front = screen.getByRole("row", { name: /front/ });
    expect(within(front).getByText("6")).not.toBeNull();
    expect(within(front).getByText("won 4 of 6")).not.toBeNull();
    const back = screen.getByRole("row", { name: /back/ });
    expect(within(back).getByText("won 1 of 1")).not.toBeNull();
    expect(screen.getByText("From 7 of 7 games.")).not.toBeNull();
    expect(screen.getByRole("link", { name: MAP }).getAttribute("href")).toBe(
      `/library/maps/${encodeURIComponent(MAP)}`,
    );
    expect(document.body.textContent).not.toMatch(/%/);
  });

  it("shows nothing for a map whose positions have no names", () => {
    show([played("a", true)]);
    expect(screen.queryByTestId("player-named-starts")).toBeNull();
  });

  it("shows nothing for a match on another version of the map", () => {
    BOOK = named(MAP);
    show([played("a", true, "Some Map 1.1")]);
    expect(screen.queryByTestId("player-named-starts")).toBeNull();
  });

  it("keeps a match on another version out of the counts", () => {
    BOOK = named(MAP);
    show([played("a", true), played("b", true, "Some Map 1.1")]);
    expect(screen.getByText("won 1 of 1")).not.toBeNull();
    expect(screen.getByText("From 1 of 1 game.")).not.toBeNull();
  });

  it("says so when the map could not be read", () => {
    BOOK = named(MAP);
    HEIGHTMAP = undefined;
    show([played("a", true)]);
    expect(screen.getByText(/The map could not be read/)).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
