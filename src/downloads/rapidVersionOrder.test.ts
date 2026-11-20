import { describe, expect, it } from "vitest";
import type { Version } from "./bindings";
import { orderRapidVersions } from "./rapidVersionOrder";

const v = (tag: string, name = tag): Version => ({
  tag,
  md5: "",
  name,
  depends: [],
  kind: tag.includes(":git:") ? "snapshot" : "release",
  installed: false,
});

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
      "byar:git:aa11bb2",
      "byar:git:03b45b8",
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

  it("puts stable and test above the other named tags", () => {
    const ordered = orderRapidVersions([
      v("byar:br-master", "Beyond All Reason br-master-30834-747fc47"),
      v("byar:pr-8942", "Beyond All Reason pr-8942-30929-09be885"),
      v("byar:stable", "Beyond All Reason 0.01"),
      v("byar:test", "Beyond All Reason test-31677-a31a826"),
    ]);
    expect(ordered.map((x) => x.tag)).toEqual([
      "byar:stable",
      "byar:test",
      "byar:pr-8942",
      "byar:br-master",
    ]);
  });

  it("lists commit snapshots newest first by the revision in their name", () => {
    const ordered = orderRapidVersions([
      v("byar:git:0001755", "Beyond All Reason test-14369-0001755"),
      v("byar:git:000de54", "Beyond All Reason test-19107-000de54"),
      v("byar:git:000f78f", "Beyond All Reason test-16875-000f78f"),
    ]);
    expect(ordered.map((x) => x.tag)).toEqual([
      "byar:git:000de54",
      "byar:git:000f78f",
      "byar:git:0001755",
    ]);
  });

  // Some older builds were named after the full hash with no revision count,
  // so there is nothing to date them by.
  it("puts snapshots with no revision last, in the repository's order", () => {
    const sha = "048b9cfa309d4d65a381513751fd89e0b5b269d9";
    const ordered = orderRapidVersions([
      v(`swiw:git:${sha}`, `Imperial Winter test-${sha}`),
      v("swiw:git:0762b52", "Imperial Winter test-89-0762b52"),
      v("swiw:git:8cb1126", "Imperial Winter 0.01"),
      v("swiw:git:e92228b", "Imperial Winter test-92-e92228b"),
    ]);
    expect(ordered.map((x) => x.tag)).toEqual([
      "swiw:git:e92228b",
      "swiw:git:0762b52",
      `swiw:git:${sha}`,
      "swiw:git:8cb1126",
    ]);
  });

  it("leaves a repository of nothing but commits alone", () => {
    const only = [v("r:git:a"), v("r:git:b")];
    expect(orderRapidVersions(only)).toEqual(only);
  });
});
