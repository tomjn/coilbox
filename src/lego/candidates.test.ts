import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bodyPlanById } from "./bodyPlans";
import { generateCandidates, parseSeed } from "./candidates";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { starterModules } from "./starterModules";

/** The bundled parts with their geometry, which every check measures. */
function bundledPack(): LoadedPack {
  const dir = fileURLToPath(
    new URL("../../src-tauri/legoparts/", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${dir}pack.json`, "utf8"),
  ) as LegoPackManifest;
  const blob = new Uint8Array(gunzipSync(readFileSync(`${dir}parts.bin.gz`)));
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const vertexOffset = view.getUint32(16, true);
  const vertexBytes = view.getUint32(20, true);
  const indexOffset = view.getUint32(24, true);
  const indexBytes = view.getUint32(28, true);
  const vertices = new Float32Array(
    blob.slice(vertexOffset, vertexOffset + vertexBytes).buffer,
  );
  const indices = new Uint16Array(
    blob.slice(indexOffset, indexOffset + indexBytes).buffer,
  );
  const merged = mergePacks([{ manifest, vertices, indices }]);
  return {
    ...merged,
    vertices,
    indices,
    library: { packs: [manifest], atlases: [], dir: "", problems: [] },
  };
}

const pack = bundledPack();
const modules = starterModules(pack);
let made = 0;
const options = () => ({
  id: `unit${++made}`,
  rootPieceId: `root${made}`,
  now: "2026-11-08T00:00:00.000Z",
  pack,
  modules,
});
const plan = bodyPlanById("biped");
if (!plan) throw new Error("no biped plan");
const inputs = { plan, job: "assault", size: "medium" as const };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateCandidates", () => {
  it("makes each candidate from a later seed than the one before", () => {
    const batch = generateCandidates(inputs, 1, 4, options);

    expect(batch.failed).toBeNull();
    expect(batch.candidates).toHaveLength(4);
    const seeds = batch.candidates.map((c) => c.seed);
    expect(seeds[0]).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < seeds.length; i++) {
      expect(seeds[i]).toBeGreaterThan(seeds[i - 1]);
    }
    expect(batch.next).toBe(seeds[3] + 1);
    for (const c of batch.candidates) {
      expect(c.unit.generated?.seed).toBe(c.seed);
      expect(c.unit.generated).toMatchObject({
        plan: "biped",
        job: "assault",
        size: "medium",
      });
    }
  });

  it("gives each candidate its own unit id", () => {
    const batch = generateCandidates(inputs, 1, 3, options);
    const ids = new Set(batch.candidates.map((c) => c.unit.id));
    expect(ids.size).toBe(3);
  });

  it("rerolls into seeds the last batch did not use", () => {
    const first = generateCandidates(inputs, 1, 3, options);
    const second = generateCandidates(inputs, first.next, 3, options);

    const before = Math.max(...first.candidates.map((c) => c.seed));
    for (const c of second.candidates) {
      expect(c.seed).toBeGreaterThan(before);
    }
  });

  it("remakes the same unit from a candidate's seed", () => {
    const [candidate] = generateCandidates(inputs, 5, 1, options).candidates;
    const [again] = generateCandidates(
      inputs,
      candidate.seed,
      1,
      options,
    ).candidates;

    expect(again.seed).toBe(candidate.seed);
    expect(again.unit.pieces.length).toBe(candidate.unit.pieces.length);
    expect(again.unit.generated).toEqual(
      JSON.parse(
        JSON.stringify(candidate.unit.generated).replaceAll(
          candidate.unit.id,
          again.unit.id,
        ),
      ),
    );
  });
});

describe("parseSeed", () => {
  it("takes a whole number, negative ones included", () => {
    expect(parseSeed(" 42 ")).toBe(42);
    expect(parseSeed("-3")).toBe(-3);
  });

  it("refuses anything that is not a whole number", () => {
    expect(parseSeed("4.5")).toBeNull();
    expect(parseSeed("abc")).toBeNull();
    expect(parseSeed("1e3")).toBeNull();
    expect(parseSeed("99999999999999999999")).toBeNull();
  });

  it("picks a random seed for a blank field", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    expect(parseSeed("  ")).toBe(250000);
  });
});
