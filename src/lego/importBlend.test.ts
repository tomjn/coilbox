import { describe, expect, it } from "vitest";
import { action, poseUnits, tracked, trackUnits, unit } from "./actionFixtures";
import { actionShift, framesOf } from "./actions";
import { importScript, readActions } from "./importScript";
import { buildLuaScript } from "./luaScript";
import type { LegoAction, LegoProject } from "./model";

/**
 * Reading the script of actions that blend back into actions (#5421). The
 * scripts are the ones the builder writes, so each is read back and written
 * again, and the second script has to be the first.
 */

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

/** The unit with no actions, which is what a script is read into. */
function bare(project: LegoProject): LegoProject {
  return { ...project, poses: undefined, actions: undefined };
}

const TRACKS = trackUnits();
const staggered = (TRACKS.staggered.actions?.[0] as LegoAction).tracks ?? [];
const loopOffsets =
  (TRACKS.loopOffsets.actions?.[0] as LegoAction).tracks ?? [];
const frameZero = (TRACKS.frameZero.actions?.[0] as LegoAction).tracks ?? [];

const UNITS: Record<string, LegoProject> = {
  ...Object.fromEntries(
    Object.entries(poseUnits()).filter(([name]) =>
      ["blended", "blendedIn", "blendedOneShot", "defaultBlend"].includes(name),
    ),
  ),
  staggeredIn: tracked(staggered, {
    loop: false,
    trigger: "Shot1",
    blendIn: 0.5,
  }),
  staggeredInAndOut: tracked(staggered, {
    loop: false,
    trigger: "Shot1",
    blendIn: 0.5,
    blendOut: 0.25,
  }),
  loopOffsetsIn: tracked(loopOffsets, { blendIn: 0.5 }),
  loopOffsetsOut: tracked(loopOffsets, { blendIn: 0, blendOut: 0.3 }),
  loopOffsetsBoth: tracked(loopOffsets, { blendIn: 0.4, blendOut: 0.3 }),
  frameZeroBoth: tracked(frameZero, { blendIn: 0.1, blendOut: 0.5 }),
  // The unit's default blend, with one action that opts out of it.
  defaultAndOwn: unit({
    actionBlend: 0.4,
    actions: [action({ blendIn: 0 }), action({ id: "b", name: "Other" })],
  }),
};

describe("reading back what the builder writes for actions that blend", () => {
  for (const [name, project] of Object.entries(UNITS)) {
    it(`reads ${name} and writes the same script again`, () => {
      const lua = buildLuaScript(project);

      const result = importScript(bare(project), lua, { newId: ids() });

      expect(result.as).toBe("actions");
      expect(result.project.script).toBeUndefined();
      expect(buildLuaScript(result.project)).toBe(lua);
    });

    it(`keeps the blend times of ${name}`, () => {
      const lua = buildLuaScript(project);
      const into = bare(project);

      const read = readActions(lua, into, ids());

      const fallback = project.actionBlend ?? 0;
      const times = (a: LegoAction) => ({
        blendIn: a.blendIn ?? fallback,
        blendOut: a.blendOut ?? fallback,
      });
      const got = read?.actions.map(times);
      const original = project.actions?.map(times);
      // A one shot action's blend out is not in the script, and an action that
      // does not loop has nothing to blend out of.
      expect(got?.map((t) => t.blendIn)).toEqual(
        original?.map((t) => t.blendIn),
      );
      project.actions?.forEach((a, at) => {
        if (a.loop) expect(got?.[at].blendOut).toBe(original?.[at].blendOut);
      });
    });
  }
});

describe("the times an action takes from the unit's default", () => {
  const project = UNITS.defaultBlend;
  const lua = buildLuaScript(project);

  it("leaves a time that is the unit's default unset", () => {
    const read = readActions(lua, bare(project), ids());

    expect(read?.actions[0].blendIn).toBeUndefined();
    expect(read?.actions[0].blendOut).toBeUndefined();
  });

  it("sets the time on an action when the unit has no default", () => {
    const { actionBlend: _default, ...none } = bare(project);

    const read = readActions(lua, none, ids());

    expect(read?.actions[0]).toMatchObject({ blendIn: 0.4, blendOut: 0.4 });
  });

  it("sets a time of 0 on an action when the unit has a default and the script has no blend", () => {
    const plain = unit();
    const read = readActions(
      buildLuaScript(plain),
      { ...bare(plain), actionBlend: 0.4 },
      ids(),
    );

    expect(read?.actions[0]).toMatchObject({ blendIn: 0, blendOut: 0 });
  });
});

describe("the first key frame of an action that blends in", () => {
  it("is the end of the blend for an action that does not loop", () => {
    // The first key is on frame 30 and the blend takes 15, so the script waits
    // 15 frames. Nothing in it says the key was on 30.
    const project = UNITS.blendedOneShot;
    const read = readActions(buildLuaScript(project), bare(project), ids());

    const [got] = read?.actions ?? [];
    const frames = (got.tracks ?? []).flatMap((t) =>
      t.keys.map((k) => k.frame),
    );
    expect(Math.min(...frames)).toBe(15);
    expect(actionShift(got, { ...bare(project), actionBlend: 0 })).toBe(0);
  });

  it("is read from the lap for an action that loops", () => {
    // The lap is as long as the action, and the lead in is as long as the lap
    // and the frames the blend replaces.
    const project = UNITS.blendedIn;
    const read = readActions(buildLuaScript(project), bare(project), ids());

    const [got] = read?.actions ?? [];
    const frames = (got.tracks ?? []).flatMap((t) =>
      t.keys.map((k) => k.frame),
    );
    expect(Math.min(...frames)).toBe(30);
    expect(framesOf(got.blendIn ?? 0)).toBe(15);
  });
});

describe("a script that is more than the builder writes", () => {
  const project = UNITS.blendedIn;
  const lua = buildLuaScript(project);

  it("keeps the helpers with a function of its own beside them", () => {
    const own = `${lua}\nlocal function Smoke()\n  Hide(arm)\nend`;

    expect(readActions(own, bare(project), ids())).toBeNull();
  });

  it("keeps the helpers with a line of its own in a call-in", () => {
    const own = lua.replace(
      "function script.StartMoving()",
      "function script.StartMoving()\n  Hide(arm)",
    );

    expect(readActions(own, bare(project), ids())).toBeNull();
  });

  it("keeps a script whose helpers have been changed", () => {
    const own = lua.replace("local ACT_AT = {}", "local ACT_AT = {n = 1}");

    expect(readActions(own, bare(project), ids())).toBeNull();
  });

  it("keeps a script that calls the helpers without carrying them", () => {
    const without = [
      lua.slice(0, lua.indexOf("-- Where the actions")),
      lua.slice(lua.indexOf("-- Action:")),
    ].join("");
    expect(without).not.toContain("ACT_AT");
    expect(without).toContain("ActTurn");

    expect(readActions(without, bare(project), ids())).toBeNull();
  });

  it("keeps a blend whose speed is not the builder's", () => {
    const own = lua.replace(
      "BlendTurn(arm, x_axis, 1, 0.5)",
      "BlendTurn(arm, x_axis, 1, 0.9)",
    );
    expect(own).not.toBe(lua);

    expect(readActions(own, bare(project), ids())).toBeNull();
  });

  it("keeps a stop that blends out over different times", () => {
    const withOut = unit({
      actions: [action({ blendIn: 0.5, blendOut: 0.3 })],
    });
    const text = buildLuaScript(withOut);
    const own = text.replace(
      /BlendMove\((\w+), (\w+), 0, 0.3\)/,
      "BlendMove($1, $2, 0, 0.9)",
    );
    expect(own).not.toBe(text);

    expect(readActions(own, bare(withOut), ids())).toBeNull();
  });

  it("keeps a unit whose only blend is a blend out of an action that does not loop", () => {
    const hidden = unit({
      actions: [action({ loop: false, trigger: "Shot1", blendOut: 0.5 })],
    });
    const text = buildLuaScript(hidden);
    expect(text).toContain("ACT_AT");

    expect(readActions(text, bare(hidden), ids())).toBeNull();
  });
});

describe("pieces that arrive on different frames while blending", () => {
  it("reads a loop whose channels start on different frames", () => {
    const project = UNITS.loopOffsetsIn;
    const read = readActions(buildLuaScript(project), bare(project), ids());

    const [got] = read?.actions ?? [];
    const frames = (got.tracks ?? []).map((t) => t.keys[0].frame);
    // Frame 5 is where the first channel keys, which the lap gives.
    expect(Math.min(...frames)).toBe(5);
    expect(got.blendIn).toBe(0.5);
  });
});

describe("a pose keyed action that blends", () => {
  it("is read as tracks, because the blend takes the place of the first key's time", () => {
    const project = UNITS.blendedIn;
    const read = readActions(buildLuaScript(project), bare(project), ids());

    expect(read?.poses).toEqual([]);
    expect(read?.actions[0].keys).toEqual([]);
    expect(read?.actions[0].tracks?.length).toBeGreaterThan(0);
  });
});
