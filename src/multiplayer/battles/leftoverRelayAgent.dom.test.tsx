// @vitest-environment happy-dom

/**
 * The way out of "a relay agent is already running as process 12345"
 * (issue #2062).
 *
 * `stopOutcomeMessage` is tested on its own below and proves the wording. What
 * it cannot prove is the two things that would actually cost somebody
 * something.
 *
 * That the panel is reachable at all. It appears only after a relayed attempt
 * failed, so a version that never called `mpLeftoverRelayAgent`, or called it
 * for every hosting failure, would leave every other test in this folder green.
 *
 * And that pressing the button reports what the relay agent did rather than
 * what coilbox hoped it would do. The agent is the only thing that knows
 * whether a game is being played through it, so an answer of "carrying" has to
 * reach the screen as its own sentence. A test that only checked the button
 * called something would pass while the host was told their leftover had gone
 * and then refused again.
 */

import { PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectReachability } from "../../direct/reachability";
import { HostBattlePopover } from "./HostBattlePopover";
import { type StopOutcome, stopOutcomeMessage } from "./LeftoverRelayAgent";

const leftoverRelayAgent = vi.fn();
const askLeftoverRelayToStop = vi.fn();

vi.mock("../bindings", () => ({
  mpLeftoverRelayAgent: (args: Record<string, never>) =>
    leftoverRelayAgent(args),
  mpAskLeftoverRelayToStop: (args: Record<string, never>) =>
    askLeftoverRelayToStop(args),
}));

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

// The router refused and STUN answered, which is the rung the relay sits on and
// so the only way to reach a relayed attempt.
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

/**
 * Draw the form on a connection whose router refused, so hosting goes to the
 * relay, and fail the attempt the way the backend does when a relay agent is
 * already running.
 */
function aRefusedRelayedAttempt(
  refusal = "a relay agent is already running as process 12345",
) {
  render(
    <PersistentStoreProvider>
      <HostBattlePopover
        disabled={false}
        relayAvailable
        autoOpen
        onHost={async () => {
          throw new Error(refusal);
        }}
      />
    </PersistentStoreProvider>,
  );
  fireEvent.click(screen.getByText("Pretend the router refused"));
  fireEvent.click(screen.getByRole("button", { name: "Host battle" }));
}

const askButton = () => screen.getByRole("button", { name: "Ask it to stop" });

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  leftoverRelayAgent.mockReset();
  askLeftoverRelayToStop.mockReset();
  leftoverRelayAgent.mockResolvedValue({ pid: 12345, ours: false });
});

describe("a relay agent left over from a previous session", () => {
  // The whole of the issue: the host is refused with a process id and is now
  // given somewhere to go with it.
  it("names the process and offers to ask it to stop", async () => {
    aRefusedRelayedAttempt();

    await vi.waitFor(() =>
      expect(
        screen.getByText(
          /A relay agent from an earlier session is still running as process 12345/,
        ),
      ).toBeTruthy(),
    );
    expect(askButton()).toBeTruthy();
  });

  // The leftover with nothing on it, which is the case the button is for.
  it("says it has stopped once the relay agent has", async () => {
    askLeftoverRelayToStop.mockResolvedValue({ outcome: "stopped" });
    aRefusedRelayedAttempt();
    await vi.waitFor(() => askButton());

    fireEvent.click(askButton());

    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        stopOutcomeMessage("stopped"),
      ),
    );
    expect(screen.queryByRole("button", { name: "Ask it to stop" })).toBeNull();
  });

  // The one that would cost a match if coilbox reported it wrong. The agent
  // refused, and the host has to be told that nobody was cut off rather than
  // told the leftover has gone and left to be refused all over again.
  it("says the relay kept going when a game is still being played through it", async () => {
    askLeftoverRelayToStop.mockResolvedValue({ outcome: "carrying" });
    aRefusedRelayedAttempt();
    await vi.waitFor(() => askButton());

    fireEvent.click(askButton());

    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        stopOutcomeMessage("carrying"),
      ),
    );
  });

  // Its own battle rather than a leftover, so there is nothing to ask and the
  // advice is the opposite one.
  it("offers no button for a relay this coilbox is hosting through", async () => {
    leftoverRelayAgent.mockResolvedValue({ pid: 12345, ours: true });
    aRefusedRelayedAttempt();

    await vi.waitFor(() =>
      expect(
        screen.getByText(
          /is carrying a battle this coilbox is hosting. Leave that battle before opening another one/,
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Ask it to stop" })).toBeNull();
    expect(askLeftoverRelayToStop).not.toHaveBeenCalled();
  });

  // Nothing is running, which is every hosting failure that is not this one.
  // The panel appearing then would send the host after a process that is not
  // there.
  it("says nothing when no relay agent is running", async () => {
    leftoverRelayAgent.mockResolvedValue({ pid: null, ours: false });
    aRefusedRelayedAttempt();

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "a relay agent is already running",
      ),
    );
    expect(screen.queryByRole("button", { name: "Ask it to stop" })).toBeNull();
  });

  // Only a relayed attempt consults the run file, so a battle that was never
  // going through the relay cannot have been stopped by a leftover agent and
  // must not be explained by one.
  it("does not look for one when the battle was not going through the relay", async () => {
    render(
      <PersistentStoreProvider>
        <HostBattlePopover
          disabled={false}
          relayAvailable
          autoOpen
          onHost={async () => {
            throw new Error("the lobby refused the battle");
          }}
        />
      </PersistentStoreProvider>,
    );
    // No router report, so the route is still the direct one.
    fireEvent.click(screen.getByRole("button", { name: "Host battle" }));

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "the lobby refused the battle",
      ),
    );
    expect(leftoverRelayAgent).not.toHaveBeenCalled();
  });
});

describe("what the host is told the relay agent did", () => {
  // Every outcome needs its own sentence. Two of them are opposites that look
  // identical from coilbox's side until the agent has answered, and the pair
  // that matters is `stopped` against `carrying`.
  const outcomes: StopOutcome[] = [
    "stopped",
    "carrying",
    "noAnswer",
    "ours",
    "gone",
  ];

  it("says something different for each", () => {
    const said = outcomes.map(stopOutcomeMessage);
    expect(new Set(said).size).toBe(outcomes.length);
  });

  // The sentence a host reads after pressing a button on a relay that turned
  // out to be carrying a match. It has to say nobody was cut off, because that
  // is the thing they would otherwise assume they had just done.
  it("says nobody was cut off by a relay that kept going", () => {
    expect(stopOutcomeMessage("carrying")).toContain("Nobody was cut off");
    expect(stopOutcomeMessage("carrying")).toContain("It kept running");
  });

  // A process id that belongs to something else now. Telling somebody to end
  // that process would have them ending whatever it turned out to be.
  it("never tells anybody to end a process by hand", () => {
    for (const outcome of outcomes) {
      expect(stopOutcomeMessage(outcome).toLowerCase()).not.toContain("kill");
    }
    expect(stopOutcomeMessage("noAnswer")).toContain("Restarting this machine");
  });

  // The claim this outcome used to make, and cannot. A note that nothing took
  // says only that nothing read it, and the agent reads notes only once its own
  // coilbox has closed. coilbox proves a recycled process number by the lock on
  // the run file instead, and a record that fails that test never reaches this
  // panel at all, so anything still landing here is a case coilbox cannot call
  // (issue #2078).
  it("does not claim the process has stopped being the relay agent", () => {
    expect(stopOutcomeMessage("noAnswer")).not.toContain(
      "no longer the relay agent",
    );
    expect(stopOutcomeMessage("noAnswer")).toContain("cannot rule out");
  });
});
