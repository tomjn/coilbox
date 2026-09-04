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
import InGameBadge from "./InGameBadge";
import { ASK_EVERY_MS, RELAY_CARRYING_DETAIL } from "./relayCarrying";

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
let relayed = false;

vi.mock("./PlayProvider", () => ({
  usePlay: () => ({ running, relayed, focusGame, cancel }),
}));

const relayTraffic = vi.fn();

vi.mock("@/multiplayer/bindings", () => ({
  mpRelayTraffic: (args: Record<string, never>) => relayTraffic(args),
}));

/** What the backend says about the relay behind the game, from here on. */
function carrying(bytesPerSecond: number | null) {
  relayTraffic.mockResolvedValue({ relaying: true, bytesPerSecond });
}

/** No relay behind this game at all, which is the ordinary answer. */
function noRelay() {
  relayTraffic.mockResolvedValue({ relaying: false, bytesPerSecond: null });
}

/**
 * Draw the pill for a run that is or is not the one going through the relay,
 * and let the first poll land.
 *
 * Which run the relay is carrying is settled by the launch and reaches the pill
 * through `usePlay`, so it is stubbed here. That the launch sets it for the
 * right run, and for no other, is `inGameBadgeRelayedRun.dom.test.tsx` driving
 * the real provider (issue #2097).
 */
async function drawBadge(throughTheRelay: boolean) {
  relayed = throughTheRelay;
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

/**
 * The part of the pill that talks about the relay, or null when there is none.
 *
 * Read on its own because the stubbed popover puts its whole warning inside the
 * pill, so {@link pillSays} cannot be matched exactly once the X is the one that
 * asks first.
 */
function relaySays(): string | null {
  return screen.queryByTitle(RELAY_CARRYING_DETAIL)?.textContent ?? null;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  running = true;
  relayed = false;
  cancel.mockClear();
  focusGame.mockClear();
  relayTraffic.mockReset();
  noRelay();
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
    await drawBadge(false);

    expect(pillSays()).toBe("In game");
  });

  /** And it never asks, so an ordinary game pays nothing for this feature. */
  it("does not ask the backend anything, then or a second later", async () => {
    await drawBadge(false);
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
    await drawBadge(false);

    fireEvent.click(screen.getByRole("button", { name: "End game" }));

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("a relayed battle", () => {
  it("says the relay is carrying the game, and how much", async () => {
    carrying(41984);
    await drawBadge(true);

    expect(pillSays()).toContain("Relaying 41 KB/s");
  });

  /**
   * The difference the pill exists to show. A relay that is up and carrying
   * nothing is not the same as a relay coilbox cannot see, and it has to be
   * said in words rather than as a zero somebody reads past.
   */
  it("says when nothing is going through it", async () => {
    carrying(0);
    await drawBadge(true);

    expect(pillSays()).toContain("Relaying nothing");
  });

  /** A figure that moves, because a figure that does not is not evidence. */
  it("follows the relay rather than showing the first figure it heard", async () => {
    carrying(41984);
    await drawBadge(true);
    expect(pillSays()).toContain("Relaying 41 KB/s");

    carrying(0);
    await act(async () => {
      vi.advanceTimersByTime(ASK_EVERY_MS);
    });

    expect(pillSays()).toContain("Relaying nothing");
  });

  /**
   * A sidecar that has gone, after a battle whose route this client still
   * remembers. There is no relay to describe and nothing left to end for
   * anybody else, so the pill goes back to what an ordinary game draws rather
   * than repeating the last figure it heard.
   */
  it("draws nothing about the relay when the backend has nothing to say", async () => {
    noRelay();
    await drawBadge(true);

    expect(pillSays()).toBe("In game");
    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  /** Ending it is two presses, and the first one says what the second will do. */
  it("asks before ending the game, and says who else it ends it for", async () => {
    carrying(41984);
    await drawBadge(true);

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

/**
 * The whole of issue #2094, from the pill's side.
 *
 * The warning used to be drawn from the figure, so anything that took the
 * figure away took the warning with it and left the X ending everybody's game
 * on the first press. The backend now answers the two separately, and these are
 * the cases where they disagree.
 */
describe("a relay coilbox can see but cannot get a figure out of", () => {
  it("still asks before the X ends everybody's game", async () => {
    carrying(null);
    await drawBadge(true);

    fireEvent.click(screen.getByRole("button", { name: "End game" }));

    expect(cancel).not.toHaveBeenCalled();
    expect(
      screen.getByText(/ends it for everybody playing in it/),
    ).toBeTruthy();
  });

  /**
   * And it says the relay is there, rather than looking like an ordinary game
   * with an X that unexpectedly argues back. "Relaying nothing" would be a
   * different claim: that is a relay that is up and idle, and this is one that
   * has not said either way.
   */
  it("says a relay is there without inventing a rate for it", async () => {
    carrying(null);
    await drawBadge(true);

    expect(relaySays()).toBe("Relaying");
  });

  /**
   * A poll that never landed. The command cannot fail in Rust, so a rejection
   * is the IPC dropping a message, and one dropped message must not quietly
   * take the warning off a button that ends everybody's game.
   */
  it("keeps the warning when a poll fails outright", async () => {
    carrying(41984);
    await drawBadge(true);
    expect(relaySays()).toBe("Relaying 41 KB/s");

    relayTraffic.mockRejectedValue(new Error("the call never landed"));
    await act(async () => {
      vi.advanceTimersByTime(ASK_EVERY_MS);
    });

    expect(relaySays()).toBe("Relaying");
    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(cancel).not.toHaveBeenCalled();
  });
});

/** Nothing runs at all while no game is, which is most of the time. */
it("asks nothing while no game is running", async () => {
  running = false;
  await drawBadge(true);
  await act(async () => {
    vi.advanceTimersByTime(ASK_EVERY_MS * 5);
  });

  expect(relayTraffic).not.toHaveBeenCalled();
  expect(screen.queryByTitle("Return to the game")).toBeNull();
});
