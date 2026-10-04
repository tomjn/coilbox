import { describe, expect, it } from "vitest";
import type { InstalledContentSnapshot } from "@/content/resolveContent";
import type { PlayTarget } from "./config";
import {
  launchRequirements,
  launchTargets,
  missingLaunchContent,
} from "./launchContent";

const installed = (
  over: Partial<InstalledContentSnapshot> = {},
): InstalledContentSnapshot => ({
  games: [{ name: "Beyond All Reason test-1" }],
  maps: ["Comet Catcher Redux"],
  engineVersions: ["2025.04.01"],
  ...over,
});

/** An engine that reported `engineVersion`, unless `verified` is false, when
 *  `engineVersion` is only its folder's name. */
const target = (engineVersion: string, verified = true): PlayTarget => ({
  enginePath: `/content/engine/${engineVersion}`,
  executable: `/content/engine/${engineVersion}/spring`,
  dataDir: "/content",
  engineVersion,
  ...(verified ? { syncVersion: engineVersion } : {}),
});

describe("launchRequirements", () => {
  it("names the engine, game and map a launch asks for", () => {
    const reqs = launchRequirements({
      engineVersion: "2025.04.01",
      game: "Beyond All Reason test-1",
      map: "Comet Catcher Redux",
    });
    expect(reqs.map((r) => [r.kind, r.label])).toEqual([
      ["engine", "2025.04.01"],
      ["game", "Beyond All Reason test-1"],
      ["map", "Comet Catcher Redux"],
    ]);
  });

  it("asks for nothing a launch did not name", () => {
    expect(launchRequirements({})).toEqual([]);
    expect(
      launchRequirements({ engineVersion: "  ", game: "", map: undefined }),
    ).toEqual([]);
  });

  it("matches an engine version whatever space the caller left round it", () => {
    const [req] = launchRequirements({ engineVersion: " 2025.04.01 " });
    expect(req.label).toBe("2025.04.01");
    expect(req.isInstalled(installed())).toBe(true);
  });
});

describe("missingLaunchContent", () => {
  it("finds nothing missing when the machine has all three", () => {
    expect(
      missingLaunchContent(
        {
          engineVersion: "2025.04.01",
          game: "Beyond All Reason test-1",
          map: "Comet Catcher Redux",
        },
        installed(),
      ),
    ).toEqual([]);
  });

  it("reports each of the engine, game and map on its own", () => {
    const needs = {
      engineVersion: "2025.06.12",
      game: "SplinterFaction 0.1.86",
      map: "Tabula",
    };
    expect(missingLaunchContent(needs, installed()).map((r) => r.kind)).toEqual(
      ["engine", "game", "map"],
    );
    expect(
      missingLaunchContent(needs, installed({ maps: ["Tabula"] })).map(
        (r) => r.kind,
      ),
    ).toEqual(["engine", "game"]);
  });

  it("does not take another version of the game as the one asked for", () => {
    expect(
      missingLaunchContent(
        { game: "Beyond All Reason test-2" },
        installed(),
      ).map((r) => r.label),
    ).toEqual(["Beyond All Reason test-2"]);
  });

  it("checks only what the launch named", () => {
    expect(
      missingLaunchContent(
        { map: "Comet Catcher Redux" },
        installed({ games: [], engineVersions: [] }),
      ),
    ).toEqual([]);
  });

  describe("a game's missing dependency archives (issue #3489)", () => {
    const bench = "Zero-K Benchmark v3";
    const needs = { game: bench, map: "Comet Catcher Redux" };
    const withDependencies = (missingDependencies?: string[]) =>
      installed({
        games: [
          {
            name: bench,
            ...(missingDependencies ? { missingDependencies } : {}),
          },
        ],
      });

    it("reports each archive the installed game depends on and lacks", () => {
      const missing = missingLaunchContent(
        needs,
        withDependencies(["zero-k v1.7.6.4", "other v2"]),
      );
      expect(missing.map((r) => [r.kind, r.label])).toEqual([
        ["dependency", "zero-k v1.7.6.4"],
        ["dependency", "other v2"],
      ]);
    });

    it("offers no download, because the name the engine gives cannot be resolved", () => {
      const [req] = missingLaunchContent(
        needs,
        withDependencies(["zero-k v1.7.6.4"]),
      );
      expect(req.noDownload).toBe(true);
      expect(req.gameName).toBe(bench);
    });

    it("launches a game with no missing dependency as it does today", () => {
      expect(missingLaunchContent(needs, withDependencies([]))).toEqual([]);
    });

    it("reads a scan from an older worker, with no field, as none known", () => {
      expect(missingLaunchContent(needs, withDependencies())).toEqual([]);
    });

    it("names the game and not its dependency when the game is not installed", () => {
      const missing = missingLaunchContent(needs, installed({ games: [] }));
      expect(missing.map((r) => r.kind)).toEqual(["game"]);
    });

    it("reports the dependency beside a missing map", () => {
      const missing = missingLaunchContent(
        { game: bench, map: "Tabula" },
        withDependencies(["zero-k v1.7.6.4"]),
      );
      expect(missing.map((r) => r.kind)).toEqual(["dependency", "map"]);
    });
  });
});

describe("launchTargets", () => {
  const preferred = target("2025.04.01");
  const older = target("2024.11.30");

  it("runs the engine the caller would have used when no version is named", () => {
    const reqs = launchRequirements({ game: "Beyond All Reason test-1" });
    expect(launchTargets(reqs, [older, preferred], preferred)).toEqual({
      scan: preferred,
      run: preferred,
    });
  });

  it("runs the installed engine of the version the launch names", () => {
    const reqs = launchRequirements({ engineVersion: "2024.11.30" });
    expect(launchTargets(reqs, [preferred, older], preferred)).toEqual({
      scan: older,
      run: older,
    });
  });

  it("has nothing to run while the named version is not installed, and reads the install with what there is", () => {
    const reqs = launchRequirements({ engineVersion: "2025.06.12" });
    expect(launchTargets(reqs, [preferred, older], preferred)).toEqual({
      scan: preferred,
      run: null,
    });
  });

  it("never reads a folder name as a version (issue #3405)", () => {
    const reqs = launchRequirements({ engineVersion: "2024.11.30" });
    const folderOnly = target("2024.11.30", false);
    expect(launchTargets(reqs, [preferred, folderOnly], preferred)).toEqual({
      scan: preferred,
      run: null,
    });
  });

  it("has nothing to read or run on a machine with no engine", () => {
    expect(
      launchTargets(launchRequirements({ game: "Tabula" }), [], null),
    ).toEqual({ scan: null, run: null });
    expect(
      launchTargets(launchRequirements({ engineVersion: "1" }), [], null),
    ).toEqual({ scan: null, run: null });
  });

  it("follows a caller's own engine match rather than exact text", () => {
    const loose = {
      kind: "engine" as const,
      label: "2024.11.30 BAR",
      isInstalled: (i: InstalledContentSnapshot) =>
        i.engineVersions.some((v) => v.startsWith("2024.11.30")),
    };
    expect(launchTargets([loose], [preferred, older], preferred).run).toBe(
      older,
    );
  });
});
