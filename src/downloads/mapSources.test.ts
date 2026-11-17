import { describe, expect, it } from "vitest";
import { type MapSource, mapSourceOrder } from "./mapSources";

/** The index of a source in an order, or Infinity if absent, for comparisons. */
const at = (order: MapSource[], src: MapSource) => {
  const i = order.indexOf(src);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
};

describe("mapSourceOrder (issue #511)", () => {
  it("tries known mirrors before pr-downloader (rapid)", () => {
    const order = mapSourceOrder({ hasWritePath: true });
    expect(at(order, "springfiles")).toBeLessThan(at(order, "rapid"));
    expect(at(order, "hakora")).toBeLessThan(at(order, "rapid"));
    expect(at(order, "evolutionrts")).toBeLessThan(at(order, "rapid"));
    expect(order).toEqual(["evolutionrts", "springfiles", "hakora", "rapid"]);
  });

  it("always keeps rapid as the final fallback", () => {
    for (const opts of [{ hasWritePath: true }, { hasWritePath: false }]) {
      const order = mapSourceOrder(opts);
      expect(order[order.length - 1]).toBe("rapid");
    }
  });

  it("drops the write-root sources with no write root, leaving only rapid", () => {
    expect(mapSourceOrder({ hasWritePath: false })).toEqual(["rapid"]);
  });
});

describe("mapSourceOrder, the hub's sources (issue #5251)", () => {
  it("puts the hub first, ahead of every known mirror", () => {
    expect(mapSourceOrder({ hasWritePath: true, hasHubSources: true })).toEqual(
      ["hub", "evolutionrts", "springfiles", "hakora", "rapid"],
    );
  });

  it("leaves the order as it was for a map the hub lists no sources for", () => {
    expect(
      mapSourceOrder({ hasWritePath: true, hasHubSources: false }),
    ).toEqual(mapSourceOrder({ hasWritePath: true }));
  });

  it("has no hub step without a write root", () => {
    expect(
      mapSourceOrder({ hasWritePath: false, hasHubSources: true }),
    ).toEqual(["rapid"]);
  });
});
