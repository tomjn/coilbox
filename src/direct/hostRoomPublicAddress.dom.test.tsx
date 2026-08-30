// @vitest-environment happy-dom

/**
 * The address the reachability panel measured reaches the room (issue #2130).
 *
 * `ownPublicAddress` is tested on its own and proves the rule. What it cannot
 * prove is that anything ever calls it. That matters more than usual here: the
 * room has taken an address from its caller since it was written, the hosting
 * form has never filled it, and issue #2127 turned down a fix on the grounds
 * that the room holds no second address to give. A helper nothing wires up would
 * leave the VPS host exactly where they started.
 *
 * So this drives the form the way a host does. Tick "Reachable over the
 * internet", press Start, and read what the page was handed.
 *
 * The port opener and the content scan are stood in for. This machine has no
 * public address to be reached at, which the milestone established, and the
 * content half is the same in both branches and answered by its own tests.
 */

import { DrawerProvider } from "@picoframe/frame";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostRoomForm, type StartRoomArgs } from "./HostRoomForm";
import type { DirectReachability } from "./reachability";

/** A VPS with Docker on it. STUN's answer is one of this machine's own
 *  addresses, and `lanAddress` is the bridge, which is the whole bug. */
const ON_PUBLIC_ADDRESS: DirectReachability = {
  method: null,
  ports: [],
  wanted: [
    { port: 8200, externalPort: 8200, transport: "tcp" },
    { port: 8452, externalPort: 8452, transport: "udp" },
  ],
  lanAddress: "172.17.0.1",
  publicAddress: "209.35.91.246",
  publicAddressIsLocal: true,
  routerAddress: null,
  doubleNat: false,
  confirmedPort: 8452,
  problem: "no UPnP gateway answered",
};

/** The ordinary home connection. There is a router, it refused, and the public
 *  address is the router's rather than this machine's. */
const REFUSED: DirectReachability = {
  ...ON_PUBLIC_ADDRESS,
  lanAddress: "192.168.1.45",
  publicAddressIsLocal: false,
  confirmedPort: null,
};

const answer = vi.hoisted(() => ({
  current: null as DirectReachability | null,
}));

vi.mock("./useReachablePorts", () => ({
  useReachablePorts: (ports: unknown) => ({
    // Null while the box is unticked, which is what the real hook is handed.
    report: ports ? answer.current : null,
    busy: false,
    error: null,
  }),
}));

vi.mock("../multiplayer/battles/useHostContent", () => ({
  useHostContent: () => ({
    target: { engineVersion: "105.1.1" },
    games: [{ name: "Beyond All Reason test-1234" }],
    maps: [{ name: "Red Comet" }],
    scanning: false,
    noEngine: false,
    gameName: "Beyond All Reason test-1234",
    setGameName: () => {},
    mapName: "Red Comet",
    setMapName: () => {},
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

/** Fill the form the way a host does and hand back what Start was called with. */
async function startedWith(
  report: DirectReachability | null,
): Promise<StartRoomArgs> {
  answer.current = report;
  // Typed with the signature the form calls it with, so the arguments come back
  // as `StartRoomArgs` rather than out of an empty tuple that has to be cast.
  const onStart = vi.fn<(args: StartRoomArgs) => Promise<void>>(async () => {});
  // The form reads the drawer it lives in, for its Cancel button.
  render(
    <DrawerProvider>
      <HostRoomForm blocked={null} defaultName="alice" onStart={onStart} />
    </DrawerProvider>,
  );

  if (report) {
    fireEvent.click(screen.getByRole("checkbox", { name: /reachable/i }));
  }
  fireEvent.click(screen.getByRole("button", { name: /start/i }));

  // The assertion that Start ran at all, and the reason the read below is safe.
  // A form that stopped submitting fails here, naming that, rather than handing
  // back an undefined for a later line to trip over.
  await waitFor(() => expect(onStart).toHaveBeenCalled());
  const [args] = onStart.mock.calls[0];
  return args;
}

afterEach(cleanup);

describe("what the hosting form tells the room about its address", () => {
  it("hands over the address the internet sees, on a machine that holds it", async () => {
    const args = await startedWith(ON_PUBLIC_ADDRESS);
    expect(args.publicAddress).toBe("209.35.91.246");
  });

  it("hands over nothing when there is a router in front", async () => {
    const args = await startedWith(REFUSED);
    expect(args.publicAddress).toBeNull();
  });

  it("hands over nothing when the host never asked about the internet", async () => {
    const args = await startedWith(null);
    expect(args.publicAddress).toBeNull();
  });
});
