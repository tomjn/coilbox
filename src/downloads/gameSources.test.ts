import { describe, expect, it } from "vitest";
import { type GameSource, gameSourceOrder } from "./gameSources";

/** The index of a source in an order, or Infinity if absent, for comparisons. */
const at = (order: GameSource[], src: GameSource) => {
  const i = order.indexOf(src);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
};

describe("gameSourceOrder (issue #500)", () => {
  it("tries known mirrors before pr-downloader (rapid)", () => {
    const order = gameSourceOrder({ hasGithubRepo: true, hasWritePath: true });
    expect(at(order, "github")).toBeLessThan(at(order, "rapid"));
    expect(at(order, "springfiles")).toBeLessThan(at(order, "rapid"));
    expect(order).toEqual(["github", "springfiles", "rapid"]);
  });

  it("always keeps rapid as the final fallback", () => {
    for (const opts of [
      { hasGithubRepo: true, hasWritePath: true },
      { hasGithubRepo: false, hasWritePath: true },
      { hasGithubRepo: true, hasWritePath: false },
      { hasGithubRepo: false, hasWritePath: false },
    ]) {
      const order = gameSourceOrder(opts);
      expect(order[order.length - 1]).toBe("rapid");
    }
  });

  it("omits GitHub when no repo is declared for the game", () => {
    const order = gameSourceOrder({ hasGithubRepo: false, hasWritePath: true });
    expect(order).toEqual(["springfiles", "rapid"]);
  });

  it("drops the write-root sources with no write root, leaving only rapid", () => {
    expect(
      gameSourceOrder({ hasGithubRepo: true, hasWritePath: false }),
    ).toEqual(["rapid"]);
    expect(
      gameSourceOrder({ hasGithubRepo: false, hasWritePath: false }),
    ).toEqual(["rapid"]);
  });

  it("moves a pinned source to the front and keeps the rest in order (issue #4580)", () => {
    const all = { hasGithubRepo: true, hasWritePath: true };
    expect(gameSourceOrder({ ...all, pinned: "rapid" })).toEqual([
      "rapid",
      "github",
      "springfiles",
    ]);
    expect(gameSourceOrder({ ...all, pinned: "springfiles" })).toEqual([
      "springfiles",
      "github",
      "rapid",
    ]);
  });

  it("ignores a pinned source the game cannot use", () => {
    expect(
      gameSourceOrder({
        hasGithubRepo: false,
        hasWritePath: true,
        pinned: "github",
      }),
    ).toEqual(["springfiles", "rapid"]);
    expect(
      gameSourceOrder({
        hasGithubRepo: true,
        hasWritePath: true,
        pinned: "url",
      }),
    ).toEqual(["github", "springfiles", "rapid"]);
  });
});
