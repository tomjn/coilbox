import { describe, expect, it } from "vitest";
import { emptyEngineListMessage } from "./emptyEngineList";

/**
 * Coilbox's and pr-downloader's own plumbing. A player reading an empty list
 * cannot act on any of it, and #968 is about telling them something they can.
 */
const PLUMBING = [
  /categor/i,
  /engine_/i,
  /arm64|aarch64|x86|amd64/i,
  /pr-downloader/i,
  /sidecar/i,
  /json/i,
  /fetch/i,
];

const EVERY_MESSAGE = [
  emptyEngineListMessage({
    source: "recoil",
    platform: "macos",
    listsThisPlatform: false,
  }),
  emptyEngineListMessage({
    source: "springfiles",
    platform: "macos",
    listsThisPlatform: false,
  }),
  emptyEngineListMessage({
    source: "springfiles",
    platform: "windows",
    listsThisPlatform: true,
  }),
];

describe("empty engine list", () => {
  it("never names coilbox's or pr-downloader's plumbing", () => {
    for (const message of EVERY_MESSAGE) {
      for (const pattern of PLUMBING) {
        expect(message).not.toMatch(pattern);
      }
    }
  });

  it("sends a player whose machine springfiles skips to the source that has one", () => {
    const said = emptyEngineListMessage({
      source: "springfiles",
      platform: "macos",
      listsThisPlatform: false,
    });

    expect(said).toContain("no engines for this kind of machine");
    expect(said).toContain("switch the source above to Recoil");
    // Nothing to wait for, so it must not suggest waiting.
    expect(said).not.toMatch(/try again|right now|in a moment/i);
  });

  it("offers a retry only where springfiles does publish engines", () => {
    const said = emptyEngineListMessage({
      source: "springfiles",
      platform: "windows",
      listsThisPlatform: true,
    });

    expect(said).toContain("Try again");
    expect(said).not.toContain("no engines for this kind of machine");
  });

  it("leaves the Recoil source saying what it always said", () => {
    expect(
      emptyEngineListMessage({
        source: "recoil",
        platform: "macos",
        listsThisPlatform: false,
      }),
    ).toBe(
      "No Recoil builds for this platform (macos). On macOS, add an engine manually.",
    );
  });
});
