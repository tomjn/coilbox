import { describe, expect, it } from "vitest";
import {
  type ReplayEngineReadings,
  replayEngineDecision,
  replayEngineRequirement,
} from "./replayEngine";

const RECORDED = "105.1.1-2511-gabc1234 BAR105";

const ready = {
  loading: false,
  canDownload: true,
  noWriteRoot: false,
};

function readings(
  over: Partial<ReplayEngineReadings> = {},
): ReplayEngineReadings {
  return {
    recorded: RECORDED,
    installedVersions: [],
    resolve: ready,
    ...over,
  };
}

describe("replayEngineRequirement", () => {
  it("is satisfied by an engine whose release and commit count match, ignoring the branch label", () => {
    const req = replayEngineRequirement(RECORDED);
    const has = (v: string) =>
      req.isInstalled({ games: [], maps: [], engineVersions: [v] });
    expect(has("105.1.1-2511-gdef5678 BAR")).toBe(true);
    expect(has("105.1.1-2512-gabc1234 BAR105")).toBe(false);
  });

  it("downloads by the version the replay recorded", () => {
    const req = replayEngineRequirement(`  ${RECORDED} `);
    expect(req.kind).toBe("engine");
    expect(req.label).toBe(RECORDED);
    expect(req.downloadKey).toBe(RECORDED);
  });
});

describe("replayEngineDecision", () => {
  it("watches on the recorded engine when it is installed", () => {
    const d = replayEngineDecision(
      readings({
        installedVersions: ["104.0.1-1828-g1234567", "105.1.1-2511-gdef5678"],
      }),
    );
    expect(d.notice).toEqual({ kind: "none" });
    expect(d.watch).toEqual({ kind: "recorded" });
  });

  it("offers the recorded engine when only a different one is installed", () => {
    const d = replayEngineDecision(
      readings({ installedVersions: ["104.0.1-1828-g1234567"] }),
    );
    expect(d.notice).toEqual({ kind: "download", version: RECORDED });
    expect(d.watch).toEqual({ kind: "download" });
  });

  it("offers the recorded engine when no engine is installed", () => {
    const d = replayEngineDecision(readings());
    expect(d.notice).toEqual({ kind: "download", version: RECORDED });
    expect(d.watch).toEqual({ kind: "download" });
  });

  it("names the engine and falls back to another when no download exists", () => {
    const d = replayEngineDecision(
      readings({
        installedVersions: ["104.0.1-1828-g1234567"],
        resolve: { ...ready, canDownload: false },
      }),
    );
    expect(d.notice).toEqual({
      kind: "unavailable",
      version: RECORDED,
      reason: "no-build",
    });
    expect(d.watch).toEqual({ kind: "fallback" });
  });

  it("disables Watch when no download exists and no engine is installed", () => {
    const d = replayEngineDecision(
      readings({ resolve: { ...ready, canDownload: false } }),
    );
    expect(d.notice).toEqual({
      kind: "unavailable",
      version: RECORDED,
      reason: "no-build",
    });
    expect(d.watch).toEqual({ kind: "none" });
  });

  it("blames the download folder when there is none to write to", () => {
    const d = replayEngineDecision(
      readings({
        resolve: { ...ready, canDownload: false, noWriteRoot: true },
      }),
    );
    expect(d.notice).toEqual({
      kind: "unavailable",
      version: RECORDED,
      reason: "no-write-root",
    });
  });

  it("says nothing and holds Watch while the catalogs are still loading", () => {
    const d = replayEngineDecision(
      readings({
        installedVersions: ["104.0.1-1828-g1234567"],
        resolve: { ...ready, loading: true, canDownload: false },
      }),
    );
    expect(d.notice).toEqual({ kind: "pending" });
    expect(d.watch).toEqual({ kind: "wait" });
  });

  it("does not wait on the catalogs when the recorded engine is installed", () => {
    const d = replayEngineDecision(
      readings({
        installedVersions: [RECORDED],
        resolve: { ...ready, loading: true },
      }),
    );
    expect(d.notice).toEqual({ kind: "none" });
    expect(d.watch).toEqual({ kind: "recorded" });
  });

  it("falls back to an installed engine when the header names no version", () => {
    const d = replayEngineDecision(
      readings({ recorded: "  ", installedVersions: ["105.1.1-2511-g1"] }),
    );
    expect(d.notice).toEqual({ kind: "none" });
    expect(d.watch).toEqual({ kind: "fallback" });
  });

  it("disables Watch when the header names no version and no engine is installed", () => {
    const d = replayEngineDecision(readings({ recorded: "" }));
    expect(d.notice).toEqual({ kind: "none" });
    expect(d.watch).toEqual({ kind: "none" });
  });
});
