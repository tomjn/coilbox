import { describe, expect, it } from "vitest";
import type { StoredBlueprint } from "@/blueprint/library";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import {
  layoutChoiceKey,
  layoutOptions,
  parseLayoutChoice,
} from "./layoutPlacing";

function stored(name: string, game: string, id = name): StoredBlueprint {
  return {
    id,
    createdAt: "",
    updatedAt: "",
    layout: {
      ...(game ? { game: { name: game } } : {}),
      name,
      buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
      footprints: {},
    },
  };
}

function document(): Scenario {
  const base = newScenario("test");
  return {
    ...base,
    setup: { ...base.setup, gameName: "BA 12.34" },
    blueprints: [
      {
        id: "bp1",
        name: "The keep",
        buildings: [
          { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armsolar", offset: { x: 64, z: 0 }, facing: 0 },
        ],
      },
      { id: "bp2", name: "Kept", buildings: [] },
    ],
    bases: [
      {
        id: "b1",
        blueprint: "bp1",
        team: "p1",
        origin: { x: 0, z: 0 },
        buildings: [],
      },
    ],
  };
}

describe("a layout choice as one string", () => {
  it("round trips", () => {
    const choice = { from: "library", id: "abc-def" } as const;
    expect(parseLayoutChoice(layoutChoiceKey(choice))).toEqual(choice);
  });

  it("keeps an id with a colon in it whole", () => {
    expect(parseLayoutChoice("scenario:a:b")).toEqual({
      from: "scenario",
      id: "a:b",
    });
  });

  it("refuses a key naming somewhere a layout does not live", () => {
    expect(parseLayoutChoice("hub:1")).toBeNull();
    expect(parseLayoutChoice("scenario:")).toBeNull();
    expect(parseLayoutChoice("bp1")).toBeNull();
  });
});

describe("what a base can be placed from", () => {
  it("offers this scenario's layouts before the library's", () => {
    const options = layoutOptions(
      document(),
      [stored("Opening solars", "BA 12.34")],
      "BA 12.34",
    );
    expect(options.map((o) => o.label)).toEqual([
      "The keep",
      "Kept",
      "Opening solars",
    ]);
  });

  it("says which of the scenario's layouts nothing places", () => {
    const options = layoutOptions(document(), [], "BA 12.34");
    expect(options[0].description).toBe("In this scenario · 2 buildings");
    expect(options[1].description).toBe(
      "In this scenario · 0 buildings · not placed",
    );
  });

  it("names the game on a library layout for a different one", () => {
    const options = layoutOptions(
      document(),
      [stored("Theirs", "Zero-K 1.2.3")],
      "BA 12.34",
    );
    expect(options[2].description).toBe(
      "Your library · 1 building · Zero-K 1.2.3",
    );
  });

  it("does not name the game on a library layout for this one", () => {
    const options = layoutOptions(
      document(),
      [stored("Mine", "BA 12.34")],
      "BA 12.34",
    );
    expect(options[2].description).toBe("Your library · 1 building");
  });

  it("puts another game's layouts last without hiding them", () => {
    const options = layoutOptions(
      document(),
      [
        stored("Theirs", "Zero-K 1.2.3"),
        stored("Mine", "BA 12.34"),
        stored("Nameless", ""),
      ],
      "BA 12.34",
    );
    expect(options.slice(2).map((o) => o.label)).toEqual([
      "Mine",
      "Nameless",
      "Theirs",
    ]);
  });

  /** A base with no buildings is a thing the document holds and the author can
   *  never see, select or delete. */
  it("greys out a layout with nothing in it rather than hiding it", () => {
    const options = layoutOptions(
      document(),
      [stored("Empty", "BA 12.34")],
      "BA 12.34",
    );
    expect(options[0].disabled).toBeUndefined();
    expect(options[1].label).toBe("Kept");
    expect(options[1].disabled).toBe(true);
  });

  it("sorts nothing by game when the scenario has not picked one", () => {
    const blank = document();
    const options = layoutOptions(
      { ...blank, blueprints: [], bases: [] },
      [stored("Theirs", "Zero-K 1.2.3"), stored("Mine", "BA 12.34")],
      "",
    );
    expect(options.map((o) => o.label)).toEqual(["Theirs", "Mine"]);
    expect(options[0].description).toBe("Your library · 1 building");
  });
});
