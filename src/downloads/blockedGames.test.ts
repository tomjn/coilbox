import { describe, expect, it } from "vitest";
import {
  BLOCKED_GAMES,
  isBlockedGame,
  withoutBlockedGames,
} from "./blockedGames";

const MT_FILE = "xta-9.729_mt.sdz";
const MT_MD5 = "3f52be87244d93719cf730a029060a8a";

describe("isBlockedGame (issue #4780)", () => {
  it("blocks XTA 9.729 MT by file name", () => {
    expect(isBlockedGame({ filename: MT_FILE })).toBe(true);
    expect(isBlockedGame({ filename: MT_FILE, md5: null })).toBe(true);
  });

  it("blocks it by file name in any case", () => {
    expect(isBlockedGame({ filename: "XTA-9.729_MT.sdz" })).toBe(true);
  });

  it("blocks the same bytes under another name, by MD5", () => {
    expect(isBlockedGame({ filename: "renamed.sdz", md5: MT_MD5 })).toBe(true);
    expect(
      isBlockedGame({ filename: "renamed.sdz", md5: MT_MD5.toUpperCase() }),
    ).toBe(true);
  });

  it("leaves the other XTA versions alone", () => {
    for (const filename of [
      "xta-9.728.sdz",
      "xta-9.727.sdz",
      "xta-9.725.sd7",
      "xta-9.652_beta_edited_by_noruas.sdz",
      "xta-sne-v10.00.sdz",
    ]) {
      expect(isBlockedGame({ filename }), filename).toBe(false);
    }
    expect(
      isBlockedGame({
        filename: "xta-9.728.sdz",
        md5: "f23a1440061db00881dacb66b69affa4",
      }),
    ).toBe(false);
  });

  it("does not treat an empty MD5 as a match", () => {
    expect(isBlockedGame({ filename: "xta-9.728.sdz", md5: "" })).toBe(false);
  });
});

describe("withoutBlockedGames", () => {
  it("drops the blocked entries and keeps the rest in order", () => {
    const keep = [{ filename: "a.sdz" }, { filename: "b.sdz" }];
    expect(
      withoutBlockedGames([keep[0], { filename: MT_FILE }, keep[1]]),
    ).toEqual(keep);
  });

  it("returns the same array when nothing is blocked", () => {
    const entries = [{ filename: "a.sdz" }];
    expect(withoutBlockedGames(entries)).toBe(entries);
  });
});

describe("BLOCKED_GAMES", () => {
  it("gives every entry a reason", () => {
    for (const b of BLOCKED_GAMES) expect(b.reason).not.toBe("");
  });
});
