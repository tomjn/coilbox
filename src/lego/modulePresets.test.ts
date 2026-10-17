import { describe, expect, it } from "vitest";

import { parseClipboardPiece, serializeClipboardPiece } from "./clipboard";
import {
  duplicatePiece,
  insertCompound,
  selectionAsCompound,
} from "./compounds";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { insertModule } from "./moduleMount";

function project(
  pieces: Partial<LegoPiece>[],
  extra: Partial<LegoProject> = {},
): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    ...extra,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: null,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

const options = () => ({
  id: "module",
  now: "2026-10-17T00:00:00Z",
  newId: counter("m"),
});

const TURRET_PIECES: Partial<LegoPiece>[] = [
  { id: "turret", name: "turret", role: "turret" },
  { id: "barrel", name: "barrel", parentId: "turret", role: "barrel" },
  { id: "flare", name: "flare", parentId: "barrel", role: "flare" },
];

/** A unit with a turret, its sweep set to 4 seconds and recoil applied. */
const GUN_UNIT = project(TURRET_PIECES, {
  animations: [
    { presetId: "turret.track", params: { period: 4 } },
    { presetId: "recoil", params: {} },
    { presetId: "walk.biped", params: {} },
  ],
});

describe("selectionAsCompound presets", () => {
  it("records the presets that move the pieces it carries, with their parameters", () => {
    const module = selectionAsCompound(GUN_UNIT, ["turret"], options());
    expect(module?.animations).toEqual([
      { presetId: "turret.track", params: { period: 4 } },
      { presetId: "recoil", params: {} },
    ]);
  });

  it("takes a preset that animates any role the selection carries", () => {
    const module = selectionAsCompound(GUN_UNIT, ["barrel"], options());
    expect(module?.animations?.map((a) => a.presetId)).toEqual([
      "turret.track",
      "recoil",
    ]);
  });

  it("writes no animations key when nothing travels", () => {
    const module = selectionAsCompound(GUN_UNIT, ["flare"], options());
    expect(module).not.toHaveProperty("animations");
  });

  it("carries a preset that moves nothing but needs a role the module has", () => {
    const unit = project(
      [{ id: "nano", name: "nano", role: "buildarm.nano" }],
      { animations: [{ presetId: "build.nano", params: {} }] },
    );
    const module = selectionAsCompound(unit, ["nano"], options());
    expect(module?.animations?.map((a) => a.presetId)).toEqual(["build.nano"]);
  });

  it("copies the builder block only with a build preset", () => {
    const builder = { workerTime: 120 };
    const arm = project([{ id: "arm", name: "arm", role: "buildarm.arm" }], {
      builder,
      animations: [{ presetId: "buildarm", params: {} }],
    });
    expect(selectionAsCompound(arm, ["arm"], options())?.builder).toEqual(
      builder,
    );
    const gun = { ...GUN_UNIT, builder };
    expect(selectionAsCompound(gun, ["turret"], options())).not.toHaveProperty(
      "builder",
    );
  });

  it("does not share parameter objects with the unit", () => {
    const module = selectionAsCompound(GUN_UNIT, ["turret"], options());
    const first = module?.animations?.[0];
    expect(first?.params).toEqual({ period: 4 });
    expect(first?.params).not.toBe(GUN_UNIT.animations?.[0]?.params);
  });
});

describe("insertCompound presets", () => {
  const module = selectionAsCompound(
    GUN_UNIT,
    ["turret"],
    options(),
  ) as LegoProject;

  it("adds the module's presets to a unit that has none", () => {
    const unit = project([]);
    const result = insertCompound(unit, module, "root", counter("n"));
    expect(result.project.animations).toEqual([
      { presetId: "turret.track", params: { period: 4 } },
      { presetId: "recoil", params: {} },
    ]);
    expect(result.presets.added).toEqual(["turret.track", "recoil"]);
    expect(result.presets.present).toEqual([]);
    expect(result.presets.held).toEqual([]);
  });

  it("keeps the unit's parameters and does not add a preset twice", () => {
    const unit = project([], {
      animations: [{ presetId: "turret.track", params: { period: 8 } }],
    });
    const result = insertCompound(unit, module, "root", counter("n"));
    expect(result.project.animations).toEqual([
      { presetId: "turret.track", params: { period: 8 } },
      { presetId: "recoil", params: {} },
    ]);
    expect(result.presets.present).toEqual(["turret.track"]);
    expect(result.presets.added).toEqual(["recoil"]);
  });

  it("inserting the same module twice adds each preset once", () => {
    const unit = project([]);
    const once = insertCompound(unit, module, "root", counter("a"));
    const twice = insertCompound(once.project, module, "root", counter("b"));
    expect(twice.project.animations).toHaveLength(2);
    expect(twice.presets.added).toEqual([]);
    expect(twice.presets.present).toEqual(["turret.track", "recoil"]);
  });

  it("holds back a preset whose requirements the unit still does not meet", () => {
    const leg = project(
      [
        { id: "thigh", name: "thigh", role: "leg.l1.thigh" },
        { id: "shin", name: "shin", parentId: "thigh", role: "leg.l1.shin" },
      ],
      { animations: [{ presetId: "walk.biped", params: { stride: 3 } }] },
    );
    const legModule = selectionAsCompound(
      leg,
      ["thigh"],
      options(),
    ) as LegoProject;
    const result = insertCompound(project([]), legModule, "root", counter("n"));
    expect(result.project.animations).toBeUndefined();
    expect(result.presets.held).toEqual([
      {
        presetId: "walk.biped",
        params: { stride: 3 },
        missing: ["leg.r1.thigh", "leg.r1.shin"],
      },
    ]);
  });

  it("adds a preset once the insert completes what it needs", () => {
    const leg = project(
      [
        { id: "thigh", name: "thigh", role: "leg.l1.thigh" },
        { id: "shin", name: "shin", parentId: "thigh", role: "leg.l1.shin" },
      ],
      { animations: [{ presetId: "walk.biped", params: {} }] },
    );
    const legModule = selectionAsCompound(
      leg,
      ["thigh"],
      options(),
    ) as LegoProject;
    const unit = project([
      { id: "rt", name: "rt", role: "leg.r1.thigh" },
      { id: "rs", name: "rs", parentId: "rt", role: "leg.r1.shin" },
    ]);
    const result = insertCompound(unit, legModule, "root", counter("n"));
    expect(result.presets.added).toEqual(["walk.biped"]);
  });

  it("gives the unit the module's builder block only when it has none", () => {
    const arm = project([{ id: "arm", name: "arm", role: "buildarm.arm" }], {
      builder: { workerTime: 120 },
      animations: [{ presetId: "buildarm", params: {} }],
    });
    const armModule = selectionAsCompound(
      arm,
      ["arm"],
      options(),
    ) as LegoProject;

    const bare = insertCompound(project([]), armModule, "root", counter("a"));
    expect(bare.project.builder).toEqual({ workerTime: 120 });
    expect(bare.presets.builderTaken).toBe(true);

    const owned = project([], { builder: { workerTime: 30 } });
    const kept = insertCompound(owned, armModule, "root", counter("b"));
    expect(kept.project.builder).toEqual({ workerTime: 30 });
    expect(kept.presets.builderTaken).toBe(false);
  });

  it("inserts a module saved before this change exactly as before", () => {
    const old = project(TURRET_PIECES);
    const result = insertCompound(project([]), old, "root", counter("n"));
    expect(result.project).not.toHaveProperty("animations");
    expect(result.project).not.toHaveProperty("builder");
    expect(result.presets).toEqual({
      added: [],
      present: [],
      held: [],
      builderTaken: false,
    });
  });

  it("travels through insertModule, which wraps it", () => {
    const result = insertModule(
      project([]),
      module,
      "root",
      counter("n"),
      null,
    );
    expect(result.project.animations?.map((a) => a.presetId)).toEqual([
      "turret.track",
      "recoil",
    ]);
    expect(result.presets.added).toEqual(["turret.track", "recoil"]);
  });
});

describe("presets across the clipboard", () => {
  it("survive a copy and paste between windows", () => {
    const lifted = selectionAsCompound(GUN_UNIT, ["turret"], options());
    const text = serializeClipboardPiece(lifted as LegoProject);
    const parsed = parseClipboardPiece(text, new Set());
    if (!parsed.ok) throw new Error(parsed.reason);
    const result = insertCompound(
      project([]),
      parsed.piece.project,
      "root",
      counter("n"),
    );
    expect(result.project.animations).toEqual([
      { presetId: "turret.track", params: { period: 4 } },
      { presetId: "recoil", params: {} },
    ]);
  });
});

describe("duplicate", () => {
  it("does not bring back a preset the maker removed from the unit", () => {
    const unit = project(TURRET_PIECES, { animations: [] });
    const result = duplicatePiece(unit, "turret", {
      now: "2026-10-17T00:00:00Z",
      newId: counter("d"),
    });
    expect(result?.project.animations).toEqual([]);
  });
});
