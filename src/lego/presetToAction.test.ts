import { describe, expect, it } from "vitest";

import {
  type AnimPreset,
  legRoleIds,
  PRESETS,
  presetById,
  WALK_PAIRS,
} from "./animPresets";
import { reduceDocument } from "./document";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import {
  conversionProblem,
  convertedActionId,
  convertPresetToAction,
} from "./presetToAction";
import { fitWalk } from "./walkFit";

const FPS = 30;
/** When the call-in that starts the motion fires. */
const CALLIN = 15;

/** The presets that convert. Every other one says why it does not. */
const CONVERTIBLE = [
  "walk.biped",
  "walk.quad",
  "walk.legs",
  "buildarm",
  "open.close",
  "hover.bob",
  "recoil",
];

/** The call-in that starts each convertible preset's motion. */
const STARTS: Record<string, string> = {
  "walk.biped": "StartMoving",
  "walk.quad": "StartMoving",
  "walk.legs": "StartMoving",
  buildarm: "StartBuilding",
  "open.close": "Activate",
  "hover.bob": "Create",
  recoil: "Shot1",
};

function piece(role: string, extra: Partial<LegoPiece> = {}): LegoPiece {
  return {
    id: role,
    name: role === "base" ? "body" : role.replace(/\./g, "_"),
    parentId: "root",
    partId: "x",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role,
    ...extra,
  };
}

/** One piece per role the preset moves or needs, named after the role, with
 *  the preset applied. */
function unitFor(
  preset: AnimPreset,
  params: Record<string, number> = {},
  more: LegoPiece[] = [],
): LegoProject {
  const moved = preset.moves ? legRoleIds(3) : preset.animates;
  const roles = [
    ...new Set([...moved, ...preset.requires.map((need) => need.role)]),
  ];
  const base = newProject({
    id: "convert",
    rootPieceId: "root",
    name: "convert",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  return {
    ...base,
    pieces: [...base.pieces, ...roles.map((role) => piece(role)), ...more],
    animations: [{ presetId: preset.id, params }],
  };
}

// --- A frame by frame player for the scripts these write. -------------------
//
// The threads a cycle preset and an action write are straight runs of Turn,
// Move, Sleep and WaitForMove, in a call-in or in a thread it starts, with at
// most one `while true` loop. This plays exactly that: each frame a piece
// moves by its speed over 30 toward where it was sent, as the engine and the
// preview runtime both move it. Both scripts are played by the same rules, so
// what is compared is what each writes.

type Op =
  | { op: "go"; key: string; to: number; speed: number | null }
  | { op: "sleep"; frames: number }
  | { op: "wait"; key: string }
  | { op: "start"; name: string };

interface Body {
  lead: Op[];
  loop: Op[];
}

const CALL =
  /^\s*(Turn|Move|ActTurn|ActMove)\((\w+), ([xyz])_axis, (-?[\d.e-]+)(?:, (-?[\d.e-]+))?\)$/;

function parseBody(lines: string[]): Body {
  const body: Body = { lead: [], loop: [] };
  let into = body.lead;
  for (const line of lines) {
    if (line === "  while true do") {
      into = body.loop;
      continue;
    }
    const call = CALL.exec(line);
    if (call) {
      const kind = call[1].endsWith("Turn") ? "turn" : "move";
      into.push({
        op: "go",
        key: `${call[2]}:${kind}:${call[3]}`,
        to: Number(call[4]),
        speed: call[5] === undefined ? null : Number(call[5]),
      });
      continue;
    }
    const sleep = /^\s*Sleep\((\d+)\)$/.exec(line);
    if (sleep) {
      into.push({ op: "sleep", frames: Math.floor(Number(sleep[1]) / 33) });
      continue;
    }
    const wait = /^\s*WaitForMove\((\w+), ([xyz])_axis\)$/.exec(line);
    if (wait) {
      into.push({ op: "wait", key: `${wait[1]}:move:${wait[2]}` });
      continue;
    }
    const start = /^\s*StartThread\((\w+)\)$/.exec(line);
    if (start) into.push({ op: "start", name: start[1] });
  }
  return body;
}

/** The lines of a function the script defines, by how its first line starts. */
function functionLines(script: string, opener: string): string[] {
  const lines = script.split("\n");
  const from = lines.findIndex((line) => line.startsWith(opener));
  if (from < 0) return [];
  const to = lines.findIndex((line, at) => at > from && line === "end");
  return lines.slice(from + 1, to);
}

interface Channel {
  at: number;
  to: number;
  speed: number;
}

/**
 * Where every channel is on each frame, keyed `piece:turn|move:axis`, with the
 * call-in fired at each frame in `calls`.
 */
function play(
  script: string,
  calls: { frame: number; hook: string }[],
  frames: number,
): Map<string, number[]> {
  const channels = new Map<string, Channel>();
  const series = new Map<string, number[]>();
  interface Thread {
    body: Body;
    inLoop: boolean;
    pc: number;
    wake: number;
    waiting?: string;
  }
  const threads: Thread[] = [];
  const spawn = (lines: string[], frame: number) =>
    threads.push({ body: parseBody(lines), inLoop: false, pc: 0, wake: frame });

  for (let frame = 0; frame < frames; frame++) {
    for (const call of calls.filter((c) => c.frame === frame)) {
      spawn(functionLines(script, `function script.${call.hook}(`), frame);
    }
    for (let index = 0; index < threads.length; index++) {
      const thread = threads[index];
      if (thread.wake > frame) continue;
      if (thread.waiting) {
        const channel = channels.get(thread.waiting);
        if (channel && channel.at !== channel.to) continue;
        thread.waiting = undefined;
      }
      for (let guard = 0; guard < 10000; guard++) {
        const ops = thread.inLoop ? thread.body.loop : thread.body.lead;
        if (thread.pc >= ops.length) {
          if (thread.body.loop.length === 0) {
            thread.wake = Number.POSITIVE_INFINITY;
            break;
          }
          thread.inLoop = true;
          thread.pc = 0;
          continue;
        }
        const op = ops[thread.pc++];
        if (op.op === "go") {
          const channel = channels.get(op.key) ?? { at: 0, to: 0, speed: 0 };
          channel.to = op.to;
          if (op.speed === null) {
            channel.at = op.to;
            channel.speed = 0;
          } else {
            channel.speed = op.speed;
          }
          channels.set(op.key, channel);
        } else if (op.op === "sleep") {
          thread.wake = frame + op.frames;
          break;
        } else if (op.op === "wait") {
          thread.waiting = op.key;
          thread.wake = frame + 1;
          break;
        } else {
          spawn(functionLines(script, `local function ${op.name}()`), frame);
        }
      }
    }
    for (const [key, channel] of channels) {
      const step = channel.speed / FPS;
      const gap = channel.to - channel.at;
      channel.at =
        Math.abs(gap) <= step ? channel.to : channel.at + Math.sign(gap) * step;
      const values = series.get(key) ?? Array(frame).fill(0);
      values.push(channel.at);
      series.set(key, values);
    }
  }
  return series;
}

/** The preset's script and the converted unit's script, played side by side. */
function sideBySide(
  project: LegoProject,
  calls: { frame: number; hook: string }[],
  frames: number,
) {
  const converted = convertPresetToAction(
    project,
    project.animations?.[0]?.presetId ?? "",
    "conv",
  );
  return {
    converted,
    preset: play(buildLuaScript(project), calls, frames),
    action: play(buildLuaScript(converted), calls, frames),
  };
}

/** The furthest apart the two plays are over frames `from` to `to`, on every
 *  channel either moves. Neither moving anything is a failure of its own. */
function furthestApart(
  preset: Map<string, number[]>,
  action: Map<string, number[]>,
  from: number,
  to: number,
): number {
  const keys = new Set([...preset.keys(), ...action.keys()]);
  expect(keys.size).toBeGreaterThan(0);
  let worst = 0;
  for (const key of keys) {
    for (let frame = from; frame <= to; frame++) {
      const a = preset.get(key)?.[frame] ?? 0;
      const b = action.get(key)?.[frame] ?? 0;
      worst = Math.max(worst, Math.abs(a - b));
    }
  }
  return worst;
}

/** Frames in one cycle of a cycle preset. */
function lapOf(preset: AnimPreset, params: Record<string, number>): number {
  const period =
    params.period ??
    preset.params.find((entry) => entry.id === "period")?.fallback ??
    1;
  return Math.round(Math.max(period, 0.05) * FPS);
}

/** Defaults, every timing at its lowest and every param at its highest. */
function paramSets(preset: AnimPreset): Record<string, number>[] {
  const timing = new Set(["s", "hz", "deg/s"]);
  return [
    {},
    Object.fromEntries(
      preset.params
        .filter((entry) => timing.has(entry.unit))
        .map((entry) => [entry.id, entry.min]),
    ),
    Object.fromEntries(preset.params.map((entry) => [entry.id, entry.max])),
  ].map((params) =>
    preset.id === "walk.legs" ? { ...params, [WALK_PAIRS]: 3 } : params,
  );
}

describe("which presets convert", () => {
  it("converts the presets written as fixed poses, and gives every other one a reason", () => {
    const converts = PRESETS.filter(
      (preset) => typeof preset.motions !== "string",
    ).map((preset) => preset.id);
    expect(converts).toEqual(CONVERTIBLE);
    for (const preset of PRESETS) {
      if (typeof preset.motions === "string") {
        expect(preset.motions.length).toBeGreaterThan(0);
        expect(conversionProblem(unitFor(preset), preset.id)).toBe(
          preset.motions,
        );
      } else {
        expect(conversionProblem(unitFor(preset), preset.id)).toBeNull();
      }
    }
  });

  it("says why a preset whose pieces are gone cannot convert", () => {
    const preset = presetById("buildarm") as AnimPreset;
    const unit = {
      ...unitFor(preset),
      pieces: unitFor(preset).pieces.slice(0, 1),
    };
    expect(conversionProblem(unit, "buildarm")).toBe(
      "This unit has none of the pieces it moves.",
    );
    expect(convertPresetToAction(unit, "buildarm", "x")).toBe(unit);
  });

  it("does not convert on a unit with loadouts, whose actions every loadout shares", () => {
    const preset = presetById("buildarm") as AnimPreset;
    const unit: LegoProject = {
      ...unitFor(preset),
      loadouts: [
        { id: "a", name: "A" },
        { id: "b", name: "B", content: { animations: [], pieces: [] } },
      ],
      activeLoadout: "a",
    };
    expect(conversionProblem(unit, "buildarm")).toMatch(/every loadout/);
  });
});

describe("a converted cycle preset plays the preset's own cycle", () => {
  const cycles = CONVERTIBLE.filter((id) => id !== "recoil");
  for (const id of cycles) {
    const preset = presetById(id) as AnimPreset;
    paramSets(preset).forEach((params, set) => {
      it(`${id}, param set ${set + 1}`, () => {
        const lap = lapOf(preset, params);
        const callin = STARTS[id] === "Create" ? 0 : CALLIN;
        const calls = [
          ...(STARTS[id] === "Create" ? [] : [{ frame: 0, hook: "Create" }]),
          { frame: callin, hook: STARTS[id] },
        ];
        const frames = callin + 3 * lap + 1;
        const {
          converted,
          preset: was,
          action,
        } = sideBySide(unitFor(preset, params), calls, frames);
        expect(converted.animations).toEqual([]);
        expect(converted.actions?.[0]).toMatchObject({
          trigger: STARTS[id],
          loop: true,
        });
        // The first lap starts from rest, where the preset heads for its
        // second pose at the speed it uses from its first. Every lap after it
        // is the same.
        expect(
          furthestApart(was, action, callin + lap, callin + 2 * lap),
        ).toBeLessThan(1e-9);
      });
    });
  }

  it("lowers the body of a fitted walk the drop the walk lowers it by", () => {
    const preset = presetById("walk.biped") as AnimPreset;
    const params = fitWalk(
      {
        legLength: 18.8,
        speed: 45,
        thighLength: 18.8 * 0.395,
        shinLength: 18.8 * (1 - 0.395),
      },
      {},
    );
    const unit = unitFor(preset, params, [piece("base")]);
    const lap = lapOf(preset, params);
    const frames = CALLIN + 3 * lap + 1;
    const { preset: was, action } = sideBySide(
      unit,
      [
        { frame: 0, hook: "Create" },
        { frame: CALLIN, hook: "StartMoving" },
      ],
      frames,
    );
    expect(was.get("body:move:y")?.at(-1)).toBeLessThan(0);
    expect(
      furthestApart(was, action, CALLIN + lap, CALLIN + 2 * lap),
    ).toBeLessThan(1e-9);
  });

  it("writes one action per set of legs, each with its own settings", () => {
    const preset = presetById("walk.biped") as AnimPreset;
    const legs = (instance: string) =>
      preset.animates.map((role) =>
        piece(role, {
          id: `${instance}-${role}`,
          name: `${instance}_${role.replace(/\./g, "_")}`,
          module: { id: "legs", instance },
        } as Partial<LegoPiece>),
      );
    const base = unitFor(preset);
    const unit: LegoProject = {
      ...base,
      pieces: [base.pieces[0], ...legs("a"), ...legs("b")],
      animations: [
        { presetId: preset.id, params: {}, instances: { b: { period: 2 } } },
      ],
    };
    const converted = convertPresetToAction(unit, preset.id, "conv");
    expect(converted.actions?.map((action) => action.name)).toEqual([
      "Walk, two legs 1",
      "Walk, two legs 2",
    ]);
    const frames = CALLIN + 3 * 60 + 1;
    const calls = [
      { frame: 0, hook: "Create" },
      { frame: CALLIN, hook: "StartMoving" },
    ];
    const was = play(buildLuaScript(unit), calls, frames);
    const action = play(buildLuaScript(converted), calls, frames);
    // The slower set's cycle is 60 frames, and both are compared over it.
    expect(furthestApart(was, action, CALLIN + 60, CALLIN + 120)).toBeLessThan(
      1e-9,
    );
  });
});

describe("converted recoil kicks as the preset kicks", () => {
  const preset = presetById("recoil") as AnimPreset;
  paramSets(preset).forEach((params, set) => {
    it(`param set ${set + 1}, with a flare beside the barrel`, () => {
      const unit = unitFor(preset, params, [piece("flare")]);
      const value = (id: string) =>
        params[id] ??
        preset.params.find((entry) => entry.id === id)?.fallback ??
        0;
      const kick = value("kick");
      const kickTime = Math.max(value("kickTime"), 0.01);
      const returnTime = Math.max(value("returnTime"), 0.01);
      const cycle = Math.ceil((kickTime + returnTime) * FPS) + 2;
      const frames = CALLIN + 2 * cycle + 1;
      const {
        converted,
        preset: was,
        action,
      } = sideBySide(
        unit,
        [
          { frame: 0, hook: "Create" },
          { frame: CALLIN, hook: "Shot1" },
          { frame: CALLIN + cycle, hook: "Shot1" },
        ],
        frames,
      );
      expect(converted.actions?.[0]).toMatchObject({
        trigger: "Shot1",
        loop: false,
      });
      expect(was.get("flare:move:z")).toBeDefined();
      // The script waits for the kick to land and the action waits whole
      // frames, so they can be a frame of the faster move apart.
      const frame = Math.max(kick / kickTime, kick / returnTime) / FPS;
      expect(
        furthestApart(was, action, CALLIN, frames - 1),
      ).toBeLessThanOrEqual(frame + 1e-4);
      // And both are home at the end of each shot.
      for (const at of [CALLIN + cycle - 1, frames - 1]) {
        expect(action.get("body_barrel:move:z")?.[at] ?? 0).toBe(0);
      }
    });
  });
});

describe("converting as an edit", () => {
  it("is one step that undo takes back, putting the preset back", () => {
    const preset = presetById("open.close") as AnimPreset;
    const unit = unitFor(preset, { period: 3 });
    let doc = reduceDocument(
      {
        project: null,
        past: [],
        future: [],
        dirty: false,
        editedAt: 0,
        selectedIds: [],
      },
      { type: "open", project: unit },
    );
    doc = reduceDocument(doc, {
      type: "edit",
      change: (p) => convertPresetToAction(p, preset.id, "conv"),
      at: 1000,
    });
    expect(doc.project?.animations).toEqual([]);
    expect(doc.project?.actions?.[0]?.id).toBe(convertedActionId("conv", 1));
    expect(doc.project?.poses?.length).toBeGreaterThan(0);
    doc = reduceDocument(doc, { type: "undo" });
    expect(doc.project).toBe(unit);
    expect(doc.project?.animations).toEqual([
      { presetId: preset.id, params: { period: 3 } },
    ]);
  });

  it("gives the same result each time it runs, so a replayed edit agrees", () => {
    const preset = presetById("hover.bob") as AnimPreset;
    const unit = unitFor(preset);
    expect(convertPresetToAction(unit, preset.id, "a")).toEqual(
      convertPresetToAction(unit, preset.id, "a"),
    );
  });

  it("keeps a converted action from easing in on a unit that blends", () => {
    const preset = presetById("buildarm") as AnimPreset;
    const unit = { ...unitFor(preset), actionBlend: 0.5 };
    const action = convertPresetToAction(unit, preset.id, "conv").actions?.[0];
    expect(action).toMatchObject({ blendIn: 0, blendOut: 0 });
  });

  it("keeps the unit's other presets and its own poses and actions", () => {
    const preset = presetById("hover.bob") as AnimPreset;
    const base = unitFor(preset);
    const unit: LegoProject = {
      ...base,
      animations: [
        ...(base.animations ?? []),
        { presetId: "recoil", params: {} },
      ],
      poses: [{ id: "mine", name: "Mine", pieces: {} }],
      actions: [
        { id: "own", name: "Own", trigger: "Create", loop: false, keys: [] },
      ],
    };
    const converted = convertPresetToAction(unit, preset.id, "conv");
    expect(converted.animations).toEqual([{ presetId: "recoil", params: {} }]);
    expect(converted.poses?.[0]?.id).toBe("mine");
    expect(converted.actions?.map((a) => a.id)).toEqual([
      "own",
      convertedActionId("conv", 1),
    ]);
  });
});
