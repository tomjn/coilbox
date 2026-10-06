// @vitest-environment happy-dom
/**
 * Challenge codes for a conquest on a hand-made map, on the Conquest hub
 * (issue #3512): a conquest on a hand-made map can be shared as a code that
 * names the map and its version, and importing one starts on the installed
 * map, or stops and says which map is needed, and never generates a map in
 * its place.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeConquestImport,
  type HandmadeConquestChallengeSettings,
  isHandmadeChallenge,
} from "../handmade/challenge";
import {
  heldHandmadeChallenge,
  releaseHandmadeChallenge,
} from "../handmade/heldChallenge";
import type { HandmadeMapSummary } from "../handmade/library";
import type { HandmadeMapResult } from "../handmade/read";
import type { ConquestState, GalaxyDoc } from "../model";

const h = vi.hoisted(() => ({
  drawerContent: null as unknown,
  drawerClose: vi.fn(),
  loadMap: vi.fn(),
  conquestSave: vi.fn(),
  saveFor: vi.fn(),
  navigate: vi.fn(),
  maps: [] as unknown[],
  galaxies: [] as unknown[],
  conquests: {} as Record<string, unknown>,
  installedMaps: [] as { name: string; width: number; height: number }[],
  form: null as null | {
    finish: (settings: unknown) => Promise<{ id: string; doc: unknown }>;
    onImported: (id: string) => void;
    countSubstitutedMaps: (doc: unknown) => number;
    decode: (code: string) => unknown;
  },
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({
    open: (o: { content: unknown }) => {
      h.drawerContent = o.content;
    },
    close: h.drawerClose,
  }),
}));
vi.mock("react-router", async (orig) => ({
  ...(await orig<typeof import("react-router")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("../../challenge/ImportChallengeForm", () => ({
  ImportChallengeForm: (props: NonNullable<typeof h.form>) => {
    h.form = props;
    return null;
  },
}));
vi.mock("../../challenge/ChallengeShare", () => ({
  ChallengeShare: (props: {
    code: string;
    identity: string;
    helpText: string;
  }) => (
    <div>
      <output data-testid="code">{props.code}</output>
      <output data-testid="identity">{props.identity}</output>
      <p>{props.helpText}</p>
    </div>
  ),
}));
// The icon reads the scan target and the hub, which this page test has no use for.
vi.mock("@/components/GameIcon", () => ({ GameIcon: () => null }));
vi.mock("../../content/config", () => ({
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncScan: () => ({
    data: {
      maps: h.installedMaps,
      games: [
        {
          name: "Test Game 1",
          primaryArchive: { name: "test_game_1.sdz" },
          dependencyArchives: [],
          info: { shortname: "TG", version: "1" },
        },
      ],
      errors: [],
    },
    error: null,
    loading: false,
    cancelled: false,
    unvouched: null,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("../../content/branding", () => ({
  resolveBranding: () => null,
  useBrandingCatalog: () => [],
}));
vi.mock("../../content/mapEligibility", () => ({
  useMapEligibility: () => ({ eligible: (m: unknown[]) => m }),
}));
vi.mock("../../content/useGamePresetParam", () => ({
  useGamePresetParam: () => null,
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: null, hubItemId: null }),
}));
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../play/config", () => {
  const target = {
    enginePath: "/engine",
    executable: "/engine/spring",
    dataDir: "/data",
    engineVersion: "1",
  };
  return {
    usePlayReadiness: () => ({
      target,
      state: "ready",
      scanErrors: [],
      scanFailure: null,
      refresh: vi.fn(),
    }),
    usePreferredTarget: () => ({ target }),
    useSkirmishAis: () => ({ ais: [], loading: false, loaded: true }),
  };
});
vi.mock("../bindings", () => ({
  conquestDelete: vi.fn(),
  conquestSave: h.conquestSave,
}));
vi.mock("../conquests", () => ({
  refreshGalaxies: vi.fn(),
  useGalaxies: () => ({ galaxies: h.galaxies, loading: false, error: null }),
  useConquestState: () => ({
    file: { conquests: h.conquests },
    error: null,
    saveFor: h.saveFor,
  }),
}));
vi.mock("../handmade/useHandmadeMaps", () => ({
  refreshHandmadeMaps: vi.fn(),
  useHandmadeMap: () => ({
    loading: false,
    result: h.loadMap(),
    failure: undefined,
  }),
  useHandmadeMaps: () => ({
    maps: h.maps,
    unreadable: [],
    loading: false,
    error: null,
  }),
}));
vi.mock("../handmade/library", () => ({
  importHandmadeMap: vi.fn(),
  removeHandmadeMap: vi.fn(),
  loadHandmadeMap: async () => h.loadMap(),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
vi.mock("../useUnlocks", () => ({
  useConquestUnlocks: () => ({ unlocks: {}, award: vi.fn() }),
  useAwardFinishedConquest: () => {},
}));

import ConquestListPage from "./ConquestListPage";

const ID = "two-shores";
const FINGERPRINT = "00000000000000aa";

const TWO_SHORES: HandmadeMapSummary = {
  id: ID,
  title: "Two Shores",
  description: "Two land masses and a strait.",
  game: { shortname: "TG" },
  source: "imported",
  pictureUrl: "coilbox://localhost/conquestmap/two-shores/picture.png",
  warpath: false,
};

/** The map as the reader gives it: Midvale's battle is left blank. */
function mapDoc(fingerprint = FINGERPRINT): GalaxyDoc {
  return {
    schemaVersion: 1,
    id: ID,
    type: "conquest-galaxy",
    title: "Two Shores",
    description: "",
    game: { shortname: "TG" },
    playerFactionId: "west",
    factions: [
      { id: "west", name: "Western League", color: "#d9a441" },
      { id: "east", name: "Eastern Crown", color: "#3fa374" },
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
    theme: { skin: "theatre" },
    handmade: { mapId: ID, fingerprint },
    createdAt: "",
    updatedAt: "",
  };
}

const ok = (doc: GalaxyDoc): HandmadeMapResult => ({ ok: true, doc });

function conquest(): ConquestState {
  return {
    seed: 7,
    turn: 3,
    playerFactionId: "west",
    owners: { westhaven: "west", midvale: "west", farwatch: "east" },
    incursions: [],
    status: "active",
    history: [],
    updatedAt: "2026-10-01T00:00:00.000Z",
    handmade: {
      mapId: ID,
      title: "Two Shores",
      fogOfWar: true,
      threatLevel: 2,
      battles: { midvale: "Picked" },
    },
  };
}

const CHALLENGE: HandmadeConquestChallengeSettings = {
  game: { shortname: "TG" },
  title: "Two Shores",
  map: {
    source: "handmade",
    id: ID,
    fingerprint: FINGERPRINT,
    title: "Two Shores",
  },
  fogOfWar: true,
  threatLevel: 2,
  nodeMaps: { midvale: "Picked" },
};

function renderIn(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

/** Open the import drawer and hand back what the page gave the shared form. */
function openImport() {
  renderIn(<ConquestListPage />);
  fireEvent.click(screen.getByRole("button", { name: /Import challenge/ }));
  cleanup();
  renderIn(h.drawerContent as ReactNode);
  if (!h.form) throw new Error("the import form did not render");
  return h.form;
}

async function refusal(settings: unknown = CHALLENGE): Promise<string> {
  const form = openImport();
  try {
    await form.finish(settings);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "";
}

beforeEach(() => {
  h.drawerContent = null;
  h.form = null;
  h.maps = [TWO_SHORES];
  h.galaxies = [];
  h.conquests = {};
  h.installedMaps = [{ name: "Picked", width: 8, height: 8 }];
  for (const mock of [h.loadMap, h.conquestSave, h.saveFor, h.navigate]) {
    mock.mockReset();
  }
  h.loadMap.mockReturnValue(ok(mapDoc()));
});
afterEach(() => {
  cleanup();
  releaseHandmadeChallenge(ID);
});

describe("sharing a conquest on a hand-made map", () => {
  it("offers no code for a map with no conquest on it", () => {
    renderIn(<ConquestListPage />);
    expect(
      screen.queryByRole("button", { name: /Share Two Shores/ }),
    ).toBeNull();
  });

  it("makes a code that names the map, its version and the conquest's choices", () => {
    h.conquests = { [ID]: conquest() };
    renderIn(<ConquestListPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Share Two Shores as a challenge code",
      }),
    );
    cleanup();
    renderIn(h.drawerContent as ReactNode);

    const decoded = decodeConquestImport(
      screen.getByTestId("code").textContent ?? "",
    );
    if (!decoded.ok || !isHandmadeChallenge(decoded.settings)) {
      throw new Error("expected a challenge on a hand-made map");
    }
    expect(decoded.settings).toEqual(CHALLENGE);
    expect(screen.getByTestId("identity").textContent).toContain(FINGERPRINT);
    expect(screen.getByText(/The code does not carry the map/)).toBeTruthy();
  });

  it("says why when the map cannot be read", () => {
    h.conquests = { [ID]: conquest() };
    h.loadMap.mockReturnValue({ ok: false, errors: [] });
    renderIn(<ConquestListPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Share Two Shores as a challenge code",
      }),
    );
    cleanup();
    renderIn(h.drawerContent as ReactNode);
    expect(screen.getByText(/No challenge code can be made/)).toBeTruthy();
    expect(screen.queryByTestId("code")).toBeNull();
  });
});

describe("importing a challenge made on a hand-made map", () => {
  it("opens the installed map with the challenge waiting on it, and saves no map", async () => {
    const form = openImport();
    const { id, doc } = await form.finish(CHALLENGE);

    expect(id).toBe(ID);
    expect(heldHandmadeChallenge(ID)).toEqual(CHALLENGE);
    expect(form.countSubstitutedMaps(doc)).toBe(0);
    expect(h.conquestSave).not.toHaveBeenCalled();

    form.onImported(id);
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith("/conquest/two-shores"),
    );
  });

  it("counts a named battle map this install lacks as substituted", async () => {
    h.installedMaps = [{ name: "Another", width: 8, height: 8 }];
    const form = openImport();
    const { doc } = await form.finish(CHALLENGE);
    expect(form.countSubstitutedMaps(doc)).toBe(1);
  });

  it("says which map and game are needed when the map is not installed, and generates nothing", async () => {
    h.loadMap.mockReturnValue({
      ok: false,
      errors: [
        {
          code: "file-missing",
          file: "map.json",
          message: 'No hand-made map with the id "two-shores" is installed.',
        },
      ],
    });

    const message = await refusal();

    expect(message).toContain('the hand-made map "Two Shores"');
    expect(message).toContain("made for Test Game 1");
    expect(message).toContain("not installed here");
    expect(message).not.toMatch(/galaxy/i);
    expect(h.conquestSave).not.toHaveBeenCalled();
    expect(heldHandmadeChallenge(ID)).toBeUndefined();
  });

  it("says so and does not start when the installed map is a different version", async () => {
    h.loadMap.mockReturnValue(ok(mapDoc("00000000000000bb")));

    const message = await refusal();

    expect(message).toContain(
      'a different version of the hand-made map "Two Shores"',
    );
    expect(message).toContain("was not started");
    expect(h.conquestSave).not.toHaveBeenCalled();
    expect(heldHandmadeChallenge(ID)).toBeUndefined();
  });

  it("leaves a conquest already on the map alone", async () => {
    h.conquests = { [ID]: conquest() };

    const message = await refusal();

    expect(message).toContain(
      'You already have a conquest on the hand-made map "Two Shores"',
    );
    expect(heldHandmadeChallenge(ID)).toBeUndefined();
    expect(h.saveFor).not.toHaveBeenCalled();
  });

  it("refuses when a stored map hides the hand-made one", async () => {
    h.galaxies = [{ galaxy: { ...mapDoc(), handmade: undefined } }];

    const message = await refusal();

    expect(message).toContain("which another map in your list already uses");
    expect(heldHandmadeChallenge(ID)).toBeUndefined();
  });

  it("reads a code that names a hand-made map as one", () => {
    const form = openImport();
    expect(form.decode("not a code")).toMatchObject({ ok: false });
    expect(form.decode).toBe(decodeConquestImport);
  });
});
