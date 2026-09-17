// @vitest-environment happy-dom

/**
 * Choosing a map from minimaps, not a list of names, on the "Host on LAN"
 * form (issue #2864). The lobby hosting form got this in #2796. The room form
 * is a separate component that issue did not name, so it kept the old
 * dropdown of bare names until now.
 *
 * The Map field is now a button that swaps the whole drawer's content for the
 * shared `MapPickerGrid`, with a back button, the same way
 * `HostBattleForm.tsx` does it, rather than stacking a second drawer on top
 * of the one this form is already showing in.
 *
 * `useHostContent` is stood in the same way `hostEngineVersion.dom.test.tsx`
 * does, so the test drives a fixed map list rather than a real content scan.
 */

import { DrawerProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostRoomForm, type StartRoomArgs } from "./HostRoomForm";

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

// Neither the router nor the firewall is what is being asked about.
vi.mock("./ReachablePorts", () => ({ ReachablePorts: () => null }));

const setMapName = vi.fn();
const useHostContent = vi.hoisted(() => vi.fn());
vi.mock("../multiplayer/battles/useHostContent", () => ({
  useHostContent: () => useHostContent(),
  hashFailureMessage: () => "",
}));

const MAPS = [
  { name: "Comet Catcher Redux", archives: [], info: {} },
  { name: "DeltaSiegeDry", archives: [], info: {} },
];

function stubContent() {
  useHostContent.mockReturnValue({
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
    gameInfo: { status: "ready", info: undefined },
    mapInfo: { status: "ready", info: undefined },
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
    <DrawerProvider>
      <HostRoomForm
        blocked={null}
        defaultName="alice"
        onStart={vi.fn<(args: StartRoomArgs) => Promise<string | undefined>>(
          async () => undefined,
        )}
      />
    </DrawerProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  setMapName.mockClear();
  stubContent();
});

describe("choosing a room's map from minimaps", () => {
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
    expect(screen.queryByLabelText("Room name")).toBeNull();
  });

  it("picking a map sets it and returns to the form", () => {
    form();
    fireEvent.click(
      screen.getByRole("button", { name: "Comet Catcher Redux" }),
    );
    fireEvent.click(screen.getByText("DeltaSiegeDry"));

    expect(setMapName).toHaveBeenCalledWith("DeltaSiegeDry");
    // Back on the form, not still showing the grid.
    expect(screen.getByLabelText("Room name")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Choose a map" })).toBeNull();
  });

  it("the back button returns to the form without picking a map, other fields untouched", () => {
    form();
    fireEvent.change(screen.getByLabelText("Room name"), {
      target: { value: "Friday night pubs" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Comet Catcher Redux" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to the room form" }),
    );

    expect(setMapName).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Room name") as HTMLInputElement).value).toBe(
      "Friday night pubs",
    );
  });
});
