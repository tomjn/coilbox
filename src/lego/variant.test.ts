import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { bodyPlanById } from "./bodyPlans";
import { GENERATOR_JOBS } from "./generate";
import { generateCheckedUnit } from "./generateChecked";
import { type LegoProject, parseLegoProjectJson } from "./model";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { rerollUnit } from "./reroll";
import { starterModules } from "./starterModules";
import {
  COVERING_STEP,
  makeVariant,
  variantName,
  variantRefusal,
} from "./variant";
import { variantRoot, withVariantsTogether } from "./variantFamily";

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

function generatedAt(
  size: "small" | "medium" | "large",
  job: string,
  planId: string,
  seed: number,
): LegoProject {
  const plan = bodyPlanById(planId);
  if (!plan) throw new Error(`no plan ${planId}`);
  const result = generateCheckedUnit(
    { seed, plan, job, size },
    {
      id: "unit",
      rootPieceId: "root",
      now: "2026-11-08T00:00:00.000Z",
      pack,
      modules,
    },
  );
  if (result.status !== "ok") throw new Error(result.message);
  return result.unit;
}

function variant(
  project: LegoProject,
  kind: "heavier" | "lighter" | "weapon",
): LegoProject {
  const result = makeVariant(project, kind, {
    pack,
    modules,
    id: `${project.id}-${kind}`,
    rootPieceId: `${project.id}-${kind}-root`,
    now: "2026-11-08T00:00:00.000Z",
  });
  if (result.status !== "ok") throw new Error(result.message);
  return result.unit;
}

/** A generated unit whose three variants all pass the checks at its seed, the
 *  first seed from 1 that does. Most seeds do. */
function generated(
  size: "small" | "medium" | "large",
  job = "artillery",
  planId = "biped",
): LegoProject {
  for (let seed = 1; seed <= 30; seed++) {
    const unit = generatedAt(size, job, planId, seed);
    const kinds = ["heavier", "lighter", "weapon"] as const;
    const fine = kinds.every(
      (kind) =>
        variantRefusal(unit, kind, modules) !== null ||
        makeVariant(unit, kind, { pack, modules }).status === "ok",
    );
    if (fine) return unit;
  }
  throw new Error(`no seed of ${job} ${size} passes`);
}

const job = (id: string) => GENERATOR_JOBS.find((j) => j.id === id);
const medium = generated("medium", "artillery");

/** The module instance's pieces, by the slot the unit records it in. */
function slotScales(project: LegoProject, slotPrefix: string): string[] {
  const entry = project.generated?.modules.find((m) =>
    m.slot.startsWith(slotPrefix),
  );
  return project.pieces
    .filter((p) => p.module?.instance === entry?.instance)
    .map((p) => p.scale.join(","));
}

describe("a heavier variant", () => {
  const heavy = variant(medium, "heavier");

  it("keeps the plan, job, style, seed and size, and records its parent", () => {
    expect(heavy.variantOf).toBe(medium.id);
    expect(heavy.id).not.toBe(medium.id);
    const { generated: was } = medium;
    const { generated: now } = heavy;
    expect(now?.plan).toBe(was?.plan);
    expect(now?.job).toBe(was?.job);
    expect(now?.size).toBe(was?.size);
    expect(now?.seed).toBe(was?.seed);
    expect(now?.style).toBe(was?.style);
    expect(heavy.rootPieceId).not.toBe(medium.rootPieceId);
  });

  it("takes the job's next size tier and a thicker covering", () => {
    expect(heavy.generated?.factor).toBe(job("artillery")?.size.large);
    expect(heavy.generated?.thickness).toBe(COVERING_STEP);
    expect(medium.generated?.factor).toBeUndefined();
    expect(medium.generated?.thickness).toBeUndefined();
  });

  it("is a larger unit than the original", () => {
    const length = (p: LegoProject) =>
      Object.values(p.skeleton?.proportions ?? {}).reduce(
        (sum, v) => sum + v,
        0,
      );
    expect(length(heavy)).toBeGreaterThan(length(medium));
  });

  it("leaves the original as it was", () => {
    const before = JSON.stringify(medium);
    variant(medium, "heavier");
    variant(medium, "lighter");
    variant(medium, "weapon");
    expect(JSON.stringify(medium)).toBe(before);
    expect(medium.variantOf).toBeUndefined();
  });

  it("is the same unit when made again", () => {
    expect(JSON.stringify(variant(medium, "heavier"))).toBe(
      JSON.stringify(heavy),
    );
  });

  it("changes only the covering at the largest size", () => {
    const large = generated("large");
    const heavier = variant(large, "heavier");
    expect(heavier.generated?.factor).toBeUndefined();
    expect(heavier.generated?.thickness).toBe(COVERING_STEP);
    expect(heavier.skeleton?.proportions).toEqual(large.skeleton?.proportions);
    expect(slotScales(heavier, "weapon")).toEqual(slotScales(large, "weapon"));
  });
});

describe("a lighter variant", () => {
  it("takes the previous size tier and a thinner covering", () => {
    const light = variant(medium, "lighter");
    expect(light.variantOf).toBe(medium.id);
    expect(light.generated?.factor).toBe(job("artillery")?.size.small);
    expect(light.generated?.thickness).toBeCloseTo(1 / COVERING_STEP, 10);
    expect(light.generated?.seed).toBe(medium.generated?.seed);
  });

  it("changes only the covering at the smallest size", () => {
    const small = generated("small");
    const light = variant(small, "lighter");
    expect(light.generated?.factor).toBeUndefined();
    expect(light.generated?.thickness).toBeCloseTo(1 / COVERING_STEP, 10);
    expect(light.skeleton?.proportions).toEqual(small.skeleton?.proportions);
  });

  it("undoes a heavier variant", () => {
    const small = generated("small");
    const back = variant(variant(small, "heavier"), "lighter");
    expect(back.generated?.factor).toBeUndefined();
    expect(back.generated?.thickness).toBeUndefined();
    expect(back.skeleton?.proportions).toEqual(small.skeleton?.proportions);
    expect(back.variantOf).toBe(`${small.id}-heavier`);
  });
});

describe("a different weapon variant", () => {
  const other = variant(medium, "weapon");

  it("keeps the skeleton, style, seed, size and covering", () => {
    expect(other.variantOf).toBe(medium.id);
    expect(other.skeleton?.proportions).toEqual(medium.skeleton?.proportions);
    expect(other.generated?.seed).toBe(medium.generated?.seed);
    expect(other.generated?.size).toBe(medium.generated?.size);
    expect(other.generated?.factor).toBeUndefined();
    expect(other.generated?.thickness).toBeUndefined();
    expect(other.generated?.covering?.length).toBe(
      medium.generated?.covering?.length,
    );
    expect(slotScales(other, "chassis")).toEqual(slotScales(medium, "chassis"));
  });

  it("records the seed that rolled the weapon, and the weapon differs", () => {
    expect(other.generated?.weaponSeed).toBeDefined();
    expect(slotScales(other, "weapon")).not.toEqual(
      slotScales(medium, "weapon"),
    );
  });

  it("has a different weapon every time it is made from the last", () => {
    const again = variant(other, "weapon");
    expect(again.generated?.weaponSeed).not.toBe(other.generated?.weaponSeed);
    expect(slotScales(again, "weapon")).not.toEqual(
      slotScales(other, "weapon"),
    );
  });

  it("has no weapon to change on a builder", () => {
    const builder = generated("medium", "builder");
    expect(variantRefusal(builder, "weapon", modules)).not.toBeNull();
    expect(variantRefusal(builder, "heavier", modules)).toBeNull();
    expect(makeVariant(builder, "weapon", { pack, modules }).status).toBe(
      "failed",
    );
  });

  it("has nothing to change where the job fixes the weapon", () => {
    const assault = generated("medium", "assault");
    expect(variantRefusal(assault, "weapon", modules)).not.toBeNull();
  });
});

describe("a variant of a roster tier between two sizes", () => {
  it("moves to the neighbouring size, and is not in the roster itself", () => {
    const sizes = job("artillery")?.size;
    if (!sizes) throw new Error("no artillery job");
    const between = (sizes.small + sizes.medium) / 2;
    const plan = bodyPlanById("biped");
    if (!plan) throw new Error("no biped");
    for (let seed = 1; seed <= 30; seed++) {
      const made = generateCheckedUnit(
        { seed, plan, job: "artillery", size: "small" },
        {
          id: "tier",
          rootPieceId: "tier-root",
          now: "2026-11-08T00:00:00.000Z",
          pack,
          modules,
          factor: between,
        },
        1,
      );
      if (made.status !== "ok") continue;
      const tier = {
        ...made.unit,
        roster: { id: "r", name: "R", job: "artillery", tier: 2, tiers: 3 },
      };
      const heavy = makeVariant(tier, "heavier", { pack, modules });
      const light = makeVariant(tier, "lighter", { pack, modules });
      if (heavy.status !== "ok" || light.status !== "ok") continue;
      expect(heavy.unit.generated?.factor).toBe(sizes.medium);
      // The small tier is the job's own factor for the recorded size.
      expect(light.unit.generated?.factor).toBeUndefined();
      expect(heavy.unit.roster).toBeUndefined();
      expect(heavy.unit.variantOf).toBe("tier");
      return;
    }
    throw new Error("no seed made both variants");
  });
});

describe("a variant that fails the checks with the unit's covering", () => {
  it("rolls the covering again and keeps the seed", () => {
    // The largest tier has no size above it, so only the covering can change.
    for (let seed = 1; seed <= 60; seed++) {
      const unit = generatedAt("large", "artillery", "biped", seed);
      const result = makeVariant(unit, "heavier", { pack, modules });
      if (result.status !== "ok") continue;
      const record = result.unit.generated;
      if (record?.coveringSeed === undefined) continue;
      expect(record.seed).toBe(unit.generated?.seed);
      expect(record.plan).toBe(unit.generated?.plan);
      expect(record.thickness).toBe(COVERING_STEP);
      expect(result.unit.skeleton?.proportions).toEqual(
        unit.skeleton?.proportions,
      );
      expect(slotScales(result.unit, "weapon")).toEqual(
        slotScales(unit, "weapon"),
      );
      expect(slotScales(result.unit, "chassis")).toEqual(
        slotScales(unit, "chassis"),
      );
      return;
    }
    throw new Error("no seed needed another covering");
  });

  it("is reported with the check when no covering passes", () => {
    let said: string | null = null;
    for (let seed = 1; seed <= 40 && said === null; seed++) {
      const unit = generatedAt("small", "scout", "biped", seed);
      const result = makeVariant(unit, "lighter", { pack, modules });
      if (result.status === "failed") said = result.message;
    }
    expect(said).toMatch(/fails the \w+ check, and a variant keeps its seed/);
  });
});

describe("a variant of something that cannot have one", () => {
  it("is refused for a unit that was not generated", () => {
    const { generated: _record, ...plain } = medium;
    expect(variantRefusal(plain, "heavier", modules)).not.toBeNull();
    expect(makeVariant(plain, "heavier", { pack, modules }).status).toBe(
      "failed",
    );
  });
});

describe("a variant after saving", () => {
  it("keeps what it came from and how it was made", () => {
    const weapon = variant(medium, "weapon");
    const heavy = variant(medium, "heavier");
    for (const unit of [weapon, heavy]) {
      const loaded = parseLegoProjectJson(JSON.stringify(unit));
      expect(loaded?.variantOf).toBe(medium.id);
      expect(loaded?.generated?.factor).toBe(unit.generated?.factor);
      expect(loaded?.generated?.thickness).toBe(unit.generated?.thickness);
      expect(loaded?.generated?.weaponSeed).toBe(unit.generated?.weaponSeed);
    }
  });

  it("is a unit of its own when it records no parent", () => {
    const loaded = parseLegoProjectJson(JSON.stringify(medium));
    expect(loaded?.variantOf).toBeUndefined();
  });

  it("keeps its character when rerolled", () => {
    const heavy = variant(medium, "heavier");
    const result = rerollUnit(heavy, { pack, modules });
    if (result.status !== "ok") throw new Error(result.message);
    expect(result.unit.variantOf).toBe(medium.id);
    expect(result.unit.generated?.factor).toBe(heavy.generated?.factor);
    expect(result.unit.generated?.thickness).toBe(heavy.generated?.thickness);
  });
});

describe("variants listed together", () => {
  const named = (id: string, variantOf?: string) =>
    ({
      ...medium,
      id,
      name: id,
      ...(variantOf ? { variantOf } : {}),
    }) as LegoProject;

  it("puts each variant after its original", () => {
    const list = [
      named("a"),
      named("b"),
      named("a-heavier", "a"),
      named("c"),
      named("a-lighter", "a"),
      named("a-heavier-weapon", "a-heavier"),
    ];
    expect(withVariantsTogether(list).map((p) => p.id)).toEqual([
      "a",
      "a-heavier",
      "a-heavier-weapon",
      "a-lighter",
      "b",
      "c",
    ]);
  });

  it("leaves a variant whose original is gone where it is", () => {
    const list = [named("x"), named("v", "deleted"), named("y")];
    expect(withVariantsTogether(list).map((p) => p.id)).toEqual([
      "x",
      "v",
      "y",
    ]);
  });

  it("does not loop on a chain that points back", () => {
    const list = [named("p", "q"), named("q", "p")];
    expect(
      withVariantsTogether(list)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["p", "q"]);
    const byId = new Map(list.map((p) => [p.id, p]));
    expect(variantRoot(list[0] as LegoProject, byId).id).toBe("p");
    expect(variantRoot(list[1] as LegoProject, byId).id).toBe("q");
  });

  it("finds the root of a chain", () => {
    const list = [named("a"), named("b", "a"), named("c", "b")];
    const byId = new Map(list.map((p) => [p.id, p]));
    expect(variantRoot(list[2] as LegoProject, byId).id).toBe("a");
  });
});

describe("a variant's name", () => {
  it("says the kind, and takes a number when that is taken", () => {
    const first = variantName(medium, "heavier", []);
    expect(first).toBe(`${medium.name} (heavier)`);
    const taken = [{ ...medium, id: "t", name: first }];
    expect(variantName(medium, "heavier", taken)).toBe(`${first} 2`);
  });

  it("is the name and unit name of the unit made", () => {
    const heavy = variant(medium, "heavier");
    expect(heavy.name).toBe(`${medium.name} (heavier)`);
    expect(heavy.unitName).not.toBe(medium.unitName);
  });
});
