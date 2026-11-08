import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { checkBalance } from "./balance";
import { bodyPlanById } from "./bodyPlans";
import { pieceWorldBox } from "./covering";
import {
  GENERATOR_JOBS,
  type GeneratorInputs,
  type GeneratorJob,
  type GeneratorSize,
  generateUnit,
} from "./generate";
import { generateCheckedUnit } from "./generateChecked";
import { type LegoProject, parseLegoProjectJson } from "./model";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { worldMatrix } from "./reparent";
import { starterModules } from "./starterModules";

/** The bundled parts with their geometry, which the balance check measures. */
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
const options = {
  id: "unit",
  rootPieceId: "root",
  now: "2026-11-07T00:00:00.000Z",
  pack,
  modules: starterModules(pack),
};

function inputs(
  seed: number,
  planId: string,
  job: GeneratorJob,
  size: GeneratorSize,
): GeneratorInputs {
  const plan = bodyPlanById(planId);
  if (!plan) throw new Error(`no plan ${planId}`);
  return { seed, plan, job, size };
}

const CASES = ["wheeled", "tracked"].flatMap((plan) =>
  GENERATOR_JOBS.flatMap((job) =>
    (["small", "medium", "large"] as const).flatMap((size) =>
      [1, 2, 3].map((seed) => ({ plan, job: job.id, size, seed })),
    ),
  ),
);

function checked(c: (typeof CASES)[number]): LegoProject {
  const result = generateCheckedUnit(
    inputs(c.seed, c.plan, c.job, c.size),
    options,
  );
  if (result.status !== "ok") throw new Error(result.message);
  return result.unit;
}

const label = (c: (typeof CASES)[number]) =>
  `${c.plan} ${c.job} ${c.size} ${c.seed}`;

describe("running gear (#5117)", () => {
  it("puts a part on every wheel bone and a tread on every track bone", () => {
    for (const c of CASES) {
      const unit = checked(c);
      const running = unit.generated?.running ?? [];
      for (const bone of unit.pieces.filter((p) => p.bone !== undefined)) {
        const parts = unit.pieces.filter(
          (p) => p.parentId === bone.id && p.partId,
        );
        if (bone.role === "wheel") {
          expect(parts.length, `${label(c)} ${bone.bone}`).toBe(1);
          expect(
            running.find((r) => r.piece === parts[0]?.id),
            label(c),
          ).toMatchObject({ bone: bone.bone, kind: "wheel" });
        }
        if (bone.role === "track") {
          expect(parts.length, `${label(c)} ${bone.bone}`).toBeGreaterThan(0);
          for (const part of parts) {
            expect(
              running.find((r) => r.piece === part.id),
              label(c),
            ).toMatchObject({ bone: bone.bone, kind: "tread" });
          }
        }
      }
    }
  }, 60_000);

  it("stands a wheeled unit on its wheels and a tracked one on its treads", () => {
    for (const c of CASES) {
      const unit = checked(c);
      const balance = checkBalance(unit, pack, null);
      expect(balance.status, label(c)).not.toBe("notApplicable");
      if (balance.status === "notApplicable") continue;
      // Measured off the parts, not guessed from the lowest pieces.
      expect(balance.guessed, label(c)).toBeUndefined();
      const standing = unit.pieces
        .filter((p) => p.role === (c.plan === "wheeled" ? "wheel" : "track"))
        .map((p) => p.id);
      expect(standing.length, label(c)).toBeGreaterThan(0);
      for (const id of standing) {
        expect(balance.resting, label(c)).toContain(id);
      }
    }
  }, 60_000);

  it("sizes each wheel of a wheeled unit to the height of its bone", () => {
    for (const c of CASES.filter((x) => x.plan === "wheeled")) {
      const unit = checked(c);
      for (const entry of unit.generated?.running ?? []) {
        const piece = unit.pieces.find((p) => p.id === entry.piece);
        const box = piece && pieceWorldBox(unit, pack, piece);
        expect(box, label(c)).toBeTruthy();
        if (!piece?.parentId || !box) continue;
        // On the ground, with the bone at its middle.
        const joint = new THREE.Vector3().setFromMatrixPosition(
          worldMatrix(unit, piece.parentId),
        );
        expect(box.min.y, label(c)).toBeCloseTo(0, 5);
        expect((box.min.y + box.max.y) / 2, label(c)).toBeCloseTo(joint.y, 5);
      }
    }
  }, 60_000);

  it("keeps the road wheels of a track from passing through each other", () => {
    for (const c of CASES.filter((x) => x.plan === "tracked")) {
      const unit = checked(c);
      for (const track of unit.pieces.filter((p) => p.role === "track")) {
        const boxes = unit.pieces
          .filter((p) => p.role === "wheel" && p.parentId === track.id)
          .flatMap((bone) =>
            unit.pieces
              .filter((p) => p.parentId === bone.id && p.partId)
              .flatMap((p) => pieceWorldBox(unit, pack, p) ?? []),
          )
          .sort((a, b) => a.min.z - b.min.z);
        expect(boxes.length, label(c)).toBeGreaterThan(1);
        for (let i = 1; i < boxes.length; i++) {
          expect(
            (boxes[i]?.min.z ?? 0) - (boxes[i - 1]?.max.z ?? 0),
            label(c),
          ).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }
  }, 60_000);

  it("leaves a unit with no wheel or track bone without any", () => {
    for (const plan of ["biped", "quadruped", "ship"]) {
      const result = generateCheckedUnit(
        inputs(1, plan, "assault", "medium"),
        options,
      );
      if (result.status !== "ok") throw new Error(result.message);
      expect(result.unit.generated?.running).toBeUndefined();
    }
  });

  it("leaves the bones bare when the pack has no wheel part", () => {
    const bare: LoadedPack = {
      ...pack,
      byId: new Map(
        [...pack.byId].filter(
          ([id]) =>
            !["2c9119b8312f", "33fe1e0324a5", "46fc689d2d63"].includes(id),
        ),
      ),
      parts: pack.parts.filter(
        (p) => !["2c9119b8312f", "33fe1e0324a5", "46fc689d2d63"].includes(p.id),
      ),
    };
    const unit = generateUnit(inputs(1, "tracked", "assault", "medium"), {
      ...options,
      pack: bare,
    });
    expect(unit.generated?.running).toBeUndefined();
    for (const bone of unit.pieces.filter(
      (p) => p.bone !== undefined && (p.role === "wheel" || p.role === "track"),
    )) {
      expect(unit.pieces.some((p) => p.parentId === bone.id && p.partId)).toBe(
        false,
      );
    }
  });

  it("keeps the record through a save and a reload", () => {
    const unit = checked({
      plan: "tracked",
      job: "builder",
      size: "medium",
      seed: 1,
    });
    expect(unit.generated?.running?.length).toBeGreaterThan(0);
    expect(
      parseLegoProjectJson(JSON.stringify(unit))?.generated?.running,
    ).toEqual(unit.generated?.running);
  });
});
