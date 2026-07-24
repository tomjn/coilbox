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
    expect(order).toEqual(["springfiles", "hakora", "rapid"]);
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
