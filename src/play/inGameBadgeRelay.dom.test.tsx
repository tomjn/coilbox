// @vitest-environment happy-dom

/**
 * The in-game pill for a game the host is relaying (issue #2024).
 *
 * `relayCarryingLabel` is tested on its own and proves the wording. What it
 * cannot prove is the part that would actually hurt somebody, and there are two
 * of them.
 *
 * Most games are not relayed, and the pill has looked the same for a year. So
 * the first test asserts the whole of what an ordinary game draws, character for
 * character, rather than looking for the absence of a few known strings. A test
 * written the second way stays green when a new one appears.
 *
 * And the X. Ending a relayed game ends it for everybody connected through this
 * machine, so the button that used to do it on the first press must not any
 * more, while the button on an ordinary game still must.
 *
 * Radix's popover is stood in for, as it is everywhere else in this repo that
 * tests a confirmation. That means its content is always in the document here,
 * so what these tests can ask is which button calls what, not whether Radix
 * opens.
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
import { type HostingRoute, recordHostingRoute } from "../direct/hostingRoute";
import InGameBadge from "./InGameBadge";
import { ASK_EVERY_MS } from "./relayCarrying";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const cancel = vi.fn();
const focusGame = vi.fn();
let running = true;

vi.mock("./PlayProvider", () => ({
  usePlay: () => ({ running, focusGame, cancel }),
}));

const relayTraffic = vi.fn();

vi.mock("@/multiplayer/bindings", () => ({
  mpRelayTraffic: (args: Record<string, never>) => relayTraffic(args),
}));

/** What the backend says the relay is carrying, from here on. */
function carrying(bytesPerSecond: number | null) {
  relayTraffic.mockResolvedValue({ bytesPerSecond });
}

/**
 * Draw the pill for a game hosted over `route`, and let the first poll land.
 *
 * The route goes in through `recordHostingRoute`, which is where the hosting
 * forms put it, so what is under test is the join between the two rather than a
 * prop a test chose.
 */
async function drawBadge(route: HostingRoute) {
  recordHostingRoute(route);
  await act(async () => {
    render(<InGameBadge />);
  });
}

/** Everything the pill has on it, as one string. */
function pillSays(): string {
  return (
    screen.getByTitle("Return to the game").closest("div")?.textContent ?? ""
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  running = true;
  cancel.mockClear();
  focusGame.mockClear();
  relayTraffic.mockReset();
  carrying(null);
  recordHostingRoute(null);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("an ordinary battle", () => {
  /**
   * The acceptance criterion that governs every other one. Most games are not
   * relayed and there is nothing to say about them, so the pill has to be
   * exactly what it was.
   */
  it("draws the pill it has always drawn and nothing else", async () => {
    // A rate the backend would hand over if it were ever asked, so a pill that
    // drew it would say so loudly rather than passing on a null.
    carrying(41984);
    await drawBadge("portMapped");

    expect(pillSays()).toBe("In game");
  });

  /** And it never asks, so an ordinary game pays nothing for this feature. */
  it("does not ask the backend anything, then or a second later", async () => {
    await drawBadge("portMapped");
    await act(async () => {
      vi.advanceTimersByTime(ASK_EVERY_MS * 5);
    });

    expect(relayTraffic).not.toHaveBeenCalled();
  });

  /**
   * Its X still ends the game on the first press, as it always has.
   *
   * With a rate waiting to be handed over, so that a pill which asked when it
   * should not have is caught here too rather than only by the tests above.
   */
  it("ends the game from the X without asking", async () => {
    carrying(41984);
    await drawBadge("portMapped");

    fireEvent.click(screen.getByRole("button", { name: "End game" }));

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("a relayed battle", () => {
  it("says the relay is carrying the game, and how much", async () => {
    carrying(41984);
    await drawBadge("relay");

    expect(pillSays()).toContain("Relaying 41.0 KB/s");
  });

  /**
   * The difference the pill exists to show. A relay that is up and carrying
   * nothing is not the same as a relay coilbox cannot see, and it has to be
   * said in words rather than as a zero somebody reads past.
   */
  it("says when nothing is going through it", async () => {
    carrying(0);
    await drawBadge("relay");

    expect(pillSays()).toContain("Relaying nothing");
  });

  /** A figure that moves, because a figure that does not is not evidence. */
  it("follows the relay rather than showing the first figure it heard", async () => {
    carrying(41984);
    await drawBadge("relay");
    expect(pillSays()).toContain("Relaying 41.0 KB/s");

    carrying(0);
    await act(async () => {
      vi.advanceTimersByTime(ASK_EVERY_MS);
    });

    expect(pillSays()).toContain("Relaying nothing");
  });

  /**
   * A reopened coilbox, and a sidecar that has died. Neither leaves anything
   * coilbox can honestly say, so the pill goes back to what an ordinary game
   * draws rather than repeating the last figure it heard.
   */
  it("draws nothing about the relay when the backend has nothing to say", async () => {
    carrying(null);
    await drawBadge("relay");

    expect(pillSays()).toBe("In game");
  });

  /** Ending it is two presses, and the first one says what the second will do. */
  it("asks before ending the game, and says who else it ends it for", async () => {
    carrying(41984);
    await drawBadge("relay");

    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(cancel).not.toHaveBeenCalled();

    expect(
      screen.getByText(/ends it for everybody playing in it/),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "End it for everybody" }),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

/** Nothing runs at all while no game is, which is most of the time. */
it("asks nothing while no game is running", async () => {
  running = false;
  await drawBadge("relay");
  await act(async () => {
    vi.advanceTimersByTime(ASK_EVERY_MS * 5);
  });

  expect(relayTraffic).not.toHaveBeenCalled();
  expect(screen.queryByTitle("Return to the game")).toBeNull();
});
