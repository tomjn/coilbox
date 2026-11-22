import { describe, expect, it } from "vitest";
import { action, track, tracked, trackUnits, unit } from "./actionFixtures";
import { emitActions, normaliseTracks, withTracks } from "./actions";
import { importScript, readActions } from "./importScript";
import { buildLuaScript } from "./luaScript";
import type { LegoAction, LegoProject } from "./model";

/**
 * Reading a script whose pieces arrive on different frames back into actions of
 * tracks (#5395). The scripts are the ones `emitActions` writes for the
 * fixtures `actionFixtures.ts` shares with the plan tests (#5394).
 */

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

/** What the unit's actions write, as `emitActions` prints it. */
function written(project: LegoProject): string {
  const e = emitActions(project, (p) => p.name);
  return [
    ...e.signals,
    ...e.functions,
    ...Object.entries(e.hooks).flatMap(([hook, lines]) => [
      `[${hook}]`,
      ...(lines ?? []),
    ]),
    ...e.own,
  ].join("\n");
}

/** The unit with no actions, which is what a script is read into. */
function bare(project: LegoProject): LegoProject {
  return { ...project, poses: undefined, actions: undefined };
}

/** The first action of the unit's script read back. */
function readBack(project: LegoProject) {
  const read = readActions(buildLuaScript(project), bare(project), ids());
  return { read, action: read?.actions[0] };
}

const FIXTURES = trackUnits();

/** The action's tracks, whether it was read as tracks or as pose keys. */
function tracksOfRead(
  project: LegoProject,
  read: ReturnType<typeof readActions>,
) {
  const into = { ...bare(project), poses: read?.poses, actions: read?.actions };
  const got = read?.actions[0] as LegoAction;
  return normaliseTracks(withTracks(got, into).tracks ?? [], got.loop);
}

describe("reading back what the builder writes for tracks", () => {
  // The one key action is a script of the old shape, so it still reads as a
  // pose key. Its tracks are the same.
  const asPoses = ["oneKey"];

  for (const [name, project] of Object.entries(FIXTURES)) {
    const original = project.actions?.[0] as LegoAction;

    it(`reads ${name} as the normalised tracks`, () => {
      const { read, action: got } = readBack(project);

      expect(got).toMatchObject({
        name: original.name,
        trigger: original.trigger,
        loop: original.loop,
      });
      expect(tracksOfRead(project, read)).toEqual(
        normaliseTracks(original.tracks ?? [], original.loop),
      );
      if (asPoses.includes(name)) {
        expect(got?.tracks).toBeUndefined();
        expect(read?.poses).toHaveLength(1);
      } else {
        expect(got?.keys).toEqual([]);
        expect(got?.tracks).toEqual(
          normaliseTracks(original.tracks ?? [], original.loop),
        );
        expect(read?.poses).toEqual([]);
      }
    });

    it(`writes ${name} the same from the normalised tracks as from the tracks`, () => {
      const normal = {
        ...project,
        actions: [
          {
            ...original,
            tracks: normaliseTracks(original.tracks ?? [], original.loop),
          },
        ],
      };
      expect(written(normal)).toBe(written(project));
    });

    it(`gives the script back when ${name} is imported`, () => {
      const lua = buildLuaScript(project);
      const result = importScript(bare(project), lua, { newId: ids() });

      expect(result.as).toBe("actions");
      expect(result.project.script).toBeUndefined();
      expect(buildLuaScript(result.project)).toBe(lua);
    });
  }
});

describe("reading a hand written script with pieces on different frames", () => {
  const WAVE = [
    'local arm, hatch = piece("arm", "hatch")',
    "local function wave()",
    "  Turn(arm, x_axis, -0.5, 1.5)",
    "  Move(hatch, y_axis, 3, 6)",
    "  Sleep(330)",
    "  Turn(arm, x_axis, 0, 1.5)",
    "  Sleep(165)",
    "  Move(hatch, y_axis, 0, 6)",
    "end",
    "function script.Shot1()",
    "  StartThread(wave)",
    "end",
  ].join("\n");

  it("reads a call after a sleep as a key at rest on its frame", () => {
    const lua = [
      'local arm, hatch = piece("arm", "hatch")',
      "local function nod()",
      "  Move(hatch, y_axis, 3, 4.5)",
      "  Sleep(330)",
      "  Turn(arm, x_axis, 1, 3)",
      "end",
      "function script.Shot1()",
      "  StartThread(nod)",
      "end",
    ].join("\n");

    const read = readActions(lua, bare(unit()), ids());

    expect(read?.actions[0].tracks).toEqual([
      track("arm", "turn", 0, [
        [10, 0],
        [20, 1],
      ]),
      track("hatch", "move", 1, [[20, 3]]),
    ]);
  });

  it("reads a channel that waits between two calls as a key that holds", () => {
    const lua = [
      'local arm, hatch = piece("arm", "hatch")',
      "local function nod()",
      "  Turn(arm, x_axis, 1, 3)",
      "  Move(hatch, y_axis, 3, 4.5)",
      "  Sleep(660)",
      "  Turn(arm, x_axis, 0, 3)",
      "end",
      "function script.Shot1()",
      "  StartThread(nod)",
      "end",
    ].join("\n");

    const read = readActions(lua, bare(unit()), ids());

    expect(read?.actions[0].tracks).toEqual([
      track("arm", "turn", 0, [
        [10, 1],
        [20, 1],
        [30, 0],
      ]),
      track("hatch", "move", 1, [[20, 3]]),
    ]);
  });

  it("reads speeds that arrive on frames of their own", () => {
    const read = readActions(WAVE, bare(unit()), ids());

    expect(read?.actions[0].tracks).toEqual([
      track("arm", "turn", 0, [
        [10, -0.5],
        [20, 0],
      ]),
      track("hatch", "move", 1, [
        [15, 3],
        [30, 0],
      ]),
    ]);
  });

  it("gives a loop that waits after its last key a key that holds at the end of its lap", () => {
    const project = tracked([
      track("arm", "turn", 0, [
        [10, 1],
        [20, 0],
        [30, 1],
        [40, 1],
      ]),
    ]);
    const { read, action: got } = readBack(project);

    expect(got?.tracks).toEqual(
      normaliseTracks((project.actions?.[0] as LegoAction).tracks ?? [], true),
    );
    expect(got?.tracks?.[0].keys.at(-1)).toEqual({ frame: 40, value: 1 });
    expect(read?.poses).toEqual([]);
  });
});

describe("a script that does not fit stays the unit's own", () => {
  /** A hatch that takes 20 frames and an arm that is called after 10, which
   *  the old shape cannot read, then the call under test. */
  const lone = (call: string) =>
    [
      'local arm, hatch = piece("arm", "hatch")',
      "local function nod()",
      "  Move(hatch, y_axis, 3, 4.5)",
      "  Sleep(330)",
      `  ${call}`,
      "end",
      "function script.Shot1()",
      "  StartThread(nod)",
      "end",
    ].join("\n");

  it("keeps an arrival that is not on a whole frame", () => {
    // 1 radian at 0.7 a second is 42.86 frames, and the builder writes 0.6977
    // for 43 of them.
    const lua = lone("Turn(arm, x_axis, 1, 0.7)");
    const result = importScript(bare(unit()), lua, { newId: ids() });

    expect(result.as).toBe("script");
    expect(result.project.script).toBe(lua);
    expect(result.project.actions).toBeUndefined();
  });

  it("reads the speed the builder writes for that many frames", () => {
    const read = readActions(
      lone("Turn(arm, x_axis, 1, 0.6977)"),
      bare(unit()),
      ids(),
    );

    expect(read?.actions[0].tracks).toEqual([
      track("arm", "turn", 0, [
        [10, 0],
        [53, 1],
      ]),
      track("hatch", "move", 1, [[20, 3]]),
    ]);
  });

  it("keeps a call made before the last one on its channel has arrived", () => {
    const lua = [
      'local arm = piece("arm")',
      "local function nod()",
      "  Turn(arm, x_axis, 1, 1)",
      "  Sleep(330)",
      "  Turn(arm, x_axis, 0, 1)",
      "end",
      "function script.Shot1()",
      "  StartThread(nod)",
      "end",
    ].join("\n");

    expect(readActions(lua, bare(unit()), ids())).toBeNull();
  });

  it("keeps a jump that is not on frame 0", () => {
    expect(
      readActions(lone("Turn(arm, x_axis, 1)"), bare(unit()), ids()),
    ).toBeNull();
  });

  it("keeps a call that changes nothing", () => {
    expect(
      readActions(lone("Turn(arm, x_axis, 0, 1)"), bare(unit()), ids()),
    ).toBeNull();
  });

  it("keeps a loop whose lead in is not as long as its lap", () => {
    const lua = [
      'local arm = piece("arm")',
      "local function swing()",
      "  Turn(arm, x_axis, 1, 3)",
      "  Sleep(330)",
      "  while true do",
      "    Turn(arm, x_axis, 0, 3)",
      "    Sleep(660)",
      "    Turn(arm, x_axis, 1, 3)",
      "    Sleep(660)",
      "  end",
      "end",
      "function script.StartMoving()",
      "  StartThread(swing)",
      "end",
      "function script.StopMoving()",
      "  Signal(SIG_SWING)",
      "end",
    ].join("\n");

    expect(readActions(lua, bare(unit()), ids())).toBeNull();
  });

  it("keeps a script the builder wrote for an action that blends in", () => {
    const blended = tracked(
      (FIXTURES.staggered.actions?.[0] as LegoAction).tracks ?? [],
      { loop: false, trigger: "Shot1", blendIn: 0.5 },
    );
    const lua = buildLuaScript(blended);

    const result = importScript(bare(blended), lua, { newId: ids() });

    expect(result.as).toBe("script");
    expect(result.project.script).toBe(lua);
  });

  it("still writes a blended action the same from its normalised tracks", () => {
    const tracks = (FIXTURES.staggered.actions?.[0] as LegoAction).tracks ?? [];
    const options = { loop: false, trigger: "Shot1", blendIn: 0.5 };

    expect(written(tracked(normaliseTracks(tracks), options))).toBe(
      written(tracked(tracks, options)),
    );
  });

  it("keeps a script of tracks on a unit that already has presets", () => {
    const project = bare(FIXTURES.staggered);
    const lua = buildLuaScript(FIXTURES.staggered);

    const result = importScript(
      { ...project, animations: [{ presetId: "walk" }] as never },
      lua,
      { newId: ids() },
    );

    expect(result.as).toBe("script");
  });
});

describe("a script of the old shape", () => {
  it("still reads as pose keys and poses", () => {
    const project = unit({
      actions: [action({ loop: false, trigger: "Shot1" })],
    });
    const read = readActions(buildLuaScript(project), bare(project), ids());

    const [got] = read?.actions ?? [];
    expect(got.tracks).toBeUndefined();
    expect(got.keys.map((k) => k.seconds)).toEqual([1, 2]);
    expect(read?.poses).toHaveLength(2);
  });
});
