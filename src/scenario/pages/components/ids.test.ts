import { describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import type { Scenario, ScenarioTrigger } from "../../model";
import { markIdsUsed, nextMintedId } from "./ids";

const trigger = (id: string): ScenarioTrigger => ({
  id,
  name: id,
  enabled: true,
  repeat: false,
  conditions: { op: "all", conditions: [] },
  actions: [],
});

const doc = (partial: Partial<Scenario> = {}): Scenario => ({
  ...newScenario("t"),
  ...partial,
});

describe("nextMintedId", () => {
  it("starts at one on an empty document", () => {
    expect(nextMintedId(doc(), "trigger")).toBe("trigger-1");
    expect(nextMintedId(doc(), "objective")).toBe("objective-1");
    expect(nextMintedId(doc(), "line")).toBe("line-1");
  });

  it("goes past the highest number the document holds", () => {
    const held = doc({
      triggers: [trigger("trigger-1"), trigger("trigger-7")],
    });
    expect(nextMintedId(held, "trigger")).toBe("trigger-8");
  });

  /** The fixture corpus is written with ids like `spring-ambush`, and a hand
   *  written id numbers nothing. */
  it("ignores an id that is not a numbered one", () => {
    const named = doc({ triggers: [trigger("spring-ambush")] });
    expect(nextMintedId(named, "trigger")).toBe("trigger-1");
  });

  it("ignores a number that is not one, so `trigger-2b` holds nothing back", () => {
    const odd = doc({ triggers: [trigger("trigger-2b")] });
    expect(nextMintedId(odd, "trigger")).toBe("trigger-1");
  });

  it("goes past the mark even when nothing in the document reaches it", () => {
    const emptied = doc({ idCounters: { trigger: 4 } });
    expect(nextMintedId(emptied, "trigger")).toBe("trigger-5");
  });

  /** An imported document can carry a mark behind its own ids. The ids win, so
   *  the mint never collides with something already in the list. */
  it("takes the ids over a mark that has fallen behind them", () => {
    const stale = doc({
      idCounters: { trigger: 1 },
      triggers: [trigger("trigger-6")],
    });
    expect(nextMintedId(stale, "trigger")).toBe("trigger-7");
  });

  it("counts each prefix on its own", () => {
    const mixed = doc({
      triggers: [trigger("trigger-9")],
      objectives: [
        { id: "objective-2", kind: "primary", text: "", hidden: false },
      ],
    });
    expect(nextMintedId(mixed, "objective")).toBe("objective-3");
    expect(nextMintedId(mixed, "line")).toBe("line-1");
  });
});

describe("markIdsUsed", () => {
  it("writes the highest number the document is using", () => {
    const held = doc({ triggers: [trigger("trigger-3"), trigger("open")] });
    expect(markIdsUsed(held, "trigger").idCounters).toEqual({ trigger: 3 });
  });

  it("leaves the document alone when the mark is already far enough on", () => {
    const marked = doc({
      idCounters: { trigger: 9 },
      triggers: [trigger("trigger-3")],
    });
    expect(markIdsUsed(marked, "trigger")).toBe(marked);
  });

  it("writes nothing for a document that mints no numbered id", () => {
    const named = doc({ triggers: [trigger("spring-ambush")] });
    expect(markIdsUsed(named, "trigger")).toBe(named);
  });

  it("keeps the marks of the other prefixes", () => {
    const marked = doc({
      idCounters: { line: 4 },
      objectives: [
        { id: "objective-2", kind: "primary", text: "", hidden: false },
      ],
    });
    expect(markIdsUsed(marked, "objective").idCounters).toEqual({
      line: 4,
      objective: 2,
    });
  });
});
