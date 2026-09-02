/**
 * The truth table `releaseWheel` is for (issue #2317): a wheel over sky always
 * scrolls the page, and a wheel over the map only zooms once the view has been
 * clicked into.
 */

import { describe, expect, it } from "vitest";

import { releaseWheel } from "./wheelGate";

describe("releaseWheel", () => {
  it("releases a wheel over sky, armed or not", () => {
    expect(releaseWheel(false, false)).toBe(true);
    expect(releaseWheel(false, true)).toBe(true);
  });

  it("releases a wheel over the map that has not been clicked into", () => {
    expect(releaseWheel(true, false)).toBe(true);
  });

  it("keeps a wheel over the map once the view is armed, so it zooms", () => {
    expect(releaseWheel(true, true)).toBe(false);
  });
});
