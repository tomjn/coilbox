import { describe, expect, it } from "vitest";
import { gameForIdentity } from "./useGameUnits";

const game = (name: string, shortname: string, version: string) => ({
  name,
  info: { shortname, version },
});

const INSTALLED = [
  game("SplinterFaction 0.1.80", "SF", "0.1.80"),
  game("SplinterFaction 0.1.84", "SF", "0.1.84"),
  game("SplinterFaction 0.1.9", "SF", "0.1.9"),
  game("Balanced Annihilation V15.9.8", "BA", "V15.9.8"),
];

describe("gameForIdentity", () => {
  it("takes the build the layout names when it is installed", () => {
    expect(
      gameForIdentity(INSTALLED, "SplinterFaction 0.1.80", "SF")?.name,
    ).toBe("SplinterFaction 0.1.80");
  });

  it("takes the newest build of the same game when that one has gone", () => {
    expect(
      gameForIdentity(INSTALLED, "SplinterFaction 0.1.77", "SF")?.name,
    ).toBe("SplinterFaction 0.1.84");
  });

  it("compares versions by segment, so 0.1.84 beats 0.1.9", () => {
    expect(
      gameForIdentity(INSTALLED, "SplinterFaction 0.1.77", "SF")?.name,
    ).not.toBe("SplinterFaction 0.1.9");
  });

  it("matches a shortname whatever case it was written in", () => {
    expect(
      gameForIdentity(INSTALLED, "SplinterFaction 0.1.77", "sf")?.name,
    ).toBe("SplinterFaction 0.1.84");
  });

  it("finds nothing for a game this machine has not got at all", () => {
    expect(gameForIdentity(INSTALLED, "Zero-K 1.2", "ZK")).toBeUndefined();
  });

  it("finds nothing without a shortname to fall back on", () => {
    expect(
      gameForIdentity(INSTALLED, "SplinterFaction 0.1.77"),
    ).toBeUndefined();
  });

  it("does not let an empty shortname match a game that has none", () => {
    const nameless = [{ name: "Nameless 1", info: {} }];
    expect(gameForIdentity(nameless, "Something else", "")).toBeUndefined();
  });
});
