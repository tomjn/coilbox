import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type GenBuildGraph,
  type GenerateRunOpts,
  type GenRunMap,
  generateRun,
} from "./generate";
import type { RogueliteRun, RunNodeType } from "./model";

/**
 * Golden runs (issue #2410), the same guard #2167 landed for conquest
 * (`src/conquest/galaxyGolden.test.ts`). A warpath run is shared by pasting a
 * challenge code carrying its seed (`./challenge.ts`), so two machines have to
 * agree on what a seed means. `generate.ts` says it is a pure function of
 * `opts.seed` for exactly that reason.
 *
 * Verified for this issue, by reading the call graph rather than trusting the
 * docstring. `generateRun` and everything it calls, `../conquest/rng`,
 * `../conquest/names` (`sectorNameForSeed`) and `../content/buildTree`
 * (`buildBuildGraph`), use only `Math.floor`, `Math.round`, `Math.min`,
 * `Math.max`, `Math.ceil` and `Math.imul`, all exactly specified by
 * ECMAScript. None of them, nor anything they draw on, calls `Math.cos`,
 * `Math.sin`, `Math.log`, `Math.hypot` or any other function the spec leaves
 * implementation-approximated (the set #2167 measured V8 and macOS's
 * JavaScriptCore disagreeing on for 2302 of 16384 results). So unlike the
 * conquest galaxies, a warpath run's own arithmetic is exact today, engine for
 * engine. This test exists to hold that true as the generator grows, not
 * because a divergence was found.
 *
 * Regenerate after an intended change with:
 *   UPDATE_RUN_GOLDEN=1 bun run test generateGolden
 * then read the diff before committing it.
 */

const GOLDEN_DIR = join(__dirname, "fixtures", "runs");

const MAPS: GenRunMap[] = [
  { name: "Small A", size: 64 },
  { name: "Small B", size: 100 },
  { name: "Medium", size: 256 },
  { name: "Large", size: 576 },
  { name: "Huge", size: 1024 },
];

// A small commander build graph: commander -> two plants -> a few units each.
const BUILD: GenBuildGraph = {
  startUnit: "com",
  edges: new Map<string, string[]>([
    ["com", ["mex", "solar", "vplant", "aplant"]],
    ["mex", []],
    ["solar", []],
    ["vplant", ["tank", "scout", "con"]],
    ["aplant", ["fighter", "bomber"]],
    ["con", ["radar", "llt"]],
    ["tank", []],
    ["scout", []],
    ["fighter", []],
    ["bomber", []],
    ["radar", []],
    ["llt", []],
  ]),
  names: new Map<string, string>([
    ["vplant", "Vehicle Plant"],
    ["aplant", "Aircraft Plant"],
  ]),
};

const base: GenerateRunOpts = {
  seed: 0,
  length: "standard",
  difficulty: 2,
  game: { shortname: "TG" },
  factionId: "player",
  side: "ARM",
  skin: "galaxy",
  maps: MAPS,
  build: BUILD,
  enemyAiKey: "native:BARb",
  now: "2026-01-01T00:00:00.000Z",
};

const cases: { file: string; opts: GenerateRunOpts }[] = [
  { file: "standard-seed1.txt", opts: { ...base, seed: 1 } },
  { file: "standard-seed4242.txt", opts: { ...base, seed: 4242 } },
  { file: "quick-seed1.txt", opts: { ...base, seed: 1, length: "quick" } },
  { file: "long-seed1.txt", opts: { ...base, seed: 1, length: "long" } },
  {
    // Perk-only path: no build graph, so every reward option must be a perk
    // and startUnit/unlockedUnits stay empty.
    file: "no-build-seed1.txt",
    opts: { ...base, seed: 1, build: undefined },
  },
  {
    // Exercises the loadout pre-unlock branch on top of the starter kit.
    file: "loadout-seed1.txt",
    opts: { ...base, seed: 1, loadoutBranch: 2 },
  },
  {
    // High difficulty plus ascension pushes enemyAiCount/handicap against
    // their caps, a different arithmetic path than the base case.
    file: "ascension-seed1.txt",
    opts: { ...base, seed: 1, difficulty: 4, ascension: 3 },
  },
];

/**
 * One line per node plus one per edge. Text rather than JSON so the file
 * stays outside the formatter's reach and is byte-comparable, matching
 * `galaxyGolden.test.ts`. Per-node `battle`/`reward`/`event`/`shop` payloads
 * are `JSON.stringify`d rather than hand-flattened field by field, the same
 * as that file does for a node's `star` field. It is a stable, deterministic
 * `String`-adjacent output, and it captures every field a golden should
 * without hand-maintaining a bespoke line format per node type.
 */
function render(run: RogueliteRun): string {
  const lines = [
    `name ${run.name}`,
    `startUnit ${run.startUnit ?? ""}`,
    `seed ${run.settings.seed}`,
    `length ${run.settings.length}`,
    `difficulty ${run.settings.difficulty}`,
    `ascension ${run.settings.ascension}`,
    `maxHull ${run.progress.maxHull}`,
    `unlockedUnits ${run.progress.unlockedUnits.join(",")}`,
  ];
  for (const n of run.nodes) {
    lines.push(
      [
        `node ${n.id}`,
        `type=${n.type}`,
        `col=${n.col}`,
        `row=${n.row}`,
        `battle=${JSON.stringify(n.battle ?? null)}`,
        `reward=${JSON.stringify(n.reward ?? null)}`,
        `event=${JSON.stringify(n.event ?? null)}`,
        `shop=${JSON.stringify(n.shop ?? null)}`,
      ].join(" "),
    );
  }
  for (const [a, b] of run.edges) lines.push(`edge ${a} ${b}`);
  return `${lines.join("\n")}\n`;
}

describe("runlite golden runs", () => {
  for (const { file, opts } of cases) {
    it(`${file} matches its checked-in run`, () => {
      const emitted = render(generateRun(opts));
      const path = join(GOLDEN_DIR, file);

      if (process.env.UPDATE_RUN_GOLDEN) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(path, emitted);
      }

      expect(emitted).toBe(readFileSync(path, "utf8"));
    });
  }

  /**
   * The golden files only prove something if the node types they exercise
   * cover the generator's output space. A node type that never showed up in
   * any case would go unchecked.
   */
  it("covers every node type the generator offers", () => {
    const covered = new Set<RunNodeType>();
    for (const { opts } of cases) {
      for (const n of generateRun(opts).nodes) covered.add(n.type);
    }
    const offered: RunNodeType[] = [
      "start",
      "battle",
      "elite",
      "boss",
      "reward",
      "event",
      "shop",
    ];
    const missing = offered.filter((t) => !covered.has(t));
    expect(missing).toEqual([]);
  });
});
