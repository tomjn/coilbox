// @vitest-environment happy-dom

/**
 * Remembering the last battle hosted (issue #2794). The drawer used to start
 * from scratch every time: the game and map went back to whichever came first
 * in the scan, and the title, player limit and port went back to their
 * defaults. A host who hosts the same game most evenings had to pick
 * everything again each time.
 *
 * The game and map come from `useHostContent`, stood in for below so the test
 * can see what it was asked to preselect rather than driving a real content
 * scan. The title, player limit and port are plain form state, so those are
 * read straight off the inputs.
 */

import { DrawerProvider, PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostBattleForm, type OpenBattleArgs } from "./HostBattleForm";

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("../../direct/ReachablePorts", () => ({
  ReachablePorts: () => null,
}));

// Every call is recorded, so a test can read what the form asked to
// preselect on its next mount without driving a real content scan.
const useHostContent = vi.hoisted(() => vi.fn());
vi.mock("./useHostContent", () => ({
  useHostContent: (initialGame?: string, initialMap?: string) =>
    useHostContent(initialGame, initialMap),
  hashFailureMessage: () => "",
}));

function stubContent(gameName: string, mapName: string) {
  useHostContent.mockReturnValue({
    target: {
      engineVersion: "105.1.1",
      syncVersion: "105.1.1",
      enginePath: "/e",
      dataDir: "/d",
    },
    games: [{ name: gameName }],
    maps: [{ name: mapName }],
    scanning: false,
    noEngine: false,
    gameName,
    setGameName: vi.fn(),
    mapName,
    setMapName: vi.fn(),
    gameInfo: { status: "ready", info: { checksum: "1a2b3c4d" } },
    mapInfo: { status: "ready", info: { checksum: "5e6f7a8b" } },
    modhash: 1,
    maphash: 2,
    checksumsReady: true,
    gameFailed: false,
    mapFailed: false,
    ready: true,
  });
}

function form() {
  const opened: OpenBattleArgs[] = [];
  render(
    <PersistentStoreProvider>
      <DrawerProvider>
        <HostBattleForm
          relayAvailable={false}
          onHost={async (args) => {
            opened.push(args);
          }}
        />
      </DrawerProvider>
    </PersistentStoreProvider>,
  );
  return opened;
}

const host = () =>
  fireEvent.click(screen.getByRole("button", { name: "Host battle" }));

afterEach(cleanup);

beforeEach(() => {
  // A host's settings from one test would otherwise seed the next.
  localStorage.clear();
  useHostContent.mockClear();
});

describe("remembering the last battle hosted", () => {
  it("preselects the game and map that were hosted last time", async () => {
    stubContent("Balanced Annihilation", "Comet Catcher Redux");
    const opened = form();
    // First mount: nothing remembered yet, so nothing is asked for.
    expect(useHostContent).toHaveBeenLastCalledWith("", "");

    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    cleanup();

    stubContent("Zero-K", "DeltaSiegeDry");
    form();
    // Second mount: the game and map from the battle just hosted are asked
    // for, regardless of what the (stood-in) scan actually has.
    expect(useHostContent).toHaveBeenLastCalledWith(
      "Balanced Annihilation",
      "Comet Catcher Redux",
    );
  });

  it("preselects the title, player limit and port that were hosted last time", async () => {
    stubContent("Balanced Annihilation", "Comet Catcher Redux");
    const opened = form();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Friday night pubs" },
    });
    fireEvent.change(screen.getByLabelText("Max players"), {
      target: { value: "16" },
    });
    fireEvent.change(screen.getByLabelText("Port"), {
      target: { value: "8500" },
    });

    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].maxPlayers).toBe(16);
    cleanup();

    form();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
      "Friday night pubs",
    );
    expect(
      (screen.getByLabelText("Max players") as HTMLInputElement).value,
    ).toBe("16");
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "8500",
    );
  });

  it("does not remember the password", async () => {
    stubContent("Balanced Annihilation", "Comet Catcher Redux");
    const opened = form();
    fireEvent.change(screen.getByLabelText("Password (optional)"), {
      target: { value: "hunter2" },
    });

    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    cleanup();

    form();
    expect(
      (screen.getByLabelText("Password (optional)") as HTMLInputElement).value,
    ).toBe("");
  });
});
