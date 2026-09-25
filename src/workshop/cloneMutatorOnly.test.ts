import { describe, expect, it } from "vitest";
import {
  isCloneMutatorOnly,
  parseCloneMutatorOnly,
  setCloneMutatorOnly,
} from "./cloneMutatorOnly";

describe("the copies sent to the mutator route whole (issue #3035)", () => {
  it("marks and unmarks one copy without touching the rest", () => {
    const one = setCloneMutatorOnly(undefined, "armdfly2", true);
    expect(one).toEqual(["armdfly2"]);
    const two = setCloneMutatorOnly(one, "brv_mk2", true);
    expect(two).toEqual(["armdfly2", "brv_mk2"]);
    expect(isCloneMutatorOnly(two, "armdfly2")).toBe(true);
    expect(isCloneMutatorOnly(two, "supercom")).toBe(false);
    expect(setCloneMutatorOnly(two, "armdfly2", true)).toBe(two);
    expect(setCloneMutatorOnly(two, "armdfly2", false)).toEqual(["brv_mk2"]);
  });

  it("reads untrusted JSON, dropping anything that is not a string", () => {
    expect(
      parseCloneMutatorOnly(["armdfly2", 3, "armdfly2", "brv_mk2"]),
    ).toEqual(["armdfly2", "brv_mk2"]);
    expect(parseCloneMutatorOnly({ armdfly2: true })).toEqual([]);
    expect(parseCloneMutatorOnly(null)).toEqual([]);
  });
});
