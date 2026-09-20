// @vitest-environment happy-dom

/**
 * The VPN warning in the "Host a battle" drawer (issue #2800).
 *
 * `vpnWarning.dom.test.tsx` proves the words and `vpn.rs` proves the rule. What
 * neither can prove is that the drawer draws it, which is the failure that
 * would leave every other test green and ship a warning nobody ever sees. So
 * this renders the real form and reads what is on it.
 *
 * The content scan and the port opener are stood in for, as in the other tests
 * of this form. Neither is what is being asked about here.
 */

import { DrawerProvider, PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectReachability } from "../../direct/reachability";
import { HostBattleForm } from "./HostBattleForm";

const vpnRoute = vi.hoisted(() => vi.fn());

vi.mock("../../direct/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/bindings")>()),
  directVpnRoute: vpnRoute,
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

function form() {
  render(
    <PersistentStoreProvider>
      <DrawerProvider>
        <HostBattleForm relayAvailable onHost={async () => {}} />
      </DrawerProvider>
    </PersistentStoreProvider>,
  );
  fireEvent.click(screen.getByText("Pretend the router refused"));
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vpnRoute.mockClear();
});

describe("the VPN warning in the hosting drawer", () => {
  it("warns a host whose traffic goes through a VPN", async () => {
    vpnRoute.mockResolvedValue({ vpn: { interface: "utun4" } });
    form();
    const said = await screen.findByText(/utun4/);
    expect(said.textContent).toMatch(/may not be able to reach you directly/);
  });

  // Nothing is said on an ordinary connection, and nothing is said for a
  // private network VPN either: Tailscale leaves the default route alone, so
  // the backend answers the same null for both and the drawer is unchanged.
  it("says nothing when no VPN carries the traffic", async () => {
    vpnRoute.mockResolvedValue({ vpn: null });
    form();
    await vi.waitFor(() => expect(vpnRoute).toHaveBeenCalled());
    expect(screen.queryByText(/VPN/)).toBeNull();
  });
});
