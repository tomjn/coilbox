import { describe, expect, it } from "vitest";
import {
  actionFor,
  LARGE_STEP_SECONDS,
  STEP_SECONDS,
  TIMELINE_KEYS,
} from "./timelineKeys";

const press = (key: string, shiftKey = false) => ({
  key,
  shiftKey,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
});

describe("the keys", () => {
  it.each([
    [" ", false, { type: "toggle" }],
    ["r", false, { type: "reverse" }],
    ["ArrowLeft", false, { type: "step", seconds: -STEP_SECONDS }],
    ["ArrowRight", false, { type: "step", seconds: STEP_SECONDS }],
    ["ArrowLeft", true, { type: "step", seconds: -LARGE_STEP_SECONDS }],
    ["ArrowRight", true, { type: "step", seconds: LARGE_STEP_SECONDS }],
    [",", false, { type: "frame", frames: -1 }],
    [".", false, { type: "frame", frames: 1 }],
    ["Home", false, { type: "start" }],
    ["End", false, { type: "end" }],
    ["[", false, { type: "mark", direction: -1 }],
    ["]", false, { type: "mark", direction: 1 }],
    ["-", false, { type: "slower" }],
    ["=", false, { type: "faster" }],
    ["+", true, { type: "faster" }],
  ])("%j (shift %j) does %j", (key, shift, action) => {
    expect(actionFor(press(key, shift))).toEqual(action);
  });

  it("leaves a key alone that the table does not name", () => {
    expect(actionFor(press("a"))).toBeNull();
    expect(actionFor(press("Enter"))).toBeNull();
    expect(actionFor(press("Tab"))).toBeNull();
  });

  it("leaves a key alone when a command modifier is held, so browser shortcuts work", () => {
    expect(actionFor({ ...press("ArrowLeft"), metaKey: true })).toBeNull();
    expect(actionFor({ ...press("r"), ctrlKey: true })).toBeNull();
    expect(actionFor({ ...press("-"), altKey: true })).toBeNull();
  });

  it("lists every key once with the words the help shows", () => {
    expect(TIMELINE_KEYS.length).toBeGreaterThan(0);
    for (const row of TIMELINE_KEYS) {
      expect(row.show.length).toBeGreaterThan(0);
      expect(row.does.length).toBeGreaterThan(0);
    }
    const shown = TIMELINE_KEYS.map((row) => row.show);
    expect(new Set(shown).size).toBe(shown.length);
  });
});
