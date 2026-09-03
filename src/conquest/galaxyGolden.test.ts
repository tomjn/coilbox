import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type GenerateOptions, generateGalaxy } from "./generate";
import type { GalaxyDoc } from "./model";

/**
 * Golden galaxies (issue #2167). `generate.ts` says it is "fully deterministic
 * from the seed", and challenge sharing sends a seed rather than a document, so
 * two machines have to agree on what a seed means. Nothing checked that across
 * engines: coilbox runs on V8 in WebView2 on Windows and on JavaScriptCore in
 * the WebKit webviews on macOS and Linux, and the generator calls `Math.cos`,
 * `Math.sin`, `Math.log` and `Math.hypot`, all four of which ECMAScript leaves
 * implementation-approximated. Only `Math.sqrt` is pinned by IEEE-754.
 *
 * So each case here has its whole galaxy checked in, byte for byte, the same
 * way `src/scenario` keeps `fixtures/missions/<id>/mission.lua` beside each
 * scenario fixture. Run the suite on another platform and a disagreement shows
 * up as a diff naming the system or lane that moved.
 *
 * What this catches: any change to what a seed means, whether it comes from the
 * engine, a name pool, or the generator itself.
 *
 * What it does not catch: a divergence too small to reach the document. Scatter
 * positions are rounded to 0.1 before they are written, which is far coarser
 * than the one-unit-in-the-last-place gaps the engines actually disagree by, so
 * this asserts the contract two people share and not the arithmetic underneath
 * it.
 *
 * Regenerate after an intended change with:
 *   UPDATE_GALAXY_GOLDEN=1 bun run test galaxyGolden
 * then read the diff before committing it.
 */

const GOLDEN_DIR = join(__dirname, "fixtures", "galaxies");

/** Fixed pool, so a node's battlefield is part of the golden like anything
 * else. Real installs vary, which is why maps are not part of what a shared
 * seed promises. */
const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const base: GenerateOptions = {
  seed: 0,
  game: { shortname: "TG" },
  maps,
  nodeCount: 24,
  factionCount: 2,
};

const cases: { file: string; opts: GenerateOptions }[] = [
  { file: "scatter-24-seed1.txt", opts: { ...base, seed: 1 } },
  { file: "scatter-24-seed4242.txt", opts: { ...base, seed: 4242 } },
  {
    file: "spiral-80-seed1.txt",
    opts: { ...base, seed: 1, layout: "spiral", nodeCount: 80 },
  },
  {
    file: "clusters-24-seed1.txt",
    opts: { ...base, seed: 1, layout: "clusters" },
  },
  { file: "ring-24-seed1.txt", opts: { ...base, seed: 1, layout: "ring" } },
  {
    // The one layout whose positions are never rounded: they come from the
    // catalogue at full precision, and the lanes come from a `Math.hypot`
    // distance tested against the jump range.
    file: "realstars-r12-seed1.txt",
    opts: { ...base, seed: 1, layout: "realstars", radiusLy: 12 },
  },
];

/**
 * One line per faction, system and lane. Text rather than JSON so the file is
 * outside the formatter's reach and stays byte-comparable, and so a failure
 * reads as a handful of changed lines instead of a reindented document.
 *
 * Numbers go through `String`, whose output ECMAScript does pin exactly, so a
 * faction's aggression lands here at full precision. That is the most sensitive
 * witness in the file: it is a raw draw off the seeded RNG with no rounding, so
 * any drift in the random stream shows up in it.
 */
function render(doc: GalaxyDoc): string {
  const lines = [
    `id ${doc.id}`,
    `title ${doc.title}`,
    `description ${doc.description ?? ""}`,
    `game ${doc.game.shortname}`,
    `playerFaction ${doc.playerFactionId}`,
    `playable ${(doc.playableFactionIds ?? []).join(",")}`,
  ];
  for (const f of doc.factions) {
    lines.push(
      `faction ${f.id} name=${JSON.stringify(f.name)} color=${f.color} aggression=${String(f.aggression)} side=${f.side ?? ""}`,
    );
  }
  for (const n of doc.nodes) {
    lines.push(
      [
        `node ${n.id}`,
        `name=${JSON.stringify(n.name)}`,
        `pos=${n.pos.map(String).join(",")}`,
        `owner=${n.owner}`,
        `kind=${n.kind ?? "normal"}`,
        `difficulty=${String(n.difficulty)}`,
        `map=${JSON.stringify(n.battle.mapName)}`,
        `star=${JSON.stringify((n.star?.spectral ?? []).join("/"))}`,
      ].join(" "),
    );
  }
  for (const [a, b] of doc.links) lines.push(`link ${a} ${b}`);
  return `${lines.join("\n")}\n`;
}

describe("conquest golden galaxies", () => {
  for (const { file, opts } of cases) {
    it(`${file} matches its checked-in galaxy`, () => {
      // `now` is fixed so the only thing that can move is the generation.
      const emitted = render(generateGalaxy(opts, "2026-01-01T00:00:00.000Z"));
      const path = join(GOLDEN_DIR, file);

      if (process.env.UPDATE_GALAXY_GOLDEN) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(path, emitted);
      }

      expect(emitted).toBe(readFileSync(path, "utf8"));
    });
  }

  /**
   * The golden files only prove portability if they cover the code paths that
   * differ. Each scatter reaches for a different mix of the approximated
   * functions: the spiral is the only one calling `Math.log`, and only
   * `realstars` builds its lanes from a 3D `Math.hypot` distance against the
   * jump range. A layout added with no case here would go unchecked.
   */
  it("covers every layout the generator offers", () => {
    const covered = new Set(cases.map(({ opts }) => opts.layout ?? "scatter"));
    const offered: NonNullable<GenerateOptions["layout"]>[] = [
      "scatter",
      "spiral",
      "clusters",
      "ring",
      "realstars",
    ];
    const missing = offered.filter((l) => !covered.has(l));

    expect(missing).toEqual([]);
  });
});
