// @vitest-environment happy-dom

/**
 * The "Host a battle" drawer refuses a password the OPENBATTLE line cannot
 * carry (issue #3518). The password is one space separated slot, so a space in
 * it shifts the port and player limit along and opens a battle every joiner
 * sees as full.
 *
 * Stood in the same way as `hostBattleVpn.dom.test.tsx`.
 */

import { DrawerProvider, PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectReachability } from "../../direct/reachability";
import { HostBattleForm } from "./HostBattleForm";

vi.mock("../../direct/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/bindings")>()),
  directVpnRoute: vi.fn(async () => ({ vpn: null })),
}));

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

const REFUSED: DirectReachability = {
  method: null,
  ports: [],
  wanted: [{ port: 8452, externalPort: 8452, transport: "udp" }],
  lanAddress: "192.168.1.45",
  publicAddress: "209.35.91.246",
  publicAddressIsLocal: false,
  routerAddress: null,
  doubleNat: false,
  confirmedPort: null,
  problem: "no UPnP gateway answered",
};

vi.mock("./hostEngineVersion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hostEngineVersion")>()),
  hostEngineVersion: async () => "105.1.1",
}));

vi.mock("../../direct/ReachablePorts", () => ({
  ReachablePorts: ({
    onReport,
    onCheckingChange,
  }: {
    onReport?: (report: DirectReachability | null) => void;
    onCheckingChange?: (checking: boolean) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onReport?.(REFUSED);
        onCheckingChange?.(false);
      }}
    >
      Pretend the router refused
    </button>
  ),
}));

vi.mock("../../direct/reachability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/reachability")>()),
  directClosePorts: vi.fn(async () => ({ closed: true })),
}));

vi.mock("./useHostContent", () => ({
  useHostContent: () => ({
    targets: [],
    target: {
      engineVersion: "105.1.1",
      syncVersion: "105.1.1",
      enginePath: "/e",
      dataDir: "/d",
    },
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
  }),
  hashFailureMessage: () => "",
}));

function form(onHost = vi.fn(async () => {})) {
  render(
    <PersistentStoreProvider>
      <DrawerProvider>
        <HostBattleForm relayAvailable onHost={onHost} />
      </DrawerProvider>
    </PersistentStoreProvider>,
  );
  fireEvent.click(screen.getByText("Pretend the router refused"));
  return onHost;
}

const typePassword = (value: string) =>
  fireEvent.change(
    screen.getByPlaceholderText("Leave blank for an open battle"),
    {
      target: { value },
    },
  );

const hostButton = () =>
  screen.getByRole("button", { name: /Host battle/ }) as HTMLButtonElement;

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("hosting a battle with a password the line cannot carry", () => {
  it("says why, and does not open the battle", () => {
    const onHost = form();
    typePassword("let me in");

    expect(
      screen.getByText(/A battle password cannot contain a space/),
    ).toBeTruthy();
    expect(hostButton().disabled).toBe(true);
    fireEvent.submit(hostButton().closest("form") as HTMLFormElement);
    expect(onHost).not.toHaveBeenCalled();
  });

  it("opens the battle with an ordinary password", async () => {
    const onHost = form();
    typePassword("s3cret!");

    expect(screen.queryByText(/cannot contain a space/)).toBeNull();
    fireEvent.submit(hostButton().closest("form") as HTMLFormElement);
    await vi.waitFor(() => expect(onHost).toHaveBeenCalledTimes(1));
    expect(onHost).toHaveBeenCalledWith(
      expect.objectContaining({ key: "s3cret!" }),
    );
  });
});
