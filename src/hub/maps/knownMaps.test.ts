import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetKnownMaps, knownMap } from "./knownMaps";
import type { MapFacts } from "./lookup";

const BASE = "https://hub.example";
const OTHER = "https://other.example";

function facts(slug: string): MapFacts {
  return {
    slug,
    display_name: slug,
    description: null,
    authors: [],
    width_elmos: 8192,
    height_elmos: 8192,
    world_height_min: -50,
    world_height_max: 300,
    min_wind: null,
    max_wind: null,
    tidal_strength: null,
    void_water: null,
    water_coverage: null,
    tags: [],
    points: { start: [], metal: [], geo: [] },
    appearance: {},
  };
}

/** A hub that answers every name it is asked, so a test can count requests
 *  rather than inspect them. */
function stubHub(known: (name: string) => MapFacts | null = facts) {
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const names = JSON.parse(String(init.body)).names as string[];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        format: "coilbox-hub-map-lookup",
        version: 1,
        results: names.map((name) => ({ map_name: name, map: known(name) })),
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  forgetKnownMaps();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("knownMap", () => {
  /// The whole point of the queue. Twenty cards asking one at a time inside one
  /// commit's effects is one request.
  it("puts twenty maps asked for at once into one request", async () => {
    const fetched = stubHub();
    const names = Array.from({ length: 20 }, (_, at) => `Map ${at}`);

    const answers = await Promise.all(
      names.map((name) => knownMap(BASE, name)),
    );

    expect(fetched).toHaveBeenCalledTimes(1);
    const asked = JSON.parse(String(fetched.mock.calls[0][1].body)).names;
    expect(asked).toEqual(names);
    expect(answers.map((a) => a?.slug)).toEqual(names);
  });

  it("remembers an answer for the session", async () => {
    const fetched = stubHub();
    await knownMap(BASE, "Isis 1.3");
    await knownMap(BASE, "Isis 1.3");
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  /// Including "never heard of it", which is the answer for most names while
  /// the catalog fills up.
  it("remembers that the hub knows nothing about a map", async () => {
    const fetched = stubHub(() => null);
    expect(await knownMap(BASE, "Nobody Has This")).toBeNull();
    expect(await knownMap(BASE, "Nobody Has This")).toBeNull();
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  /// A failure says nothing about what the hub knows, so remembering it would
  /// turn one bad moment on the network into a session with no facts in it.
  it("does not remember a request that failed", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", failing);
    expect(await knownMap(BASE, "Isis 1.3")).toBeNull();

    const fetched = stubHub();
    expect((await knownMap(BASE, "Isis 1.3"))?.slug).toBe("Isis 1.3");
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("keeps answers apart by hub address", async () => {
    const fetched = stubHub();
    await Promise.all([
      knownMap(BASE, "Isis 1.3"),
      knownMap(OTHER, "Isis 1.3"),
    ]);
    expect(fetched).toHaveBeenCalledTimes(2);
    const urls = fetched.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      "https://hub.example/api/v1/maps/lookup",
      "https://other.example/api/v1/maps/lookup",
    ]);
  });

  /// Two callers wanting one map at the same moment wait on one request rather
  /// than starting two.
  it("asks once for a map two callers want at the same time", async () => {
    const fetched = stubHub();
    const [first, second] = await Promise.all([
      knownMap(BASE, "Isis 1.3"),
      knownMap(BASE, "Isis 1.3"),
    ]);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });
});
