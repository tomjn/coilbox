// @vitest-environment happy-dom

/**
 * The engine version both hosting forms advertise.
 *
 * `hostEngineVersion` is tested on its own. What that cannot prove is that the
 * forms use it, and a form still reading `engineVersion` would pass every one of
 * those tests and go on advertising a folder name. So each form here is handed
 * an engine that was never verified, whose folder name is the one that sent
 * Windows players to the Linux download, and the battle it opens is read back.
 */

import { DrawerProvider, PersistentStoreProvider } from "@picoframe/frame";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostRoomForm, type StartRoomArgs } from "../../direct/HostRoomForm";
import { HostBattleForm, type OpenBattleArgs } from "./HostBattleForm";

const verify = vi.hoisted(() =>
  vi.fn(async () => ({ engine: { syncVersion: "2025.06.20" } })),
);
vi.mock("../../content/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../content/bindings")>()),
  contentVerifyEngine: verify,
}));

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

// Neither the router nor the firewall is what is being asked about.
vi.mock("../../direct/ReachablePorts", () => ({ ReachablePorts: () => null }));
vi.mock("./WindowsFirewall", () => ({ WindowsFirewall: () => null }));
vi.mock("../../direct/reachability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/reachability")>()),
  directClosePorts: async () => ({ closed: true }),
}));

vi.mock("./useHostContent", () => ({
  useHostContent: () => ({
    targets: [],
    target: {
      engineVersion: "recoil_2025.06.20_amd64-linux.7z",
      executable: "/engine/recoil_2025.06.20_amd64-linux.7z/spring",
      enginePath: "/engine/recoil_2025.06.20_amd64-linux.7z",
      dataDir: "/data",
    },
    games: [{ name: "Metal Factions v2.58" }],
    maps: [{ name: "All That Glitters v2.2" }],
    scanning: false,
    noEngine: false,
    gameName: "Metal Factions v2.58",
    setGameName: vi.fn(),
    mapName: "All That Glitters v2.2",
    setMapName: vi.fn(),
    gameInfo: { status: "ready", info: undefined },
    mapInfo: { status: "ready", info: undefined },
    modhash: 1,
    maphash: 2,
    checksumsReady: true,
    gameFailed: false,
    mapFailed: false,
    ready: true,
  }),
  hashFailureMessage: () => "",
}));

afterEach(() => {
  cleanup();
  verify.mockClear();
});

describe("the engine version a hosted battle advertises", () => {
  it("is what the engine reports in a lobby battle, not its folder name", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Host battle" }));

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].version).toBe("2025.06.20");
    expect(verify).toHaveBeenCalledWith({
      path: "/engine/recoil_2025.06.20_amd64-linux.7z/spring",
    });
  });

  it("is what the engine reports in a room, not its folder name", async () => {
    const onStart = vi.fn<(args: StartRoomArgs) => Promise<string | undefined>>(
      async () => undefined,
    );
    render(
      <DrawerProvider>
        <HostRoomForm blocked={null} defaultName="alice" onStart={onStart} />
      </DrawerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart.mock.calls[0][0].battle.version).toBe("2025.06.20");
  });

  it("opens no battle when the engine cannot say its version", async () => {
    verify.mockRejectedValueOnce(new Error("engine version check timed out"));
    const onHost = vi.fn(async () => {});
    render(
      <PersistentStoreProvider>
        <DrawerProvider>
          <HostBattleForm relayAvailable={false} onHost={onHost} />
        </DrawerProvider>
      </PersistentStoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Host battle" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not host the battle: Could not read the engine's version: engine version check timed out",
    );
    expect(onHost).not.toHaveBeenCalled();
  });
});
