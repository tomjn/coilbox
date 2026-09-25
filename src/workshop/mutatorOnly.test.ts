import { describe, expect, it } from "vitest";
import {
  isMutatorOnly,
  mutatorOnlyChanges,
  parseMutatorOnly,
  setMutatorOnly,
} from "./mutatorOnly";

describe("the changes sent to the mutator route (issue #2633)", () => {
  it("marks and unmarks one field without touching the rest", () => {
    const one = setMutatorOnly(undefined, "brv", "trackwidth", true);
    expect(one).toEqual({ brv: ["trackwidth"] });
    const two = setMutatorOnly(one, "brv", "customparams.speed", true);
    expect(two).toEqual({ brv: ["customparams.speed", "trackwidth"] });
    expect(isMutatorOnly(two, "brv", "trackwidth")).toBe(true);
    expect(isMutatorOnly(two, "brv", "customparams")).toBe(false);
    expect(setMutatorOnly(two, "brv", "trackwidth", true)).toBe(two);
    expect(
      setMutatorOnly(
        setMutatorOnly(two, "brv", "trackwidth", false),
        "brv",
        "customparams.speed",
        false,
      ),
    ).toEqual({});
  });

  it("counts only a mark with a change under it", () => {
    const marks = { brv: ["trackwidth", "maxdamage"], gone: ["health"] };
    expect(
      mutatorOnlyChanges(marks, { brv: { trackwidth: 44, speed: 2 } }),
    ).toEqual([{ unit: "brv", field: "trackwidth" }]);
  });

  it("reads untrusted JSON, dropping anything that is not a list of paths", () => {
    expect(
      parseMutatorOnly({
        brv: ["trackwidth", 3, "trackwidth", "armor"],
        bad: "trackwidth",
        empty: [],
      }),
    ).toEqual({ brv: ["armor", "trackwidth"] });
    expect(parseMutatorOnly(["brv"])).toEqual({});
    expect(parseMutatorOnly(null)).toEqual({});
  });
});
