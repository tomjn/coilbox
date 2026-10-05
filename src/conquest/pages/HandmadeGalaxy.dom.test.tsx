// @vitest-environment happy-dom
/**
 * The map page for a hand-made map (issue #3509): the setup offers the choices
 * a fixed map still leaves and no Regenerate, starting saves the map's id and
 * the battles picked for blank locations, a saved conquest resumes on a map
 * that changed, and a map that is gone or unreadable is said plainly.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandmadeMapResult } from "../handmade/read";
import type { ConquestState, GalaxyDoc } from "../model";

const h = vi.hoisted(() => ({
  result: undefined as unknown,
  listed: [] as unknown[],
  conquests: {} as Record<string, unknown>,
  saveFor: vi.fn(),
  maps: [] as { name: string; width: number; height: number }[],
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useHideSidebar: () => {},
}));
vi.mock("../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: { maps: h.maps, games: [], errors: [] },
    error: null,
    loading: false,
    cancelled: false,
    unvouched: null,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false }),
}));
vi.mock("../../content/branding", () => ({
  resolveBranding: () => null,
  useBrandingCatalog: () => [],
}));
vi.mock("../../content/mapEligibility", () => ({
  useMapEligibility: () => ({
    eligible: (m: unknown[]) => m,
    isExcluded: () => false,
  }),
}));
vi.mock("../../content/mapAppearanceCache", () => ({
  useKnownSpaceMaps: () => new Set(),
}));
vi.mock("../../content/pages/components/ReplayHistoryList", () => ({
  ReplayHistoryList: () => null,
}));
vi.mock("../../general/display", () => ({
  useEffectsEnabled: () => false,
  usePerformanceMode: () => false,
  useReduceMotion: () => true,
}));
vi.mock("../../challenge/useChallengeRecords", () => ({
  useRecordChallengeRun: () => {},
}));
vi.mock("../../challenge/ChallengeRecordLine", () => ({
  ChallengeRecordLine: () => null,
}));
vi.mock("../../play/config", () => ({
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      executable: "/engine/spring",
      dataDir: "/data",
      engineVersion: "1",
    },
  }),
}));
vi.mock("../conquests", async () => {
  const { reconcileState } = await import("../model");
  return {
    refreshGalaxies: vi.fn(),
    useGalaxies: () => ({ galaxies: [], loading: false, error: null }),
    useConquestState: () => ({
      file: { conquests: h.conquests },
      loading: false,
      error: null,
      saveFor: h.saveFor,
      stateFor: (galaxy: GalaxyDoc) => {
        const saved = h.conquests[galaxy.id] as ConquestState | undefined;
        return saved ? reconcileState(galaxy, saved) : undefined;
      },
    }),
  };
});
vi.mock("../handmade/useHandmadeMaps", () => ({
  useHandmadeMap: () => ({
    loading: false,
    result: h.result,
    failure: undefined,
  }),
  useHandmadeMaps: () => ({
    maps: h.listed,
    unreadable: [],
    loading: false,
    error: null,
  }),
}));
vi.mock("@/factions/logos", () => ({
  useFactionLogos: () => ({}),
  useFactionLogo: () => null,
}));
vi.mock("../galaxy3d/GalaxyView", () => ({
  GalaxyView: () => null,
  nodeBodyLabel: () => "",
}));
vi.mock("../useUnlocks", () => ({
  useConquestUnlocks: () => ({ unlocks: {}, award: vi.fn() }),
  useAwardFinishedConquest: () => {},
}));
vi.mock("./components/RunSetup", () => ({
  FactionDot: () => null,
  SidePicker: () => null,
}));
vi.mock("./components/BattleOverlay", () => ({ BattleOverlay: () => null }));

import GalaxyPage from "./GalaxyPage";

const ID = "two-shores";

/** A small map as the reader gives it: Midvale's battle is left blank. */
function mapDoc(change: Partial<GalaxyDoc> = {}): GalaxyDoc {
  return {
    schemaVersion: 1,
    id: ID,
    type: "conquest-galaxy",
    title: "Two Shores",
    description: "Two land masses and a strait.",
    game: { shortname: "TG" },
    playerFactionId: "west",
    playableFactionIds: ["west", "east"],
    factions: [
      { id: "west", name: "Western League", color: "#d9a441", side: "Arm" },
      { id: "east", name: "Eastern Crown", color: "#3fa374", side: "Core" },
    ],
    nodes: [
      {
        id: "westhaven",
        name: "Westhaven",
        pos: [0, 0],
        owner: "west",
        kind: "capital",
        difficulty: 1,
        battle: { mapName: "MapA" },
      },
      {
        id: "midvale",
        name: "Midvale",
        pos: [1, 0],
        owner: "neutral",
        difficulty: 2,
        battle: { mapName: "" },
      },
      {
        id: "farwatch",
        name: "Farwatch",
        pos: [2, 0],
        owner: "east",
        kind: "capital",
        difficulty: 5,
        battle: { mapName: "MapB" },
      },
    ],
    links: [
      ["westhaven", "midvale"],
      ["midvale", "farwatch"],
    ],
    terrain: {
      image: "coilbox://localhost/conquestmap/two-shores/picture.png",
      width: 100,
      height: 100,
    },
    theme: { skin: "theatre" },
    createdAt: "",
    updatedAt: "",
    ...change,
  };
}

const ok = (doc: GalaxyDoc): HandmadeMapResult => ({ ok: true, doc });

function saved(change: Partial<ConquestState> = {}): ConquestState {
  return {
    seed: 7,
    turn: 4,
    playerFactionId: "west",
    owners: { westhaven: "west", midvale: "west", farwatch: "east" },
    incursions: [],
    status: "active",
    history: [],
    updatedAt: "2026-10-01T00:00:00.000Z",
    handmade: {
      mapId: ID,
      title: "Two Shores",
      battles: { midvale: "Picked" },
    },
    ...change,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/conquest/${ID}`]}>
      <Routes>
        <Route path="/conquest/:id" element={<GalaxyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.result = ok(mapDoc());
  h.listed = [{ id: ID, title: "Two Shores" }];
  h.conquests = {};
  h.maps = [{ name: "OnlyMap", width: 8, height: 8 }];
  h.saveFor.mockReset();
  h.saveFor.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("setting up a conquest on a hand-made map", () => {
  it("offers faction, fog, threat level and seed, and no Regenerate", () => {
    renderPage();
    expect(screen.getByText("Begin conquest")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Western League/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Eastern Crown/ })).toBeTruthy();
    expect(screen.getByText("Fog of war")).toBeTruthy();
    expect(screen.getByText("Threat level")).toBeTruthy();
    expect(screen.getByLabelText("Conquest seed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Regenerate/ })).toBeNull();
  });

  it("saves the map's id, the choices and a battle for each blank location", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Conquest seed"), {
      target: { value: "4242" },
    });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /Eastern Crown/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start conquest/ }));
    await waitFor(() => expect(h.saveFor).toHaveBeenCalled());
    const [id, state] = h.saveFor.mock.calls[0] as [string, ConquestState];
    expect(id).toBe(ID);
    expect(state.seed).toBe(4242);
    expect(state.playerFactionId).toBe("east");
    expect(state.owners).toEqual({
      westhaven: "west",
      midvale: "neutral",
      farwatch: "east",
    });
    expect(state.handmade).toEqual({
      mapId: ID,
      title: "Two Shores",
      fogOfWar: true,
      threatLevel: undefined,
      battles: { midvale: "OnlyMap" },
    });
    expect(state.revealed).toContain("farwatch");
    expect(JSON.stringify(state)).not.toContain("coilbox://");
  });

  it("says so when a blank battle has no installed map to draw from", () => {
    h.maps = [];
    renderPage();
    expect(
      screen.getByText(
        /This map leaves 1 of its battles for coilbox to choose/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Begin conquest")).toBeNull();
  });
});

describe("resuming a conquest on a hand-made map", () => {
  it("opens the saved conquest on the map as it is now", () => {
    h.conquests = { [ID]: saved() };
    renderPage();
    expect(screen.getByText("Turn")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.queryByText("Begin conquest")).toBeNull();
    // Every blank location already has its battle, so nothing is written.
    expect(h.saveFor).not.toHaveBeenCalled();
  });

  it("opens when a province was removed and another's id changed", async () => {
    const base = mapDoc();
    h.result = ok(
      mapDoc({
        nodes: [
          base.nodes[0],
          { ...base.nodes[1], id: "midvale-new", name: "New Midvale" },
          base.nodes[2],
        ],
        links: [
          ["westhaven", "midvale-new"],
          ["midvale-new", "farwatch"],
        ],
      }),
    );
    h.conquests = {
      [ID]: saved({
        owners: {
          westhaven: "west",
          midvale: "west",
          gone: "west",
          farwatch: "east",
        },
      }),
    };
    renderPage();
    expect(screen.getByText("Turn")).toBeTruthy();
    // The location under its new id is blank, so it draws a battle, and the
    // battle is saved so it keeps it.
    await waitFor(() => expect(h.saveFor).toHaveBeenCalled());
    const [, state] = h.saveFor.mock.calls[0] as [string, ConquestState];
    expect(state.handmade?.battles).toEqual({ "midvale-new": "OnlyMap" });
    expect(state.turn).toBe(4);
  });

  it("says the map is gone, and that the conquest is kept", () => {
    h.result = {
      ok: false,
      errors: [
        {
          code: "file-missing",
          file: "map.json",
          message: `No hand-made map with the id "${ID}" is installed.`,
        },
      ],
    } satisfies HandmadeMapResult;
    h.listed = [];
    h.conquests = { [ID]: saved() };
    renderPage();
    expect(
      screen.getByText('The map "Two Shores" is no longer installed.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Your conquest on it is saved and nothing has been changed/,
      ),
    ).toBeTruthy();
    expect(h.saveFor).not.toHaveBeenCalled();
  });

  it("lists the reader's reasons when the map can no longer be read", () => {
    h.result = {
      ok: false,
      errors: [
        {
          code: "capital-count",
          factionId: "east",
          factionName: "Eastern Crown",
          capitals: [],
          message: 'The faction "Eastern Crown" has no capital.',
        },
      ],
    } satisfies HandmadeMapResult;
    h.conquests = { [ID]: saved() };
    renderPage();
    expect(screen.getByText("This map could not be read.")).toBeTruthy();
    expect(
      screen.getByText('The faction "Eastern Crown" has no capital.'),
    ).toBeTruthy();
    expect(
      screen.getByText(/It carries on once the map can be read again/),
    ).toBeTruthy();
  });

  it("says not found for an id that is neither a galaxy nor a map", () => {
    h.result = { ok: false, errors: [] } satisfies HandmadeMapResult;
    h.listed = [];
    renderPage();
    expect(screen.getByText("Map not found.")).toBeTruthy();
  });
});
