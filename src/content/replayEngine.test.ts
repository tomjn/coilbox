import { describe, expect, it } from "vitest";
import type { InstalledEngine } from "../play/engineConfirmation";
import {
  type ReplayEngineReadings,
  replayDependencyBlock,
  replayEngineDecision,
  replayEngineRequirement,
} from "./replayEngine";

const RECORDED = "105.1.1-2511-gabc1234 BAR105";

const ready = {
  loading: false,
  canDownload: true,
  noWriteRoot: false,
};

/** An engine the binary has reported a version for. The folder is named after
 *  the version unless a test says otherwise. */
const verified = (
  version: string,
  folder = version,
  executable = `/engines/${folder}/spring`,
): InstalledEngine => ({ executable, folder, verified: version });

/** An engine that has not reported yet, so only its folder name is known. */
const unverified = (
  folder: string,
  executable = `/engines/${folder}/spring`,
): InstalledEngine => ({ executable, folder });

function readings(
  over: Partial<ReplayEngineReadings> = {},
): ReplayEngineReadings {
  return {
    recorded: RECORDED,
    engines: [],
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
        engines: [
          verified("104.0.1-1828-g1234567"),
          verified("105.1.1-2511-gdef5678"),
        ],
      }),
    );
    expect(d.notice).toEqual({ kind: "none" });
    expect(d.watch).toEqual({ kind: "recorded" });
  });

  it("offers the recorded engine when only a different one is installed", () => {
    const d = replayEngineDecision(
      readings({ engines: [verified("104.0.1-1828-g1234567")] }),
    );
    expect(d.notice).toEqual({ kind: "download", version: RECORDED });
    expect(d.watch).toEqual({ kind: "download" });
  });

  it("offers the recorded engine when no engine is installed", () => {
    const d = replayEngineDecision(readings());
    expect(d.notice).toEqual({ kind: "download", version: RECORDED });
    expect(d.watch).toEqual({ kind: "download" });
  });

  it("names the engine and disables Watch when no download exists, even with another engine installed", () => {
    const d = replayEngineDecision(
      readings({
        engines: [verified("104.0.1-1828-g1234567")],
        resolve: { ...ready, canDownload: false },
      }),
    );
    expect(d.notice).toEqual({
      kind: "unavailable",
      version: RECORDED,
      reason: "no-build",
    });
    expect(d.watch).toEqual({ kind: "unavailable", version: RECORDED });
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
    expect(d.watch).toEqual({ kind: "unavailable", version: RECORDED });
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
        engines: [verified("104.0.1-1828-g1234567")],
        resolve: { ...ready, loading: true, canDownload: false },
      }),
    );
    expect(d.notice).toEqual({ kind: "pending" });
    expect(d.watch).toEqual({ kind: "wait" });
  });

  it("does not wait on the catalogs when the recorded engine is installed", () => {
    const d = replayEngineDecision(
      readings({
        engines: [verified(RECORDED)],
        resolve: { ...ready, loading: true },
      }),
    );
    expect(d.notice).toEqual({ kind: "none" });
    expect(d.watch).toEqual({ kind: "recorded" });
  });

  it("falls back to an installed engine when the header names no version", () => {
    const d = replayEngineDecision(
      readings({ recorded: "  ", engines: [verified("105.1.1-2511-g1")] }),
    );
    expect(d.notice).toEqual({ kind: "none" });
    expect(d.watch).toEqual({ kind: "fallback" });
  });

  it("disables Watch when the header names no version and no engine is installed", () => {
    const d = replayEngineDecision(readings({ recorded: "" }));
    expect(d.notice).toEqual({ kind: "none" });
    expect(d.watch).toEqual({ kind: "none" });
  });

  describe("an engine that has not reported its version", () => {
    const folder = "105.1.1-2511-gdef5678";

    it("asks to check it, and enables Watch, when its folder is named for the recorded version", () => {
      const d = replayEngineDecision(
        readings({ engines: [unverified(folder)] }),
      );
      expect(d.notice).toEqual({ kind: "unchecked", version: RECORDED });
      expect(d.watch).toEqual({ kind: "verify" });
    });

    it("does not offer a download while a folder may already hold the engine, even with no download found", () => {
      const d = replayEngineDecision(
        readings({
          engines: [unverified(folder)],
          resolve: { ...ready, canDownload: false },
        }),
      );
      expect(d.notice.kind).toBe("unchecked");
      expect(d.watch.kind).toBe("verify");
    });

    it("does not wait on the catalogs for a folder it can ask about", () => {
      const d = replayEngineDecision(
        readings({
          engines: [unverified(folder)],
          resolve: { ...ready, loading: true, canDownload: false },
        }),
      );
      expect(d.notice.kind).toBe("unchecked");
      expect(d.watch.kind).toBe("verify");
    });

    it("offers the download when no unverified folder is named for it", () => {
      const d = replayEngineDecision(
        readings({ engines: [unverified("104.0.1-1828-g1234567")] }),
      );
      expect(d.notice).toEqual({ kind: "download", version: RECORDED });
      expect(d.watch).toEqual({ kind: "download" });
    });

    it("prefers a verified match over an unverified folder of the same name", () => {
      const d = replayEngineDecision(
        readings({
          engines: [unverified(folder), verified(RECORDED, "other")],
        }),
      );
      expect(d.notice).toEqual({ kind: "none" });
      expect(d.watch).toEqual({ kind: "recorded" });
    });
  });

  describe("a verified engine whose version differs from its folder name", () => {
    it("does not count as the recorded engine when only its folder is named for it", () => {
      const d = replayEngineDecision(
        readings({
          engines: [verified("104.0.1-1828-g1234567", RECORDED)],
        }),
      );
      expect(d.notice).toEqual({ kind: "download", version: RECORDED });
      expect(d.watch).toEqual({ kind: "download" });
    });

    it("counts as the recorded engine when it reports the version under another folder name", () => {
      const d = replayEngineDecision(
        readings({
          engines: [verified(RECORDED, "my-engine")],
        }),
      );
      expect(d.notice).toEqual({ kind: "none" });
      expect(d.watch).toEqual({ kind: "recorded" });
    });
  });

  it("falls back on an engine that has not reported when the header names no version", () => {
    const d = replayEngineDecision(
      readings({ recorded: "", engines: [unverified("105.1.1-2511-g1")] }),
    );
    expect(d.notice).toEqual({ kind: "none" });
    expect(d.watch).toEqual({ kind: "fallback" });
  });
});

describe("replayDependencyBlock", () => {
  const games = [
    {
      name: "SplinterFaction 0.1.86",
      missingDependencies: ["springcontent.sdz"],
    },
    { name: "Zero-K v1.14.8.0", missingDependencies: [] },
  ];

  it("names the archive a replay's game depends on and lacks", () => {
    expect(replayDependencyBlock("SplinterFaction 0.1.86", games)).toBe(
      "Archive not installed: springcontent.sdz. SplinterFaction 0.1.86 depends on it.",
    );
  });

  it("matches the game the way the replay page does", () => {
    expect(replayDependencyBlock("splinterfaction 0.1.86", games)).toBe(
      "Archive not installed: springcontent.sdz. SplinterFaction 0.1.86 depends on it.",
    );
  });

  it("says nothing for a game with everything installed", () => {
    expect(replayDependencyBlock("Zero-K v1.14.8.0", games)).toBeNull();
  });

  it("says nothing for a game that is not installed, which the page reports itself", () => {
    expect(replayDependencyBlock("Balanced Annihilation V9", games)).toBeNull();
  });
});
