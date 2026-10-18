import { describe, expect, it } from "vitest";
import {
  countUpdates,
  engineUpdate,
  rapidGameUpdate,
  releaseIsNew,
} from "./updates";

const none = new Set<string>();

describe("engineUpdate", () => {
  const installed = [{ version: "2025.04.08" }];

  it("offers an engine newer than any installed", () => {
    expect(
      engineUpdate({
        installed,
        recoil: [
          { version: "2025.06.01", prerelease: false },
          { version: "2025.04.08", prerelease: false },
        ],
        springfiles: [],
        pinned: none,
      }),
    ).toBe("2025.06.01");
  });

  it("reads springfiles as well as recoil", () => {
    expect(
      engineUpdate({
        installed,
        recoil: [],
        springfiles: [{ version: "2025.05.00" }],
        pinned: none,
      }),
    ).toBe("2025.05.00");
  });

  it("offers nothing when an installed engine is as new as the lists", () => {
    expect(
      engineUpdate({
        installed: [{ version: "2025.04.08" }, { version: "2025.06.01" }],
        recoil: [{ version: "2025.06.01", prerelease: false }],
        springfiles: [],
        pinned: none,
      }),
    ).toBeUndefined();
  });

  it("skips a prerelease", () => {
    expect(
      engineUpdate({
        installed,
        recoil: [{ version: "2025.07.00", prerelease: true }],
        springfiles: [],
        pinned: none,
      }),
    ).toBeUndefined();
  });

  it("offers nothing with no engine installed", () => {
    expect(
      engineUpdate({
        installed: [],
        recoil: [{ version: "2025.06.01", prerelease: false }],
        springfiles: [],
        pinned: none,
      }),
    ).toBeUndefined();
  });

  it("offers nothing when a game pins the newest installed engine", () => {
    expect(
      engineUpdate({
        installed,
        recoil: [{ version: "2025.06.01", prerelease: false }],
        springfiles: [],
        pinned: new Set(["2025.04.08"]),
      }),
    ).toBeUndefined();
  });
});

describe("rapidGameUpdate", () => {
  const record = (over: Record<string, unknown> = {}) => ({
    source: "rapid" as const,
    outcome: "ok" as const,
    reference: "ba:stable",
    filename: null,
    md5: null,
    mirror: null,
    failure: null,
    durationMs: 1,
    at: "2026-10-01T00:00:00.000Z",
    ...over,
  });

  it("flags a tag whose md5 is not in the pool", () => {
    expect(
      rapidGameUpdate([record()], {
        "ba:stable": { md5: "bbbb", installed: false },
      }),
    ).toEqual({ tag: "ba:stable", md5: "bbbb" });
  });

  it("flags nothing when the recorded md5 is the tag's md5", () => {
    expect(
      rapidGameUpdate([record({ md5: "bbbb" })], {
        "ba:stable": { md5: "bbbb", installed: false },
      }),
    ).toBeUndefined();
  });

  it("flags nothing when the tag has no md5", () => {
    expect(
      rapidGameUpdate([record()], {
        "ba:stable": { md5: "", installed: false },
      }),
    ).toBeUndefined();
  });
});

describe("releaseIsNew", () => {
  it("is new when none of the release's archives is installed", () => {
    expect(releaseIsNew(["G-2.sdz"], new Set(["g-1.sdz"]))).toBe(true);
  });

  it("is not new when one of its archives is installed", () => {
    expect(releaseIsNew(["G-2.sdz", "G-2b.sdz"], new Set(["g-2b.sdz"]))).toBe(
      false,
    );
  });

  it("is not new when the release has no archive", () => {
    expect(releaseIsNew([], none)).toBe(false);
  });
});

describe("countUpdates", () => {
  const game = (state: string) => ({ state }) as never;

  it("counts games in the update state and a newer engine", () => {
    expect(
      countUpdates({
        games: [game("update"), game("installed"), game("update")],
        engine: "2025.06.01",
      }),
    ).toBe(3);
  });

  it("does not count an engine a pin held back", () => {
    const held = engineUpdate({
      installed: [{ version: "2025.04.08" }],
      recoil: [{ version: "2025.06.01", prerelease: false }],
      springfiles: [],
      pinned: new Set(["2025.04.08"]),
    });
    expect(countUpdates({ games: [game("installed")], engine: held })).toBe(0);
  });
});
