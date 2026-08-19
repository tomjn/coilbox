import { describe, expect, it } from "vitest";
import { spaceMapNames } from "@/content/mapAppearance";
import { appearanceFromFacts } from "./appearance";
import type { MapFacts } from "./lookup";

function facts(over: Partial<MapFacts> = {}): MapFacts {
  return {
    slug: "isis",
    display_name: "Isis",
    description: "A desert map",
    authors: [{ key: "someone", name: "Someone" }],
    width_elmos: 6144,
    height_elmos: 6144,
    world_height_min: -80,
    world_height_max: 420.5,
    min_wind: 5,
    max_wind: 25,
    tidal_strength: 18,
    void_water: false,
    water_coverage: 0.25,
    tags: [],
    points: { start: [], metal: [], geo: [] },
    appearance: {},
    ...over,
  };
}

describe("appearanceFromFacts", () => {
  /// The one thing the galaxy reads, and the reason this exists.
  it("carries whether the map is a void map", () => {
    expect(appearanceFromFacts(facts({ void_water: true }))?.voidWater).toBe(
      true,
    );
    expect(appearanceFromFacts(facts({ void_water: false }))?.voidWater).toBe(
      false,
    );
  });

  /// A map nobody has submitted is not a map that is known not to be void, and
  /// a caller has to be able to tell those apart.
  it("has nothing to say about a map the hub has never heard of", () => {
    expect(appearanceFromFacts(null)).toBeNull();
    expect(appearanceFromFacts(undefined)).toBeNull();
  });

  /// A row that says nothing about void water is not the same as one that says
  /// no, so it stays null rather than becoming false.
  it("keeps an unanswered flag unanswered", () => {
    expect(
      appearanceFromFacts(facts({ void_water: null }))?.voidWater,
    ).toBeNull();
  });

  /// The whole record rather than one boolean, so the next reader of the cache
  /// gets the fallback without another change here.
  it("fills the colours and the height range the cache holds", () => {
    const filled = appearanceFromFacts(
      facts({
        appearance: {
          waterColor: [0.1, 0.2, 0.3],
          waterAlpha: 0.4,
          voidAlphaMin: 0.9,
          forceRendering: false,
          sunDir: [0.1635, 0.6, -0.3411],
          groundShadowDensity: 0.8,
        },
      }),
    );
    expect(filled).toMatchObject({
      name: "Isis",
      description: "A desert map",
      author: "Someone",
      minHeight: -80,
      maxHeight: 420.5,
      waterColor: [0.1, 0.2, 0.3],
      waterAlpha: 0.4,
      voidAlphaMin: 0.9,
      forceRendering: false,
      sunDir: [0.1635, 0.6, -0.3411],
      groundShadowDensity: 0.8,
    });
  });

  /// The blob is passed through by the hub exactly as it was stored, so a value
  /// under a colour's name that is not a colour is read as no colour rather
  /// than as three numbers that are not there.
  it("refuses a colour that is not three numbers", () => {
    const odd = appearanceFromFacts(
      facts({
        appearance: {
          waterColor: [0.1, 0.2],
          skyColor: "blue",
          fogColor: [0.1, 0.2, "x"],
        },
      }),
    );
    expect(odd?.waterColor).toBeNull();
    expect(odd?.skyColor).toBeNull();
    expect(odd?.fogColor).toBeNull();
  });

  /// The path only means something to a machine holding the archive.
  it("carries no skybox", () => {
    expect(appearanceFromFacts(facts())?.skyBox).toBeNull();
  });

  /// What the galaxy does with the answer: the same classifier the local cache
  /// is read through, so a hub answer and a local one are the same kind of fact.
  it("reads as a space map to the classifier the galaxy uses", () => {
    const asteroid = appearanceFromFacts(facts({ void_water: true }));
    const planet = appearanceFromFacts(facts({ void_water: false }));
    const unknown = appearanceFromFacts(facts({ void_water: null }));
    const cache = {
      "Void 1.0": asteroid,
      "Ground 1.0": planet,
      "Nobody Knows 1.0": unknown,
    };
    expect(spaceMapNames(cache as never)).toEqual(new Set(["Void 1.0"]));
  });
});
