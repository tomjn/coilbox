// @vitest-environment happy-dom

/**
 * The relay preference in the "Host a battle" form (issue #2023).
 *
 * `hostingRoute` is tested on its own and proves the ladder steps where it
 * should. What it cannot prove is that the checkbox is joined to it. Passing a
 * literal in place of the host's answer would leave every ladder test green and
 * ship a control that does nothing, which is the failure this file exists to
 * catch. So each test reads the battle that came out of the form, or the words
 * on screen, rather than the route the form worked out.
 *
 * Radix's popover, the content scan and the port opener are all stood in for.
 * None of them is what is being asked about, and the port opener's stand-in is
 * how the router's refusal gets into the form, which is the only way to reach
 * the rung the preference sits on.
 */

import { PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectReachability } from "../../direct/reachability";
import { HostBattlePopover, type OpenBattleArgs } from "./HostBattlePopover";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/uberstress/pages/components/OptionSelect", () => ({
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

// Stands in for the panel that asks the router. A button rather than a report
// on mount, so the refusal arrives at a moment the test chooses.
vi.mock("../../direct/ReachablePorts", () => ({
  ReachablePorts: ({
    onReport,
  }: {
    onReport?: (report: DirectReachability | null) => void;
  }) => (
    <button type="button" onClick={() => onReport?.(REFUSED)}>
      Pretend the router refused
    </button>
  ),
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
      <HostBattlePopover
        disabled={false}
        relayAvailable={relayAvailable}
        autoOpen
        onHost={async (args) => {
          opened.push(args);
        }}
      />
    </PersistentStoreProvider>,
  );
  fireEvent.click(screen.getByText("Pretend the router refused"));
  return opened;
}

const checkbox = () =>
  screen.getByRole("checkbox", {
    name: /Use the server's relay when nothing else works/,
  });

/** Radix says so with `aria-checked`, and there is no jest-dom here to read it. */
const isTicked = () => checkbox().getAttribute("aria-checked") === "true";

const host = () =>
  fireEvent.click(screen.getByRole("button", { name: "Host battle" }));

afterEach(cleanup);

beforeEach(() => {
  // The preference is stored, so one test's answer would otherwise be the next
  // one's starting point.
  localStorage.clear();
});

describe("the relay preference in the hosting form", () => {
  // The default the issue asks for, and the reason for it: the hosts who reach
  // this rung are the ones least able to work out why hosting failed.
  it("relays by default", async () => {
    const opened = form();
    expect(isTicked()).toBe(true);
    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].relay).toBe(true);
  });

  // The acceptance criterion. Turning it off has to reach the battle that is
  // opened, not only the sentence on screen.
  it("opens a battle that is not relayed once the host turns it off", async () => {
    const opened = form();
    fireEvent.click(checkbox());
    expect(isTicked()).toBe(false);
    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].relay).toBe(false);
  });

  // The cost, said once, where the choice is made.
  it("says what a relay costs next to the checkbox", () => {
    form();
    expect(
      screen.getByText(/puts an extra hop between you and every player/),
    ).toBeTruthy();
  });

  // The two ways to end up with no route need different words. A host who said
  // no themselves must not be sent looking for a fault in somebody's server.
  it("does not blame the server when the host turned the relay off", () => {
    form();
    fireEvent.click(checkbox());
    expect(screen.getByText(/you have asked not to be relayed/)).toBeTruthy();
    expect(screen.queryByText(/this server has no relay/)).toBeNull();
  });

  // Stored, so somebody who minds their ping says it once. Read back through a
  // fresh mount rather than off the storage key, so this still passes if the
  // key is renamed and still fails if the answer silently reverts.
  it("remembers the answer for the next battle", async () => {
    form();
    fireEvent.click(checkbox());
    cleanup();

    const opened = form();
    expect(isTicked()).toBe(false);
    host();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].relay).toBe(false);
  });

  // A server with no relay had nothing to refuse, so the host's answer changed
  // nothing there and the sentence has to keep naming the server.
  it("keeps naming the missing relay on a server that has none", () => {
    form(false);
    fireEvent.click(checkbox());
    expect(screen.getByText(/this server has no relay/)).toBeTruthy();
  });
});
