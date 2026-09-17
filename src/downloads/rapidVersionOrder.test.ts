import { describe, expect, it } from "vitest";
import type { Version } from "./bindings";
import { orderRapidVersions } from "./rapidVersionOrder";

const v = (tag: string, name = tag): Version => ({ tag, name });

describe("orderRapidVersions", () => {
  it("lifts named tags above the commit snapshots they are buried under", () => {
    const ordered = orderRapidVersions([
      v("byar:git:03b45b8", "Beyond All Reason test-11407-03b45b8"),
      v("byar:stable", "Beyond All Reason 2.35"),
      v("byar:git:aa11bb2", "Beyond All Reason test-11408-aa11bb2"),
      v("byar:test", "Beyond All Reason test-11408-aa11bb2"),
    ]);
    expect(ordered.map((x) => x.tag)).toEqual([
      "byar:stable",
      "byar:test",
      "byar:git:03b45b8",
      "byar:git:aa11bb2",
    ]);
  });

  // The long name of a named tag usually says "test-<n>-<sha>", so a sort that
  // read the name would push stable and test back down among the snapshots.
  it("reads the tag, not the long name", () => {
    const ordered = orderRapidVersions([
      v("ba:git:001edc3f", "Balanced Annihilation test-7183-001edc3"),
      v("ba:test", "Balanced Annihilation V15.9.8"),
    ]);
    expect(ordered[0].tag).toBe("ba:test");
  });

  it("keeps the repository's own order within each group", () => {
    const ordered = orderRapidVersions([
      v("r:zeta"),
      v("r:alpha"),
      v("r:git:b"),
      v("r:git:a"),
    ]);
    expect(ordered.map((x) => x.tag)).toEqual([
      "r:zeta",
      "r:alpha",
      "r:git:b",
      "r:git:a",
    ]);
  });

  it("leaves a repository of nothing but commits alone", () => {
    const only = [v("r:git:a"), v("r:git:b")];
    expect(orderRapidVersions(only)).toEqual(only);
  });
});
