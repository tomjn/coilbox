// @vitest-environment happy-dom

/**
 * Choosing a map from minimaps, not a list of names (issue #2796). The Map
 * field used to be an `OptionSelect` of bare names. It is now a button that
 * swaps the whole drawer's content for the shared `MapPickerGrid`, with a
 * back button, rather than stacking a second drawer on top of the one this
 * form is already showing in.
 *
 * `useHostContent` is stood in the same way `hostBattleMemory.dom.test.tsx`
 * does, so the test drives a fixed map list rather than a real content scan.
 */

import { DrawerProvider, PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostBattleForm } from "./HostBattleForm";

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("../../direct/ReachablePorts", () => ({
  ReachablePorts: () => null,
}));

const setMapName = vi.fn();
const useHostContent = vi.hoisted(() => vi.fn());
vi.mock("./useHostContent", () => ({
  useHostContent: (initialGame?: string, initialMap?: string) =>
    useHostContent(initialGame, initialMap),
  hashFailureMessage: () => "",
}));

const MAPS = [
  { name: "Comet Catcher Redux", archives: [], info: {} },
  { name: "DeltaSiegeDry", archives: [], info: {} },
];

function stubContent() {
  useHostContent.mockReturnValue({
    targets: [],
    target: {
      engineVersion: "105.1.1",
      syncVersion: "105.1.1",
      enginePath: "/e",
      dataDir: "/d",
    },
    games: [{ name: "Balanced Annihilation" }],
    maps: MAPS,
    scanning: false,
    noEngine: false,
    gameName: "Balanced Annihilation",
    setGameName: vi.fn(),
    mapName: "Comet Catcher Redux",
    setMapName,
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
  render(
    <PersistentStoreProvider>
      <DrawerProvider>
        <HostBattleForm relayAvailable={false} onHost={async () => {}} />
      </DrawerProvider>
    </PersistentStoreProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  setMapName.mockClear();
  stubContent();
});

describe("choosing a map from minimaps", () => {
  it("shows the current map's name on a button rather than a dropdown", () => {
    form();
    expect(
      screen.getByRole("button", { name: "Comet Catcher Redux" }),
    ).toBeTruthy();
  });

  it("swaps the form for the map grid, with a back button, on press", () => {
    form();
    fireEvent.click(
      screen.getByRole("button", { name: "Comet Catcher Redux" }),
    );

    expect(screen.getByRole("heading", { name: "Choose a map" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search 2 maps/)).toBeTruthy();
    expect(screen.getByText("DeltaSiegeDry")).toBeTruthy();
    // The form's own fields are gone while the grid is showing, not stacked
    // behind a second drawer.
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("picking a map sets it and returns to the form", () => {
    form();
    fireEvent.click(
      screen.getByRole("button", { name: "Comet Catcher Redux" }),
    );
    fireEvent.click(screen.getByText("DeltaSiegeDry"));

    expect(setMapName).toHaveBeenCalledWith("DeltaSiegeDry");
    // Back on the form, not still showing the grid.
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Choose a map" })).toBeNull();
  });

  it("the back button returns to the form without picking a map", () => {
    form();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Friday night pubs" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Comet Catcher Redux" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to the battle form" }),
    );

    expect(setMapName).not.toHaveBeenCalled();
    // The rest of the form was untouched by the trip into the picker.
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
      "Friday night pubs",
    );
  });
});
