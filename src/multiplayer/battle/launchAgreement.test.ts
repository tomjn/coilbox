import { describe, expect, it } from "vitest";
import {
  computeMissingRequirements,
  type InstalledContentSnapshot,
} from "@/content/resolveContent";
import type { PlayTarget } from "@/play/config";
import { concludeEngine } from "@/play/engineConfirmation";
import { launchRequirements, missingLaunchContent } from "@/play/launchContent";
import { battleRequirements } from "./contentBlock";
import { engineMatch } from "./engineMatch";

/**
 * The battle room and the other launch paths must agree on what is missing for
 * the same engine, game and map (issues #3393 and #3405). Each case feeds one
 * battle and one installed snapshot to both and compares the answers.
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

const exe = (folder: string) => `/e/${folder}/spring`;
const target = (folder: string, syncVersion?: string): PlayTarget => ({
  enginePath: `/e/${folder}`,
  executable: exe(folder),
  dataDir: "/c",
  engineVersion: syncVersion ?? folder,
  syncVersion,
});

/** What asking each engine for its version came back with, by folder. A null is
 *  an engine that would not say. */
type Answers = Record<string, string | null>;

/** The engines as they stand once every unverified one has been asked, which is
 *  where the battle room ends up on join (`useEngineVersionCheck`). */
const afterAsking = (installed: PlayTarget[], answers: Answers) =>
  installed.map((t) => {
    const reported = answers[t.engineVersion];
    return !t.syncVersion && reported
      ? { ...t, syncVersion: reported, engineVersion: reported }
      : t;
  });

/** The engine the room launches: one that reported the host's version, else the
 *  first (the preferred one stands in for it here). Mirrors `usePreferredTarget`. */
const roomTarget = (hostVersion: string, installed: PlayTarget[]) =>
  installed.find((t) => t.syncVersion?.trim() === hostVersion.trim()) ??
  installed[0] ??
  null;

/** What the room says once its engines have been asked. It blocks the launch on
 *  the engine only when its engine reported a version that is not the host's.
 *  See `launchBlock`. */
const roomVerdict = (
  hostVersion: string,
  installed: PlayTarget[],
  answers: Answers,
) => {
  const settled = afterAsking(installed, answers);
  return engineMatch(
    { engine: "Recoil", version: hostVersion },
    roomTarget(hostVersion, settled),
  ).verdict;
};
const roomSaysEngineMissing = (
  hostVersion: string,
  installed: PlayTarget[],
  answers: Answers,
) => roomVerdict(hostVersion, installed, answers) === "mismatch";

/** The shared check's conclusion for the same engines, with the answers it would
 *  have been given when it asked. An answer for an engine it did not ask is not
 *  passed on, because it would never have been run. */
const sharedConclusion = (
  hostVersion: string,
  installed: PlayTarget[],
  answers: Answers,
) => {
  const engines = installed.map((t) => ({
    executable: t.executable,
    folder: t.engineVersion,
    verified: t.syncVersion,
  }));
  let verifications: { executable: string; reported: string | null }[] = [];
  for (;;) {
    const c = concludeEngine(
      launchRequirements({ engineVersion: hostVersion }),
      engines,
      verifications,
    );
    if (c.kind !== "verify") return c;
    const folder = installed.find((t) => t.executable === c.executable)
      ?.engineVersion as string;
    verifications = [
      ...verifications,
      { executable: c.executable, reported: answers[folder] ?? null },
    ];
  }
};
const sharedSaysEngineMissing = (
  hostVersion: string,
  installed: PlayTarget[],
  answers: Answers,
) => sharedConclusion(hostVersion, installed, answers).kind === "missing";

describe("battle room and shared check, engine", () => {
  const V = "2026.03.01";
  const agree: [string, string, PlayTarget[], Answers][] = [
    ["a verified engine of the host's version", V, [target("a", V)], {}],
    [
      "a verified engine of another version",
      V,
      [target("a", "2025.06.20")],
      {},
    ],
    [
      "the host's engine installed but not the preferred one",
      V,
      [target("a", "2025.06.20"), target("b", V)],
      {},
    ],
    ["the lobby gave no host version", "", [target("a", "2025.06.20")], {}],
    ["host version with spaces round it", ` ${V} `, [target("a", V)], {}],
    [
      "a verified engine whose folder name is the host's version",
      V,
      [target(V, "2025.06.20")],
      {},
    ],
    [
      "an unverified engine named for the host's version, which reports it",
      V,
      [target(V)],
      { [V]: V },
    ],
    [
      "an unverified engine named for the host's version, which reports another build",
      V,
      [target(V)],
      { [V]: "2025.06.20" },
    ],
    [
      "an unverified engine named for the host's version beside a verified other one, which reports the host's version",
      V,
      [target("a", "2025.06.20"), target(V)],
      { [V]: V },
    ],
    [
      "an unverified engine named for the host's version beside a verified other one, which reports another build",
      V,
      [target("a", "2025.06.20"), target(V)],
      { [V]: "2025.01.01" },
    ],
    [
      "an unverified engine named for another version",
      V,
      [target("2025.06.20")],
      { "2025.06.20": "2025.06.20" },
    ],
  ];
  it.each(agree)("agree: %s", (_name, host, installed, answers) => {
    expect(sharedSaysEngineMissing(host, installed, answers)).toBe(
      roomSaysEngineMissing(host, installed, answers),
    );
  });

  it("agree on the issue's case: verified 2025.06.20, unverified folder 2026.03.01, host on 2026.03.01", () => {
    const installed = [target("a", "2025.06.20"), target(V)];
    // The shared check no longer reads the folder name as the version. It asks
    // that engine, as the room does on join, and goes with the answer.
    expect(sharedConclusion(V, installed, { [V]: V }).kind).toBe("installed");
    expect(roomVerdict(V, installed, { [V]: V })).toBe("match");
    expect(sharedConclusion(V, installed, { [V]: "2025.01.01" }).kind).toBe(
      "missing",
    );
    expect(roomVerdict(V, installed, { [V]: "2025.01.01" })).toBe("mismatch");
  });

  it("agree that an engine which will not say its version is not a mismatch, and the check did not happen", () => {
    const installed = [target(V)];
    expect(roomVerdict(V, installed, { [V]: null })).toBe("unverified");
    expect(sharedConclusion(V, installed, { [V]: null }).kind).toBe(
      "unconfirmed",
    );
  });

  // The one difference the decision leaves. The shared check asks only an engine
  // whose folder is named for the version, so as not to run engines for nothing,
  // while the room asks every engine on join. An engine in a folder with some
  // other name that does report the host's version is found by the room only.
  it("differ on purpose: an unverified engine in a folder with another name that reports the host's version", () => {
    const installed = [target("my-engine")];
    const answers = { "my-engine": V };
    expect(roomSaysEngineMissing(V, installed, answers)).toBe(false);
    expect(sharedSaysEngineMissing(V, installed, answers)).toBe(true);
  });
});
