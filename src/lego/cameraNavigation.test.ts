import { MOUSE } from "three";
import { describe, expect, it } from "vitest";

import {
  mouseButtonsFor,
  moveFor,
  navigationControls,
  type PointerModifiers,
  presetFromStored,
} from "./cameraNavigation";

const NONE = { ctrl: false, shift: false, alt: false, meta: false };
const press = (
  button: number,
  keys: Partial<PointerModifiers> = {},
): PointerModifiers => ({ ...NONE, button, ...keys });

describe("presetFromStored", () => {
  it("falls back to Coilbox for anything it does not know", () => {
    expect(presetFromStored(null)).toBe("coilbox");
    expect(presetFromStored("maya")).toBe("coilbox");
    expect(presetFromStored("blender")).toBe("blender");
    expect(presetFromStored("3dsmax")).toBe("3dsmax");
  });
});

describe("Coilbox preset", () => {
  it("keeps left orbit, middle zoom and right pan whatever is held", () => {
    for (const keys of [{}, { shift: true }, { alt: true }]) {
      expect(mouseButtonsFor("coilbox", press(0, keys))).toEqual({
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
      });
    }
  });
});

describe("Blender preset", () => {
  it("orbits on middle, pans with Shift, zooms with Ctrl", () => {
    expect(moveFor("blender", press(1))).toBe("orbit");
    expect(moveFor("blender", press(1, { shift: true }))).toBe("pan");
    expect(moveFor("blender", press(1, { ctrl: true }))).toBe("zoom");
    expect(moveFor("blender", press(1, { meta: true }))).toBe("zoom");
  });

  it("leaves left and right drags and other chords alone", () => {
    expect(moveFor("blender", press(0))).toBeNull();
    expect(moveFor("blender", press(2))).toBeNull();
    expect(moveFor("blender", press(1, { alt: true }))).toBeNull();
    expect(
      moveFor("blender", press(1, { ctrl: true, shift: true })),
    ).toBeNull();
  });

  it("gives OrbitControls the entry that survives its own modifier swap", () => {
    expect(mouseButtonsFor("blender", press(1)).MIDDLE).toBe(MOUSE.ROTATE);
    // OrbitControls turns PAN into rotate and ROTATE into pan when Shift is
    // down, so a Shift pan needs the ROTATE entry.
    expect(mouseButtonsFor("blender", press(1, { shift: true })).MIDDLE).toBe(
      MOUSE.ROTATE,
    );
    expect(mouseButtonsFor("blender", press(1, { ctrl: true })).MIDDLE).toBe(
      MOUSE.DOLLY,
    );
    const map = mouseButtonsFor("blender", press(0));
    expect(map.LEFT).toBe(-1);
    expect(map.RIGHT).toBe(-1);
  });
});

describe("3ds Max preset", () => {
  it("pans on middle, orbits with Alt, zooms with Ctrl and Alt", () => {
    expect(moveFor("3dsmax", press(1))).toBe("pan");
    expect(moveFor("3dsmax", press(1, { alt: true }))).toBe("orbit");
    expect(moveFor("3dsmax", press(1, { alt: true, ctrl: true }))).toBe("zoom");
  });

  it("leaves left and right drags and other chords alone", () => {
    expect(moveFor("3dsmax", press(0))).toBeNull();
    expect(moveFor("3dsmax", press(2))).toBeNull();
    expect(moveFor("3dsmax", press(1, { ctrl: true }))).toBeNull();
    expect(moveFor("3dsmax", press(1, { shift: true }))).toBeNull();
  });

  it("sets ROTATE for Alt with the middle button", () => {
    expect(mouseButtonsFor("3dsmax", press(1, { alt: true })).MIDDLE).toBe(
      MOUSE.ROTATE,
    );
    expect(mouseButtonsFor("3dsmax", press(1)).MIDDLE).toBe(MOUSE.PAN);
    expect(
      mouseButtonsFor("3dsmax", press(1, { alt: true, ctrl: true })).MIDDLE,
    ).toBe(MOUSE.DOLLY);
    expect(mouseButtonsFor("3dsmax", press(0)).LEFT).toBe(-1);
  });
});

describe("navigationControls", () => {
  it("lists four controls for every preset, ending with the wheel", () => {
    for (const preset of ["coilbox", "blender", "3dsmax"] as const) {
      const list = navigationControls(preset);
      expect(list).toHaveLength(4);
      expect(list[3]).toEqual({ move: "zoom", keys: [], button: "wheel" });
    }
  });

  it("agrees with moveFor for the middle button", () => {
    for (const preset of ["blender", "3dsmax"] as const) {
      for (const c of navigationControls(preset)) {
        if (c.button !== "middle") continue;
        expect(
          moveFor(
            preset,
            press(1, {
              ctrl: c.keys.includes("ctrl"),
              shift: c.keys.includes("shift"),
              alt: c.keys.includes("alt"),
            }),
          ),
        ).toBe(c.move);
      }
    }
  });
});
