// @vitest-environment happy-dom

/**
 * The top bar pill for the relay on this machine.
 *
 * Two relays can be behind it and they need opposite things, so most of this
 * is about telling them apart. Our own battle's relay offers the way back and a
 * Close that asks first. A relay an earlier coilbox left running offers only to
 * ask it to stop, which it refuses while it carries a game.
 *
 * The popover is stood in for so its contents are always drawn, and the
 * bindings, the store, the router and the leave helper so nothing leaves the
 * test.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordHostingRoute } from "@/direct/hostingRoute";
import { ASK_EVERY_MS } from "@/play/relayCarrying";
import RelayIndicator from "./RelayIndicator";

const traffic = vi.fn();
const leftRunning = vi.fn();
const leftover = vi.fn();
const leave = vi.fn();
const navigate = vi.fn();
const play = { running: false, relayed: false };

vi.mock("./bindings", () => ({
  mpRelayTraffic: (args: Record<string, never>) => traffic(args),
  mpRelayLeftRunning: (args: Record<string, never>) => leftRunning(args),
  mpLeftoverRelayAgent: (args: Record<string, never>) => leftover(args),
  mpAskLeftoverRelayToStop: vi.fn(),
}));

vi.mock("@/play/PlayProvider", () => ({ usePlay: () => play }));

vi.mock("./store", () => ({
  useMultiplayer: () => ({ activeKey: "alice@bar:8200" }),
}));

vi.mock("./battle/leaveBattle", () => ({
  leaveBattle: (serverKey: string) => leave(serverKey),
}));

vi.mock("@/notify/notify", () => ({ notify: vi.fn() }));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => navigate,
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

/** Draw the pill and let the first answers land. */
async function draw() {
  await act(async () => {
    render(<RelayIndicator />);
  });
}

/** The pill itself, or null when there is none. */
const pill = () => screen.queryByRole("button", { name: /Relay/ });

/** Let a second pass, and whatever it asks be answered. */
async function aSecondLater() {
  await act(async () => {
    vi.advanceTimersByTime(ASK_EVERY_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  traffic.mockReset();
  leftRunning.mockReset();
  leftover.mockReset();
  leave.mockReset();
  navigate.mockReset();
  traffic.mockResolvedValue({ relaying: false, bytesPerSecond: null });
  leftRunning.mockResolvedValue({ relaying: false, bytesPerSecond: null });
  leftover.mockResolvedValue({ pid: null, ours: false });
  leave.mockResolvedValue({});
  play.running = false;
  play.relayed = false;
  recordHostingRoute(null);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  recordHostingRoute(null);
});

/** Nearly every session. There is nothing to draw and nothing to keep asking. */
it("draws nothing and asks nothing more when there is no relay", async () => {
  await draw();
  await act(async () => {
    vi.advanceTimersByTime(ASK_EVERY_MS * 5);
  });

  expect(pill()).toBeNull();
  expect(traffic).not.toHaveBeenCalled();
  expect(leftRunning).toHaveBeenCalledTimes(1);
});

describe("our own relayed battle", () => {
  beforeEach(() => {
    recordHostingRoute("relay");
    traffic.mockResolvedValue({ relaying: true, bytesPerSecond: 0 });
  });

  // A battle waiting for players carries nothing, and that is not a fault.
  it("is named for what it is until traffic flows", async () => {
    await draw();
    expect(pill()?.textContent).toBe("Relayed battle");

    traffic.mockResolvedValue({ relaying: true, bytesPerSecond: 41984 });
    await aSecondLater();
    expect(pill()?.textContent).toBe("Relaying 41 KB/s");
  });

  it("takes the host back to the battle", async () => {
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Go to battle" }));
    expect(navigate).toHaveBeenCalledWith("/battle");
  });

  // Everybody in the battle is removed, so it asks, and only closes on the
  // second press.
  it("asks before closing the battle, then closes it", async () => {
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText(/Close this battle\?/)).toBeTruthy();
    expect(leave).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close battle" }));
    });
    expect(leave).toHaveBeenCalledWith("alice@bar:8200");
    expect(navigate).toHaveBeenCalledWith("/battles");
  });

  // The in-game badge already says what the relay carries during a game, and
  // owns the warning on ending it.
  it("stands aside while the relayed game is running", async () => {
    play.running = true;
    play.relayed = true;
    await draw();
    expect(pill()).toBeNull();
  });

  it("goes when the relay does", async () => {
    await draw();
    expect(pill()).not.toBeNull();

    traffic.mockResolvedValue({ relaying: false, bytesPerSecond: null });
    await aSecondLater();
    expect(pill()).toBeNull();
  });
});

describe("a relay an earlier coilbox left running", () => {
  // The one thing coilbox can safely do about it. The agent refuses while it
  // carries a game, so asking cannot end somebody's match.
  it("offers to ask it to stop", async () => {
    leftRunning.mockResolvedValue({ relaying: true, bytesPerSecond: 0 });
    leftover.mockResolvedValue({ pid: 4242, ours: false });
    await draw();

    expect(pill()?.textContent).toBe("Relaying nothing");
    expect(screen.getByRole("button", { name: "Ask it to stop" })).toBeTruthy();
  });

  // A command that failed is coilbox not knowing, and a pill on the strength
  // of an error would claim a relay.
  it("draws nothing when the backend cannot answer", async () => {
    leftRunning.mockRejectedValue(new Error("no such command"));
    await draw();
    expect(pill()).toBeNull();
  });
});
