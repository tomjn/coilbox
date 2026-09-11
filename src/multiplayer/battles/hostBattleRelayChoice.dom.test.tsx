// @vitest-environment happy-dom

/**
 * The relay choice and the router check in the "Host a battle" form (issue
 * #2023).
 *
 * `hostingRoute` is tested on its own and proves the ladder steps where it
 * should. What it cannot prove is that the choice is joined to it. Passing a
 * literal in place of the host's answer would leave every ladder test green and
 * ship a control that does nothing, which is the failure this file exists to
 * catch. So each test reads the battle that came out of the form, or the words
 * on screen, rather than the route the form worked out.
 *
 * The content scan and the port opener are stood in for. Neither is what is
 * being asked about, and the port opener's stand-in is how the router's answer
 * gets into the form, which is the only way to reach the rung the choice sits
 * on.
 */

import { DrawerProvider, PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectReachability } from "../../direct/reachability";
import { HostBattleForm, type OpenBattleArgs } from "./HostBattleForm";

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

// The router refused and STUN answered, which is what an ordinary home
// connection reports.
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

// The router opened the port, so nothing about this host needs a relay.
const OPENED: DirectReachability = {
  ...REFUSED,
  method: "upnp",
  ports: [{ port: 8452, externalPort: 8452, transport: "udp" }],
  routerAddress: "209.35.91.246",
  confirmedPort: 8452,
  problem: null,
};

// Stands in for the panel that asks the router. Buttons rather than a report on
// mount, so the answer arrives at a moment the test chooses. It also says
// whether the form asked for the check without a checkbox, and whether it asked
// for any ports at all.
vi.mock("../../direct/ReachablePorts", () => ({
  ReachablePorts: ({
    onReport,
    onCheckingChange,
    always,
    ports,
  }: {
    onReport?: (report: DirectReachability | null) => void;
    onCheckingChange?: (checking: boolean) => void;
    always?: boolean;
    ports: unknown[] | null;
  }) => (
    <>
      <button
        type="button"
        onClick={() => {
          onReport?.(null);
          onCheckingChange?.(true);
        }}
      >
        Pretend the router is still looking
      </button>
      <button
        type="button"
        onClick={() => {
          onReport?.(REFUSED);
          onCheckingChange?.(false);
        }}
      >
        Pretend the router refused
      </button>
      <button
        type="button"
        onClick={() => {
          onReport?.(OPENED);
          onCheckingChange?.(false);
        }}
      >
        Pretend the router opened the port
      </button>
      <span>{always ? "Checks the router" : "Asks before checking"}</span>
      <span>{ports === null ? "No ports asked for" : "Ports asked for"}</span>
    </>
  ),
}));

// Handing the port back is a call to the router, so it is counted here rather
// than made.
const closePorts = vi.hoisted(() => vi.fn(async () => ({ closed: true })));

vi.mock("../../direct/reachability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/reachability")>()),
  directClosePorts: closePorts,
}));

vi.mock("./useHostContent", () => ({
  useHostContent: () => ({
    target: { engineVersion: "105.1.1", enginePath: "/e", dataDir: "/d" },
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

/** Draw the form, and tell it the router refused. */
function form(relayAvailable = true) {
  const opened: OpenBattleArgs[] = [];
  render(
    <PersistentStoreProvider>
      <DrawerProvider>
        <HostBattleForm
          relayAvailable={relayAvailable}
          onHost={async (args) => {
            opened.push(args);
          }}
        />
      </DrawerProvider>
    </PersistentStoreProvider>,
  );
  fireEvent.click(screen.getByText("Pretend the router refused"));
  return opened;
}

type Mode = "Automatic" | "Always" | "Never";

/** One of the three relay choices, which Radix draws as radio buttons. */
const mode = (name: Mode) => screen.getByRole("radio", { name });

/** Radix says so with `aria-checked`, and there is no jest-dom here to read it. */
const isPicked = (name: Mode) =>
  mode(name).getAttribute("aria-checked") === "true";

const host = () =>
  fireEvent.click(screen.getByRole("button", { name: "Host battle" }));

afterEach(cleanup);

beforeEach(() => {
  // The preference is stored, so one test's answer would otherwise be the next
  // one's starting point.
  localStorage.clear();
  closePorts.mockClear();
});

describe("the relay choice in the hosting form", () => {
  // The default the issue asks for, and the reason for it: the hosts who reach
  // this rung are the ones least able to work out why hosting failed.
  it("relays by default when the router refused", async () => {
    const opened = form();
    expect(isPicked("Automatic")).toBe(true);
    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].relay).toBe(true);
  });

  // Turning it off has to reach the battle that is opened, not only the
  // sentence on screen.
  it("opens a battle that is not relayed once the host picks Never", async () => {
    const opened = form();
    fireEvent.click(mode("Never"));
    expect(isPicked("Never")).toBe(true);
    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].relay).toBe(false);
  });

  // The case the router check cannot help with. The router says players can
  // get in, and the host knows they cannot.
  it("relays a host the router would have let in once they pick Always", async () => {
    const opened = form();
    fireEvent.click(screen.getByText("Pretend the router opened the port"));
    fireEvent.click(mode("Always"));
    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].relay).toBe(true);
  });

  // A relayed battle has no use for a port on the router, so none is asked for.
  it("does not ask the router for a port when every battle is relayed", () => {
    form();
    expect(screen.getByText("Ports asked for")).toBeTruthy();
    fireEvent.click(mode("Always"));
    expect(screen.getByText("No ports asked for")).toBeTruthy();
  });

  // The cost, said once, where the choice is made.
  it("says what a relay costs next to the choice", () => {
    form();
    expect(
      screen.getByText(/puts an extra hop between you and every player/),
    ).toBeTruthy();
  });

  // The two ways to end up with no route need different words. A host who said
  // no themselves must not be sent looking for a fault in somebody's server.
  it("does not blame the server when the host picked Never", () => {
    form();
    fireEvent.click(mode("Never"));
    expect(screen.getByText(/you have asked not to be relayed/)).toBeTruthy();
    expect(screen.queryByText(/this server has no relay/)).toBeNull();
  });

  // Stored, so somebody who minds their ping says it once. Read back through a
  // fresh mount rather than off the storage key, so this still passes if the
  // key is renamed and still fails if the answer silently reverts.
  it("remembers the answer for the next battle", async () => {
    form();
    fireEvent.click(mode("Never"));
    cleanup();

    const opened = form();
    expect(isPicked("Never")).toBe(true);
    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].relay).toBe(false);
  });

  // A server with no relay has nothing to choose between, so there is no choice
  // to show, and the sentence under the form names the missing relay instead.
  it("offers no choice on a server that has none", () => {
    form(false);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/this server has no relay/)).toBeTruthy();
  });
});

/**
 * The router check beside it. Always on, because without it the ladder has
 * nothing to go on and the relay is never reached. The port it opens belongs to
 * the battle, so a form closed without one hands it back.
 */
describe("the router check in the hosting form", () => {
  it("checks the router without asking", () => {
    form();
    expect(screen.getByText("Checks the router")).toBeTruthy();
  });

  // Until the router answers there is nothing to pick a route with, so Host
  // waits rather than advertising an address nobody has tested.
  it("holds Host until the router has answered", () => {
    form();
    fireEvent.click(screen.getByText("Pretend the router is still looking"));
    const waiting = screen.getByRole("button", {
      name: "Checking your router…",
    });
    expect(waiting.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByText("Pretend the router refused"));
    const ready = screen.getByRole("button", { name: "Host battle" });
    expect(ready.hasAttribute("disabled")).toBe(false);
  });

  it("hands the port back when the form closes without a battle", () => {
    form();
    cleanup();
    expect(closePorts).toHaveBeenCalledTimes(1);
  });

  // Waits for the attempt to finish, not only for the battle to be sent, because
  // the form marks the battle as its own after `onHost` resolves.
  it("keeps the port for the battle it opened", async () => {
    const opened = form();
    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    await vi.waitFor(() => expect(screen.queryByText("Hosting…")).toBeNull());
    cleanup();
    expect(closePorts).not.toHaveBeenCalled();
  });
});
