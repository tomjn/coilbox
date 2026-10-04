// @vitest-environment happy-dom

/**
 * The Host battle button and the submit guard answer the same question, and a
 * button that is not live says why in the form.
 *
 * Stood in the same way as `hostBattlePassword.dom.test.tsx`.
 */

import { DrawerProvider, PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostBattleForm } from "./HostBattleForm";

vi.mock("../../direct/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/bindings")>()),
  directVpnRoute: vi.fn(async () => ({ vpn: null })),
}));

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("./hostEngineVersion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hostEngineVersion")>()),
  hostEngineVersion: async () => "105.1.1",
}));

vi.mock("../../direct/ReachablePorts", () => ({
  ReachablePorts: () => null,
}));

vi.mock("../../direct/reachability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/reachability")>()),
  directClosePorts: vi.fn(async () => ({ closed: true })),
}));

const TARGET = {
  engineVersion: "105.1.1",
  syncVersion: "105.1.1",
  enginePath: "/e",
  dataDir: "/d",
};

const content = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("./useHostContent", () => ({
  useHostContent: () => content.current,
  hashFailureMessage: () => "",
}));

function contentWith(over: Record<string, unknown>) {
  content.current = {
    targets: [],
    target: TARGET,
    games: [{ name: "Balanced Annihilation" }],
    maps: [{ name: "Comet Catcher Redux" }],
    scanning: false,
    noEngine: false,
    gameName: "Balanced Annihilation",
    setGameName: vi.fn(),
    mapName: "Comet Catcher Redux",
    setMapName: vi.fn(),
    gameInfo: { status: "ready", info: { checksum: "1a2b3c4d" } },
    mapInfo: { status: "ready", info: { checksum: "5e6f7a8b" } },
    modhash: 1,
    maphash: 2,
    checksumsReady: true,
    gameFailed: false,
    mapFailed: false,
    ready: true,
    ...over,
  };
}

function form() {
  const onHost = vi.fn(async () => {});
  render(
    <PersistentStoreProvider>
      <DrawerProvider>
        <HostBattleForm relayAvailable={false} onHost={onHost} />
      </DrawerProvider>
    </PersistentStoreProvider>,
  );
  return onHost;
}

const hostButton = () =>
  screen.getByRole("button", { name: /Host battle/ }) as HTMLButtonElement;

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("a Host battle press that cannot open a battle", () => {
  it("is not offered when there is no engine to host with, and the form says so", () => {
    contentWith({ target: null, ready: true });
    const onHost = form();

    expect(hostButton().disabled).toBe(true);
    expect(screen.getByText("Choose an engine to host with.")).toBeTruthy();
    fireEvent.submit(hostButton().closest("form") as HTMLFormElement);
    expect(onHost).not.toHaveBeenCalled();
  });

  it("says a game is missing", () => {
    contentWith({ gameName: "", ready: false });
    form();

    expect(hostButton().disabled).toBe(true);
    expect(screen.getByText("Choose a game.")).toBeTruthy();
  });

  it("says a map is missing", () => {
    contentWith({ mapName: "", ready: false });
    form();

    expect(hostButton().disabled).toBe(true);
    expect(screen.getByText("Choose a map.")).toBeTruthy();
  });

  it("says nothing and hosts when everything is in place", async () => {
    contentWith({});
    const onHost = form();

    expect(hostButton().disabled).toBe(false);
    expect(screen.queryByText(/^Choose a/)).toBeNull();
    fireEvent.submit(hostButton().closest("form") as HTMLFormElement);
    await vi.waitFor(() => expect(onHost).toHaveBeenCalledTimes(1));
  });
});
