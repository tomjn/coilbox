import { describe, expect, it } from "vitest";
import { relayCarryingLabel } from "./relayCarrying";

describe("what the pill says a relay is carrying", () => {
  it("names the rate in units somebody can read at a glance", () => {
    expect(relayCarryingLabel(41984)).toBe("Relaying 41.0 KB/s");
    expect(relayCarryingLabel(600)).toBe("Relaying 600 B/s");
    expect(relayCarryingLabel(3_500_000)).toBe("Relaying 3.3 MB/s");
  });

  /**
   * The answer somebody is looking at the pill to find. Said in words rather
   * than as "0 B/s", because a number that happens to be zero is easy to read
   * past when the whole question is whether anything is moving.
   */
  it("says nothing is going through in words, not as a zero", () => {
    expect(relayCarryingLabel(0)).toBe("Relaying nothing");
  });

  /**
   * A figure that could only come from a malformed answer. It has to land on
   * the honest side, because "Relaying -1 B/s" on a topbar pill is worse than
   * saying nothing is going through.
   */
  it("treats a figure that is not a rate as nothing going through", () => {
    expect(relayCarryingLabel(-1)).toBe("Relaying nothing");
    expect(relayCarryingLabel(Number.NaN)).toBe("Relaying nothing");
  });

  /**
   * A relay coilbox can see but cannot get a figure out of. It must not read as
   * "Relaying nothing", because that says the relay is up and idle, and this
   * says coilbox has not been told either way.
   */
  it("says only that a relay is there when it has not said what it carries", () => {
    expect(relayCarryingLabel(null)).toBe("Relaying");
  });
});
