import { describe, expect, it } from "vitest";
import { type RunGameReadings, runGameNotice } from "./runContent";

const download = { label: "Beyond All Reason", downloadKey: "byar:test" };

const base: RunGameReadings = {
  hasTarget: true,
  targetLoading: false,
  scanned: true,
  scanErrors: [],
  gameInstalled: false,
  download,
};

describe("runGameNotice", () => {
  it("says nothing while the engines are being read", () => {
    expect(
      runGameNotice({ ...base, hasTarget: false, targetLoading: true }),
    ).toEqual({ kind: "none" });
  });

  it("offers an engine when there is none", () => {
    expect(runGameNotice({ ...base, hasTarget: false })).toEqual({
      kind: "no-engine",
    });
  });

  it("says nothing until the scan has answered", () => {
    expect(runGameNotice({ ...base, scanned: false })).toEqual({
      kind: "none",
    });
  });

  it("says nothing when the game is installed", () => {
    expect(runGameNotice({ ...base, gameInstalled: true })).toEqual({
      kind: "none",
    });
  });

  it("does not call the game missing when the scan could not read games", () => {
    expect(runGameNotice({ ...base, scanErrors: ["Init failed"] })).toEqual({
      kind: "unreadable",
      reason: null,
    });
  });

  // The scan hook answers `data: null` and an `error` when Init failed, so the
  // page passes the reason and counts the scan as answered (issue #3423).
  it("is unreadable, with the reason, when the scan itself failed", () => {
    expect(
      runGameNotice({ ...base, scanFailure: "no space left on device" }),
    ).toEqual({ kind: "unreadable", reason: "no space left on device" });
  });

  it("offers the download for a missing game that has one", () => {
    expect(runGameNotice(base)).toEqual({ kind: "download", download });
  });

  it("says a missing game cannot be downloaded when it has no download", () => {
    expect(runGameNotice({ ...base, download: null })).toEqual({
      kind: "unavailable",
    });
  });
});
