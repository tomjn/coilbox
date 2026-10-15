// @vitest-environment happy-dom

/**
 * Two ways the singleplayer roster stopped answering the player.
 *
 * A saved setup could come back holding two rows with one id, after which a
 * change to either row landed on both and the table kept rows on screen that
 * no longer existed. And a game that never reported ending left every control
 * frozen, with the only way out on the top bar.
 *
 * The page is rendered for real, with the same stand-ins as
 * `SkirmishPage.dom.test.tsx`. The participants table prints the ids it is
 * handed, which is the thing under test.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "../config";

const play = vi.hoisted(() => ({
  running: false,
  relayed: false,
  cancel: vi.fn(),
}));

const row = (id: string, kind: Participant["kind"]): Participant => ({
  id,
  kind,
  name: id,
  side: "",
  color: [0.9, 0.24, 0.2],
  allyTeam: kind === "you" ? 0 : 1,
  spectator: false,
});

// What an earlier version wrote: the second `p2` was added after a restart.
const SAVED = {
  participants: [
    row("p0", "you"),
    row("p1", "ai"),
    row("p2", "ai"),
    row("p2", "ai"),
  ],
  gameName: "",
  mapName: "",
  startPosType: 0,
  modOptionValues: {},
};

vi.mock("@picoframe/frame", async (importOriginal) => {
  const react = await import("react");
  return {
    ...(await importOriginal<object>()),
    usePersistentValue: <T,>(_key: string, initial: T) =>
      react.useState<T>(initial),
    useSetting: <T,>(key: string, initial: T) =>
      react.useState<T>(key === "play.skirmish" ? (SAVED as T) : initial),
  };
});

vi.mock("@/content/config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUnitsyncScan: () => ({
    data: null,
    unvouched: null,
    error: null,
    loading: false,
    cancelled: false,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
  useUnitsyncMapMeta: () => ({ meta: new Map() }),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false }),
  useUnitsyncMinimap: () => ({
    url: null,
    startPositions: [],
    loading: false,
    env: undefined,
  }),
  useReplays: () => ({ replays: [], refresh: vi.fn() }),
}));

vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      dataDir: "/data",
      executable: "/engine/spring",
    },
    loading: false,
    refresh: vi.fn(),
  }),
  useSkirmishAis: () => ({ ais: [], loaded: true }),
}));

vi.mock("@/multiplayer/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMultiplayer: () => ({ connections: new Map(), activeKey: null }),
  useProtocolServers: () => [],
}));

vi.mock("../PlayProvider", () => ({
  usePlay: () => ({ ...play, launch: vi.fn() }),
}));

vi.mock("./components/GameSelectCard", () => ({ GameSelectCard: () => null }));
vi.mock("./components/MapCard", () => ({ MapCard: () => null }));
vi.mock("./components/ParticipantsTable", () => ({
  ParticipantsTable: ({ participants }: { participants: Participant[] }) => (
    <div data-testid="roster">{participants.map((p) => p.id).join(" ")}</div>
  ),
}));
vi.mock("../useAiBonusSuggestions", () => ({
  useAiBonusSuggestions: () => ({ rows: {}, all: null }),
}));
vi.mock("./components/GameOptionsPanel", () => ({
  GameOptionsPanel: () => null,
}));
vi.mock("./components/PresetsDrawer", () => ({ PresetsDrawer: () => null }));
vi.mock("./components/DebriefDrawer", () => ({ DebriefDrawer: () => null }));

import SkirmishPage from "./SkirmishPage";

afterEach(() => {
  cleanup();
  play.running = false;
  play.relayed = false;
  play.cancel.mockClear();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <SkirmishPage />
    </MemoryRouter>,
  );
}

describe("SkirmishPage opening a saved setup with a repeated id", () => {
  it("hands the table a different id for every row", () => {
    renderPage();

    const ids = (screen.getByTestId("roster").textContent ?? "").split(" ");
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.slice(0, 3)).toEqual(["p0", "p1", "p2"]);
  });
});

describe("SkirmishPage while a game is running", () => {
  it("offers to end the game beside the notice that the setup is frozen", () => {
    play.running = true;
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(play.cancel).toHaveBeenCalledTimes(1);
  });

  it("leaves a game going through this machine's relay to the top bar, which asks first", () => {
    play.running = true;
    play.relayed = true;
    renderPage();

    expect(screen.getByText(/settings are frozen/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End game" })).toBeNull();
  });

  it("offers nothing when no game is running", () => {
    renderPage();

    expect(screen.queryByRole("button", { name: "End game" })).toBeNull();
  });
});
