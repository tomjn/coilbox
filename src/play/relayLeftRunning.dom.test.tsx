// @vitest-environment happy-dom

/**
 * The topbar pill for a relay this coilbox did not start (issue #2074).
 *
 * Two things here would hurt somebody if they slipped, and everything else is
 * wording that `relayCarryingLabel` already covers.
 *
 * The pill must not appear when there is no relay, because almost every session
 * has none and a pill claiming a game nobody is playing is worse than no pill.
 * And it must never offer to end anything, because coilbox cannot end this game
 * and a button that did nothing would be read as one that had.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RelayLeftRunning from "./RelayLeftRunning";
import { ASK_EVERY_MS } from "./relayCarrying";

const leftRunning = vi.fn();

vi.mock("@/multiplayer/bindings", () => ({
  mpRelayLeftRunning: (args: Record<string, never>) => leftRunning(args),
}));

/** What the backend says about a relay left running, from here on. */
function found(relaying: boolean, bytesPerSecond: number | null = null) {
  leftRunning.mockResolvedValue({ relaying, bytesPerSecond });
}

/** Draw the pill and let the first answer land. */
async function drawPill() {
  await act(async () => {
    render(<RelayLeftRunning />);
  });
}

/** Everything the pill has on it, or nothing if there is no pill. */
function pillSays(): string | null | undefined {
  return screen.queryByTitle(/still being played through your machine/)
    ?.textContent;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  leftRunning.mockReset();
  found(false);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/**
 * The ordinary session, which is nearly all of them. Nothing is relaying, so
 * there is nothing to draw and nothing to keep asking about.
 */
it("draws nothing and stops asking when no relay was left running", async () => {
  await drawPill();
  await act(async () => {
    vi.advanceTimersByTime(ASK_EVERY_MS * 5);
  });

  expect(pillSays()).toBeUndefined();
  expect(leftRunning).toHaveBeenCalledTimes(1);
});

/** The whole point: a game is still going through this machine, and it says so. */
it("says how much a relay left running is carrying", async () => {
  found(true, 41984);
  await drawPill();

  expect(pillSays()).toBe("Relaying 41.0 KB/s");
});

/**
 * A relay that is up and quiet, which is the answer somebody opening coilbox
 * mid-game is looking for and the one a zero is easiest to read past.
 */
it("says when nothing is going through it", async () => {
  found(true, 0);
  await drawPill();

  expect(pillSays()).toBe("Relaying nothing");
});

/**
 * The sidecar is there and coilbox has no current figure from it, which is what
 * a sidecar from an older build looks like. The relay is still real and still
 * worth saying, and the number is left out rather than made up.
 */
it("says a relay is there without a figure it has not been given", async () => {
  found(true, null);
  await drawPill();

  expect(pillSays()).toBe("Relaying");
});

/** A figure that moves, because a figure that does not is not evidence. */
it("follows the relay rather than showing the first figure it heard", async () => {
  found(true, 41984);
  await drawPill();
  expect(pillSays()).toBe("Relaying 41.0 KB/s");

  found(true, 0);
  await act(async () => {
    vi.advanceTimersByTime(ASK_EVERY_MS);
  });

  expect(pillSays()).toBe("Relaying nothing");
});

/** The game ends, the sidecar goes, and the pill goes with it. */
it("goes away when the relay stops", async () => {
  found(true, 41984);
  await drawPill();
  expect(pillSays()).toBe("Relaying 41.0 KB/s");

  found(false);
  await act(async () => {
    vi.advanceTimersByTime(ASK_EVERY_MS);
  });

  expect(pillSays()).toBeUndefined();
});

/**
 * The requirement that is a negative, and the one this pill exists to get
 * right. Every other player in that game is connected through this machine and
 * coilbox has no handle on the engine, so there must be nothing here to press.
 */
it("offers nothing to press, because it cannot end a game it did not start", async () => {
  found(true, 41984);
  await drawPill();

  expect(screen.queryAllByRole("button")).toEqual([]);
});

/**
 * A command that failed is coilbox not knowing. Drawing a pill on that would be
 * claiming a relay on the strength of an error.
 */
it("draws nothing when the backend cannot answer", async () => {
  leftRunning.mockRejectedValue(new Error("no such command"));
  await drawPill();

  expect(pillSays()).toBeUndefined();
});
