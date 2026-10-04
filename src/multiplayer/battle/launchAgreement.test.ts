import { describe, expect, it } from "vitest";
import {
  computeMissingRequirements,
  type InstalledContentSnapshot,
} from "@/content/resolveContent";
import type { PlayTarget } from "@/play/config";
import { missingLaunchContent } from "@/play/launchContent";
import { battleRequirements } from "./contentBlock";
import { engineMatch } from "./engineMatch";

/**
 * The battle room and the other launch paths must agree on what is missing for
 * the same engine, game and map (issue #3393). Each case feeds one battle and
 * one installed snapshot to both and compares the answers.
 */

const battle = { modname: "Beyond All Reason test-1", map: "Tabula" };
const have = (over: Partial<InstalledContentSnapshot> = {}) => ({
  games: [{ name: "Beyond All Reason test-1" }],
  maps: ["Tabula"],
  engineVersions: [],
  ...over,
});

/** What the battle room says is missing of the game and map. */
const battleGameAndMap = (b: typeof battle, i: InstalledContentSnapshot) =>
  computeMissingRequirements(battleRequirements(b), i).map((r) => [
    r.kind,
    r.label,
  ]);

/** What the shared check says is missing of the game and map. */
const sharedGameAndMap = (b: typeof battle, i: InstalledContentSnapshot) =>
  missingLaunchContent({ game: b.modname, map: b.map }, i).map((r) => [
    r.kind,
    r.label,
  ]);

describe("battle room and shared check, game and map", () => {
  const cases: [string, typeof battle, InstalledContentSnapshot][] = [
    ["everything installed", battle, have()],
    ["game missing", battle, have({ games: [] })],
    ["map missing", battle, have({ maps: [] })],
    ["both missing", battle, have({ games: [], maps: [] })],
    [
      "another version of the game",
      battle,
      have({ games: [{ name: "Beyond All Reason test-2" }] }),
    ],
    [
      "same game, different case",
      battle,
      have({ games: [{ name: "beyond all reason test-1" }] }),
    ],
    ["map name with other spacing", { ...battle, map: "Tabula " }, have()],
    [
      "game with a shortname and version on the install",
      battle,
      have({
        games: [
          { name: "Beyond All Reason test-1", shortname: "BAR", version: "1" },
        ],
      }),
    ],
    ["the host named no game", { ...battle, modname: "" }, have()],
    ["the host named no map", { ...battle, map: "" }, have({ maps: [] })],
  ];
  it.each(cases)("agree: %s", (_name, b, i) => {
    expect(battleGameAndMap(b, i)).toEqual(sharedGameAndMap(b, i));
  });
});

const target = (folder: string, syncVersion?: string): PlayTarget => ({
  enginePath: `/e/${folder}`,
  executable: `/e/${folder}/spring`,
  dataDir: "/c",
  engineVersion: syncVersion ?? folder,
  syncVersion,
});

/** The engine the room launches: one that reported the host's version, else the
 *  first (the preferred one stands in for it here). Mirrors `usePreferredTarget`. */
const roomTarget = (hostVersion: string, installed: PlayTarget[]) =>
  installed.find((t) => t.syncVersion?.trim() === hostVersion.trim()) ??
  installed[0] ??
  null;

/** The room blocks the launch on the engine only when its engine reported a
 *  version that is not the host's. See `launchBlock`. */
const roomSaysEngineMissing = (hostVersion: string, installed: PlayTarget[]) =>
  engineMatch(
    { engine: "Recoil", version: hostVersion },
    roomTarget(hostVersion, installed),
  ).verdict === "mismatch";

/** The shared check's reading of the same engines, as `LaunchContentProvider`
 *  builds it: the reported version, or the folder name before it is verified. */
const sharedSaysEngineMissing = (
  hostVersion: string,
  installed: PlayTarget[],
) =>
  missingLaunchContent(
    { engineVersion: hostVersion },
    have({ engineVersions: installed.map((t) => t.engineVersion) }),
  ).length > 0;

describe("battle room and shared check, engine", () => {
  const agree: [string, string, PlayTarget[]][] = [
    [
      "a verified engine of the host's version",
      "2026.03.01",
      [target("a", "2026.03.01")],
    ],
    [
      "a verified engine of another version",
      "2026.03.01",
      [target("a", "2025.06.20")],
    ],
    [
      "the host's engine installed but not the preferred one",
      "2026.03.01",
      [target("a", "2025.06.20"), target("b", "2026.03.01")],
    ],
    ["the lobby gave no host version", "", [target("a", "2025.06.20")]],
    [
      "host version with spaces round it",
      " 2026.03.01 ",
      [target("a", "2026.03.01")],
    ],
    [
      "a verified engine whose folder name is the host's version",
      "2026.03.01",
      [target("2026.03.01", "2025.06.20")],
    ],
  ];
  it.each(agree)("agree: %s", (_name, host, installed) => {
    expect(roomSaysEngineMissing(host, installed)).toBe(
      sharedSaysEngineMissing(host, installed),
    );
  });

  // These differ on purpose and are pinned so a change to either side shows up
  // here. Making them agree would tighten the shared check or loosen the room's
  // engine match, and is tracked separately.
  it("agree: an engine not yet verified, named for the host's version, and the room asks it", () => {
    const installed = [target("2026.03.01")];
    expect(roomSaysEngineMissing("2026.03.01", installed)).toBe(false);
    expect(sharedSaysEngineMissing("2026.03.01", installed)).toBe(false);
    expect(
      engineMatch(
        { engine: "Recoil", version: "2026.03.01" },
        roomTarget("2026.03.01", installed),
      ).verdict,
    ).toBe("unverified");
  });

  it("differ: an unverified engine named for the host's version beside a verified other one", () => {
    const installed = [target("a", "2025.06.20"), target("2026.03.01")];
    expect(roomSaysEngineMissing("2026.03.01", installed)).toBe(true);
    expect(sharedSaysEngineMissing("2026.03.01", installed)).toBe(false);
  });
});
