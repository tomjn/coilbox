/**
 * Leaving a battle forgets the route it took (issue #2097).
 *
 * The recorded route is a module singleton with no battle in it, and nothing
 * used to clear it, so it sat there describing a battle this client had walked
 * out of until the next time somebody hosted. Every reader downstream then had
 * to work out for itself whether the battle it was describing was still the one
 * on screen, and the in-game pill did not.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { chosenHostingRoute, recordHostingRoute } from "@/direct/hostingRoute";
import { leaveBattle } from "./leaveBattle";

const { mpLeaveBattle } = vi.hoisted(() => ({
  mpLeaveBattle: vi.fn(async () => ({ sent: true })),
}));

vi.mock("../bindings", () => ({ mpLeaveBattle }));

beforeEach(() => {
  mpLeaveBattle.mockReset();
  mpLeaveBattle.mockResolvedValue({ sent: true });
  recordHostingRoute("relay");
});

describe("leaving a battle", () => {
  it("tells the connection it named, and forgets the route", async () => {
    await leaveBattle("alice@bar:8200");

    expect(mpLeaveBattle).toHaveBeenCalledWith({ serverKey: "alice@bar:8200" });
    expect(chosenHostingRoute()).toBe(null);
  });

  /**
   * A leave that did not happen leaves this client in its own relayed battle,
   * and the route is how the next launch knows the game it starts is going
   * through the relay. Dropping it here would take the warning off the X that
   * ends that game for everybody.
   */
  it("keeps the route when the leave never landed", async () => {
    mpLeaveBattle.mockRejectedValue(new Error("not connected"));

    await expect(leaveBattle("alice@bar:8200")).rejects.toThrow();

    expect(chosenHostingRoute()).toBe("relay");
  });
});
