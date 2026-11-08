import { describe, expect, it } from "vitest";

import { bodyPlanById } from "./bodyPlans";
import { emptyDocument, reduceDocument } from "./document";
import { generateCheckedUnit } from "./generateChecked";
import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  parseLegoProjectJson,
  pieceById,
} from "./model";
import { rerollUnit } from "./reroll";
import {
  partFamily,
  rerolledSeed,
  rerollKind,
  rerollPart,
  rerollRefusal,
} from "./rerollPart";
import { starterModules } from "./starterModules";
import { bundledPack } from "./testPack";

const pack = bundledPack();
const modules = starterModules(pack);

function generated(
  seed: number,
  job: "assault" | "builder" | "artillery",
): LegoProject {
  const plan = bodyPlanById("biped");
  if (!plan) throw new Error("no biped plan");
  const result = generateCheckedUnit(
    { seed, plan, job, size: "medium" },
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

/** Ids that count up, so two runs of a reroll make the same document. */
function counter(): () => string {
  let n = 0;
  return () => `new.${++n}`;
}

const unit = generated(1, "assault");
const artillery = generated(1, "artillery");
const { generated: _record, ...handBuilt } = unit;

function moduleOf(project: LegoProject, slot: string) {
  const entry = project.generated?.modules.find((m) => m.slot === slot);
  const instance = entry?.instance;
  const pieces = project.pieces.filter((p) => p.module?.instance === instance);
  const top = pieces.find(
    (p) => !pieces.some((q) => q.id === p.parentId),
  ) as LegoPiece;
  return { entry, pieces, top };
}

function categoryOf(id: string) {
  return modules.find((m) => m.id === id)?.category;
}

const partPiece = (project: LegoProject) =>
  project.pieces.find(
    (p) => p.partId && !p.module && p.id !== project.rootPieceId,
  ) as LegoPiece;

describe("what can be rerolled", () => {
  it("is refused for a part with nothing else of its shape and colour", () => {
    const mixed = pack.parts.find((p) => p.category === "mixed");
    if (!mixed) throw new Error("the bundled pack has no mixed part");
    const piece = partPiece(unit);
    const odd: LegoProject = {
      ...unit,
      pieces: unit.pieces.map((p) =>
        p.id === piece.id ? { ...p, partId: mixed.id } : p,
      ),
    };
    expect(rerollRefusal(odd, pack, piece.id, modules)).not.toBeNull();
    expect(rerollRefusal(unit, pack, piece.id, modules)).toBeNull();
  });

  it("is refused for a turret that has no other and nothing to roll", () => {
    const { top } = moduleOf(unit, "weapon.1");
    expect(rerollRefusal(unit, pack, top.id, modules)).toContain("Turret");
    const rolled = moduleOf(artillery, "weapon.1").top;
    expect(rerollRefusal(artillery, pack, rolled.id, modules)).toBeNull();
  });

  it("is nothing for a module that holds an imported mesh", () => {
    const { pieces, top } = moduleOf(unit, "chassis.1");
    const meshed: LegoProject = {
      ...unit,
      pieces: unit.pieces.map((p) =>
        p.id === pieces[pieces.length - 1].id ? { ...p, meshId: "m" } : p,
      ),
    };
    expect(rerollKind(meshed, top.id)).toBeNull();
  });

  it("is a module piece as a module and a pack part as a part", () => {
    const { top } = moduleOf(unit, "chassis.1");
    expect(rerollKind(unit, top.id)).toBe("module");
    expect(rerollKind(unit, partPiece(unit).id)).toBe("part");
  });

  it("is nothing for an empty piece or a missing one", () => {
    const empty = unit.pieces.find((p) => !p.partId && !p.module) as LegoPiece;
    expect(rerollKind(unit, empty.id)).toBeNull();
    expect(rerollKind(unit, "nope")).toBeNull();
    const result = rerollPart(unit, pack, empty.id, { modules });
    expect(result.status).toBe("failed");
  });
});

describe("rerolling a module", () => {
  it("puts in another module of the same category", () => {
    const { top, entry } = moduleOf(unit, "chassis.1");
    const result = rerollPart(unit, pack, top.id, {
      modules,
      newId: counter(),
    });
    if (result.status !== "ok") throw new Error(result.message);
    expect(result.kind).toBe("module");
    const now = result.project.generated?.modules.find(
      (m) => m.slot === "chassis.1",
    );
    expect(now?.module).not.toBe(entry?.module);
    expect(categoryOf(now?.module as string)).toBe(
      categoryOf(entry?.module as string),
    );
    expect(categoryOf(now?.module as string)).toBe("Chassis");
    expect(now?.instance).not.toBe(entry?.instance);
    // Nothing of the old module is left, and the new one is in the unit.
    expect(
      result.project.pieces.some((p) => p.module?.instance === entry?.instance),
    ).toBe(false);
    expect(
      result.project.pieces.some((p) => p.module?.instance === now?.instance),
    ).toBe(true);
    expect(result.from).not.toBe(result.to);
  });

  it("keeps what hung on the module, with its role and its joins", () => {
    const { top } = moduleOf(unit, "chassis.1");
    const turret = moduleOf(unit, "weapon.1").top;
    const result = rerollPart(unit, pack, top.id, {
      modules,
      newId: counter(),
    });
    if (result.status !== "ok") throw new Error(result.message);
    const after = pieceById(result.project, turret.id) as LegoPiece;
    // The turret is a different module and stays, still joined by a face to a
    // piece of the new chassis.
    expect(after.module?.instance).toBe(turret.module?.instance);
    expect(after.role).toBe(turret.role);
    const parent = pieceById(result.project, after.parentId as string);
    const chassis = result.project.generated?.modules.find(
      (m) => m.slot === "chassis.1",
    );
    expect(parent?.module?.instance).toBe(chassis?.instance);
    expect(after.connection).toBeDefined();
    // The skeleton, the covering and the other module are all still there.
    for (const piece of unit.pieces) {
      if (piece.module?.instance === top.module?.instance) continue;
      expect(pieceById(result.project, piece.id)).toBeDefined();
    }
  });

  it("keeps the module's size over its own document", () => {
    const { top } = moduleOf(unit, "chassis.1");
    const module = modules.find((m) => m.id === top.module?.id) as LegoProject;
    const was =
      Math.abs(top.scale[0]) /
      Math.abs((pieceById(module, module.rootPieceId) as LegoPiece).scale[0]);
    const result = rerollPart(unit, pack, top.id, {
      modules,
      newId: counter(),
    });
    if (result.status !== "ok") throw new Error(result.message);
    const next = moduleOf(result.project, "chassis.1").top;
    // A module that was joined stays joined.
    expect(next.connection !== undefined).toBe(top.connection !== undefined);
    const to = modules.find((m) => m.id === next.module?.id) as LegoProject;
    const now =
      Math.abs(next.scale[0]) /
      Math.abs((pieceById(to, to.rootPieceId) as LegoPiece).scale[0]);
    expect(now).toBeCloseTo(was, 9);
  });

  it("rerolls a module from any of its pieces", () => {
    const { pieces, top } = moduleOf(artillery, "weapon.1");
    const inner = pieces.find((p) => p.id !== top.id) as LegoPiece;
    const result = rerollPart(artillery, pack, inner.id, { modules });
    expect(result.status).toBe("ok");
  });

  it("rolls a generated turret's size and barrel again, with one turret in the library", () => {
    const { top } = moduleOf(artillery, "weapon.1");
    const result = rerollPart(artillery, pack, top.id, {
      modules,
      newId: counter(),
    });
    if (result.status !== "ok") throw new Error(result.message);
    const next = moduleOf(result.project, "weapon.1");
    expect(next.top.module?.id).toBe(top.module?.id);
    expect(next.top.module?.instance).not.toBe(top.module?.instance);
    expect(next.top.scale).not.toEqual(top.scale);
    const barrel = (project: LegoProject) =>
      moduleOf(project, "weapon.1").pieces.find((p) => p.role === "barrel");
    expect(barrel(result.project)?.scale[1]).not.toBe(
      barrel(artillery)?.scale[1],
    );
  });

  it("fails on a turret whose job rolls nothing, with one turret in the library", () => {
    const { top } = moduleOf(unit, "weapon.1");
    const result = rerollPart(unit, pack, top.id, { modules });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("Turret");
  });

  it("works on a unit that was not generated", () => {
    const hull = unit.pieces.find(
      (p) => p.module?.id === moduleOf(unit, "chassis.1").top.module?.id,
    ) as LegoPiece;
    const result = rerollPart(handBuilt, pack, hull.id, {
      modules,
      newId: counter(),
    });
    if (result.status !== "ok") throw new Error(result.message);
    expect(result.project.generated).toBeUndefined();
    expect(modules.find((m) => m.name === result.to)?.category).toBe("Chassis");
  });

  it("fails on a module with no other of its category and nothing to roll", () => {
    const { top } = moduleOf(unit, "weapon.1");
    const result = rerollPart(handBuilt, pack, top.id, {
      modules: modules.filter((m) => m.category === "Turret"),
      newId: counter(),
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("Turret");
  });

  it("fails on a module missing from the library", () => {
    const { top } = moduleOf(unit, "chassis.1");
    const result = rerollPart(unit, pack, top.id, { modules: [] });
    expect(result.status).toBe("failed");
  });
});

describe("rerolling a plain part", () => {
  const piece = partPiece(unit);
  const current = pack.byId.get(piece.partId as string);

  it("stays in the part's shape family, colour and size", () => {
    if (!current) throw new Error("no part");
    const result = rerollPart(unit, pack, piece.id, { modules });
    if (result.status !== "ok") throw new Error(result.message);
    expect(result.kind).toBe("part");
    const after = pieceById(result.project, piece.id) as LegoPiece;
    const part = pack.byId.get(after.partId as string);
    expect(part?.id).not.toBe(current.id);
    expect(part?.shape).toBe(current.shape);
    expect(part?.category).toBe(current.category);
    expect(part?.colourway).toBe(current.colourway);
    expect(part?.tags.filter((t) => !t.startsWith("row")).sort()).toEqual(
      current.tags.filter((t) => !t.startsWith("row")).sort(),
    );
  });

  it("offers only parts of that family, whatever the seed", () => {
    if (!current) throw new Error("no part");
    const family = new Set(partFamily(pack, current).map((p) => p.id));
    expect(family.size).toBeGreaterThan(0);
    expect(family.has(current.id)).toBe(false);
    for (const seed of [-5, 0, 1, 2, 3, 1000, 999999]) {
      const result = rerollPart(unit, pack, piece.id, { modules, seed });
      if (result.status !== "ok") throw new Error(result.message);
      const after = pieceById(result.project, piece.id) as LegoPiece;
      expect(family.has(after.partId as string)).toBe(true);
    }
  });

  it("widens to the shape and colour when no part has the same size", () => {
    const lone = pack.parts.find(
      (p) =>
        p.shape === "plate" && p.category === "grey" && p.tags.includes("tiny"),
    );
    if (!lone) throw new Error("the bundled pack has no tiny grey plate");
    const family = partFamily(pack, lone);
    expect(family.length).toBeGreaterThan(0);
    expect(
      family.every((p) => p.shape === "plate" && p.category === "grey"),
    ).toBe(true);
    expect(family.some((p) => p.tags.includes("tiny"))).toBe(false);
    const piece = partPiece(unit);
    const onLone: LegoProject = {
      ...unit,
      pieces: unit.pieces.map((p) =>
        p.id === piece.id ? { ...p, partId: lone.id } : p,
      ),
    };
    const result = rerollPart(onLone, pack, piece.id, { modules });
    if (result.status !== "ok") throw new Error(result.message);
    const part = pack.byId.get(
      pieceById(result.project, piece.id)?.partId as string,
    );
    expect(part?.id).not.toBe(lone.id);
    expect(part?.shape).toBe("plate");
    expect(part?.category).toBe("grey");
  });

  it("keeps the piece's place, children, role and connection", () => {
    const withChild: LegoProject = {
      ...unit,
      pieces: [
        ...unit.pieces,
        {
          id: "kid",
          name: "kid",
          parentId: piece.id,
          partId: current?.id ?? null,
          position: [0, 1, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          role: "wing",
        },
      ],
    };
    const owner = { ...piece, role: "armour" } as LegoPiece;
    const start: LegoProject = {
      ...withChild,
      pieces: withChild.pieces.map((p) => (p.id === piece.id ? owner : p)),
    };
    const result = rerollPart(start, pack, piece.id, { modules });
    if (result.status !== "ok") throw new Error(result.message);
    const after = pieceById(result.project, piece.id) as LegoPiece;
    expect(after.role).toBe("armour");
    expect(after.parentId).toBe(owner.parentId);
    expect(after.name).toBe(owner.name);
    expect(after.position).toEqual(owner.position);
    expect(after.rotation).toEqual(owner.rotation);
    expect(after.scale).toEqual(owner.scale);
    expect(after.connection).toEqual(owner.connection);
    expect(childrenOf(result.project, piece.id).map((p) => p.id)).toEqual(
      childrenOf(start, piece.id).map((p) => p.id),
    );
    expect(pieceById(result.project, "kid")?.role).toBe("wing");
    expect(result.project.pieces.length).toBe(start.pieces.length);
  });

  it("works on a unit that was not generated", () => {
    const result = rerollPart(handBuilt, pack, piece.id, { modules });
    expect(result.status).toBe("ok");
  });

  it("fails on a part with no other of its shape and colour", () => {
    const mixed = pack.parts.find((p) => p.category === "mixed");
    if (!mixed) throw new Error("the bundled pack has no mixed part");
    const odd: LegoProject = {
      ...unit,
      pieces: unit.pieces.map((p) =>
        p.id === piece.id ? { ...p, partId: mixed.id } : p,
      ),
    };
    const result = rerollPart(odd, pack, piece.id, { modules });
    expect(result.status).toBe("failed");
  });
});

describe("the seed", () => {
  it("is recorded on the part and survives saving", () => {
    const piece = partPiece(unit);
    const result = rerollPart(unit, pack, piece.id, { modules });
    if (result.status !== "ok") throw new Error(result.message);
    expect(rerolledSeed(result.project, piece.id)).toBe(result.seed);
    const reloaded = parseLegoProjectJson(JSON.stringify(result.project));
    expect(reloaded && rerolledSeed(reloaded, piece.id)).toBe(result.seed);
  });

  it("is recorded on the top of a module and found from any of its pieces", () => {
    const { top } = moduleOf(unit, "chassis.1");
    const result = rerollPart(unit, pack, top.id, {
      modules,
      newId: counter(),
    });
    if (result.status !== "ok") throw new Error(result.message);
    const next = moduleOf(result.project, "chassis.1");
    expect(next.top.rerolled?.seed).toBe(result.seed);
    for (const piece of next.pieces) {
      expect(rerolledSeed(result.project, piece.id)).toBe(result.seed);
    }
  });

  it("starts after the unit's seed, then after the piece's last", () => {
    const piece = partPiece(unit);
    const first = rerollPart(unit, pack, piece.id, { modules });
    if (first.status !== "ok") throw new Error(first.message);
    expect(first.seed).toBeGreaterThan(unit.generated?.seed ?? 0);
    const second = rerollPart(first.project, pack, piece.id, { modules });
    if (second.status !== "ok") throw new Error(second.message);
    expect(second.seed).toBeGreaterThan(first.seed);
  });

  it("makes the same part again from the seed it shows, for a part", () => {
    const piece = partPiece(unit);
    const first = rerollPart(unit, pack, piece.id, { modules });
    if (first.status !== "ok") throw new Error(first.message);
    const again = rerollPart(unit, pack, piece.id, {
      modules,
      seed: first.seed,
    });
    if (again.status !== "ok") throw new Error(again.message);
    expect(again.seed).toBe(first.seed);
    expect(JSON.stringify(again.project)).toBe(JSON.stringify(first.project));
  });

  it("makes the same module again from the seed it shows", () => {
    const { top } = moduleOf(unit, "chassis.1");
    const first = rerollPart(unit, pack, top.id, {
      modules,
      newId: counter(),
    });
    if (first.status !== "ok") throw new Error(first.message);
    const again = rerollPart(unit, pack, top.id, {
      modules,
      seed: first.seed,
      newId: counter(),
    });
    if (again.status !== "ok") throw new Error(again.message);
    expect(again.seed).toBe(first.seed);
    expect(JSON.stringify(again.project)).toBe(JSON.stringify(first.project));
  });

  it("makes the same part from the shown seed on a unit already rerolled", () => {
    const piece = partPiece(unit);
    const first = rerollPart(unit, pack, piece.id, { modules });
    if (first.status !== "ok") throw new Error(first.message);
    const second = rerollPart(first.project, pack, piece.id, { modules });
    if (second.status !== "ok") throw new Error(second.message);
    // Asking for the first seed on the unit as the second left it still draws
    // the first part, since the draw does not depend on the piece.
    const back = rerollPart(second.project, pack, piece.id, {
      modules,
      seed: first.seed,
    });
    if (back.status !== "ok") throw new Error(back.message);
    expect(pieceById(back.project, piece.id)?.partId).toBe(
      pieceById(first.project, piece.id)?.partId,
    );
  });
});

describe("repeating and undoing", () => {
  it("is one undo step per reroll, in order", () => {
    const piece = partPiece(unit);
    const { top } = moduleOf(unit, "chassis.1");
    let doc = reduceDocument(emptyDocument, { type: "open", project: unit });
    const states: LegoProject[] = [unit];
    const steps = [piece.id, top.id, piece.id, top.id];
    steps.forEach((id, n) => {
      doc = reduceDocument(doc, {
        type: "edit",
        change: (project) => {
          const target =
            pieceById(project, id) ?? moduleOf(project, "chassis.1").top;
          const result = rerollPart(project, pack, target.id, {
            modules,
            newId: counter(),
          });
          return result.status === "ok" ? result.project : project;
        },
        at: 1000 * (n + 1),
        alone: true,
      });
      states.push(doc.project as LegoProject);
    });
    for (let n = 1; n < states.length; n++) {
      expect(states[n]).not.toBe(states[n - 1]);
    }
    for (let n = states.length - 2; n >= 0; n--) {
      doc = reduceDocument(doc, { type: "undo" });
      expect(doc.project).toBe(states[n]);
    }
  });
});

describe("a unit rerolled whole afterwards", () => {
  it("keeps the module that was rerolled", () => {
    const { top } = moduleOf(unit, "chassis.1");
    const part = rerollPart(unit, pack, top.id, { modules, newId: counter() });
    if (part.status !== "ok") throw new Error(part.message);
    const chosen = part.project.generated?.modules.find(
      (m) => m.slot === "chassis.1",
    );
    const whole = rerollUnit(part.project, { pack, modules });
    if (whole.status !== "ok") throw new Error(whole.message);
    const after = whole.unit.generated?.modules.find(
      (m) => m.slot === "chassis.1",
    );
    expect(after?.module).toBe(chosen?.module);
    expect(after?.instance).toBe(chosen?.instance);
  });

  it("keeps the part that was rerolled", () => {
    const piece = partPiece(unit);
    const part = rerollPart(unit, pack, piece.id, { modules });
    if (part.status !== "ok") throw new Error(part.message);
    const chosen = pieceById(part.project, piece.id)?.partId;
    const whole = rerollUnit(part.project, { pack, modules });
    if (whole.status !== "ok") throw new Error(whole.message);
    expect(pieceById(whole.unit, piece.id)?.partId).toBe(chosen);
  });
});
