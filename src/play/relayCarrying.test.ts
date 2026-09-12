import { describe, expect, it } from "vitest";
import { relayCarryingLabel } from "./relayCarrying";

describe("what the pill says a relay is carrying", () => {
  it("names the rate in units somebody can read at a glance", () => {
    expect(relayCarryingLabel(41984)).toBe("Relaying 41 KB/s");
    expect(relayCarryingLabel(600)).toBe("Relaying 600 B/s");
    expect(relayCarryingLabel(3_500_000)).toBe("Relaying 3.3 MB/s");
  });

  /**
   * The answer somebody is looking at the pill to find. Said in words rather
   * than as "0 B/s", because a number that happens to be zero is easy to read
   * past when the whole question is whether anything is moving.
   *
   * The relay is named as up in the same breath (issue #2809). A host reading
   * this before their game starts is reading the ordinary state, and a label
   * that only says nothing is going through reads as a relay that has failed.
   */
  it("says the relay is up and that nothing is going through it", () => {
    expect(relayCarryingLabel(0)).toBe("Relay running, no traffic");
  });

  /**
   * A figure that could only come from a malformed answer. It has to land on
   * the honest side, because "Relaying -1 B/s" on a topbar pill is worse than
   * saying nothing is going through.
   */
  it("treats a figure that is not a rate as nothing going through", () => {
    expect(relayCarryingLabel(-1)).toBe("Relay running, no traffic");
    expect(relayCarryingLabel(Number.NaN)).toBe("Relay running, no traffic");
  });

  /**
   * A relay coilbox can see but cannot get a figure out of. It must not claim
   * nothing is going through, because that is a reading coilbox has not been
   * given. Both labels say the relay is up, and only this one stops there.
   */
  it("says only that a relay is there when it has not said what it carries", () => {
    expect(relayCarryingLabel(null)).toBe("Relay running");
  });
});
