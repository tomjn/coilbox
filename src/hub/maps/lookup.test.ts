import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMapFacts,
  hubMapLookupUrl,
  MAX_LOOKUP_NAMES,
  type MapFacts,
  readLookupBody,
  readMapFacts,
} from "./lookup";

const BASE = "https://hub.example";
const ISIS = "Isis 1.3";
const TABULA = "Tabula 3";

/** What the hub answers for a map it holds, field for field, as
 *  `buildMapLookupBody` builds it. */
const FACTS: MapFacts = {
  slug: "isis",
  display_name: "Isis",
  description: "A desert map",
  authors: [{ key: "someone", name: "Someone" }],
  width_elmos: 6144,
  height_elmos: 10240,
  world_height_min: -80,
  world_height_max: 420.5,
  min_wind: 5,
  max_wind: 25,
  tidal_strength: 18,
  void_water: false,
  water_coverage: 0.25,
  tags: ["desert", "8 players"],
  points: {
    start: [
      { x: 512, z: 1024, y: null, meta: null },
      { x: 1024, z: 512, y: null, meta: null },
    ],
    metal: [],
    geo: [],
  },
  appearance: { waterColor: [0.1, 0.2, 0.3] },
};

function body(results: unknown[], over: Record<string, unknown> = {}) {
  return {
    format: "coilbox-hub-map-lookup",
    version: 1,
    results,
    ...over,
  };
}

function stubFetch(
  answers: { status?: number; body?: unknown }[],
  onCall?: (url: string, init: RequestInit) => void,
) {
  let call = 0;
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    onCall?.(url, init);
    const answer = answers[Math.min(call++, answers.length - 1)];
    const status = answer.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => answer.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** A hub that echoes whatever names a batch asked for, which is what a canned
 *  answer cannot do once the request is split. */
function stubEchoingHub(onBatch: (asked: string[]) => MapFacts | null) {
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const asked = JSON.parse(String(init.body)).names as string[];
    const map = onBatch(asked);
    return {
      ok: true,
      status: 200,
      json: async () => body(asked.map((name) => ({ map_name: name, map }))),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hubMapLookupUrl", () => {
  it("keeps a hub served under a path prefix", () => {
    expect(hubMapLookupUrl("https://example.test/hub")).toBe(
      "https://example.test/hub/api/v1/maps/lookup",
    );
    expect(hubMapLookupUrl("https://hub.example/")).toBe(
      "https://hub.example/api/v1/maps/lookup",
    );
  });
});

describe("readMapFacts", () => {
  it("reads what the hub holds", () => {
    const read = readMapFacts(FACTS);
    expect(read).toEqual(FACTS);
  });

  /// The ordinary answer for most names for a while, and not a fault.
  it("reads a map the hub has never heard of as no facts", () => {
    expect(readMapFacts(null)).toBeNull();
  });

  /// A row missing a measurement an entry cannot exist without is not a row
  /// this understands, and the caller's fallback is the same either way.
  it("reads a row with no size as no facts", () => {
    expect(readMapFacts({ ...FACTS, width_elmos: "wide" })).toBeNull();
    expect(readMapFacts({ ...FACTS, slug: "" })).toBeNull();
  });

  it("fills in what a row leaves out rather than refusing it", () => {
    const sparse = readMapFacts({
      slug: "bare",
      width_elmos: 8192,
      height_elmos: 8192,
    });
    expect(sparse).toMatchObject({
      display_name: null,
      tidal_strength: null,
      void_water: null,
      tags: [],
      points: { start: [], metal: [], geo: [] },
      appearance: {},
    });
  });
});

describe("readLookupBody", () => {
  it("answers in the order the names were asked", () => {
    const read = readLookupBody(
      body([
        { map_name: ISIS, map: FACTS },
        { map_name: TABULA, map: null },
      ]),
      [ISIS, TABULA],
    );
    expect(read).toEqual({ ok: true, maps: [FACTS, null] });
  });

  /// Reading by index is what makes this cheap, so an answer that does not echo
  /// what was asked is refused whole: one map's size on another map's card is
  /// worse than no size.
  it("refuses an answer that names a different map", () => {
    const read = readLookupBody(body([{ map_name: TABULA, map: FACTS }]), [
      ISIS,
    ]);
    expect(read).toEqual({
      ok: false,
      reason: "The hub answered name 0 with a different name.",
    });
  });

  it("refuses a short answer rather than lining the rest up wrongly", () => {
    const read = readLookupBody(body([]), [ISIS, TABULA]);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain("answered 0 of 2");
  });

  it("refuses something that is not a coilbox hub", () => {
    const read = readLookupBody({ results: [] }, [ISIS]);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain("not a coilbox hub");
  });

  it("refuses a newer lookup than this build understands", () => {
    const read = readLookupBody(body([], { version: 2 }), []);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain("Update coilbox");
  });

  /// The hub allows a repeated name, because a lobby list names the map each
  /// game is playing and several games play the same map.
  it("allows one name asked about twice", () => {
    const read = readLookupBody(
      body([
        { map_name: ISIS, map: FACTS },
        { map_name: ISIS, map: FACTS },
      ]),
      [ISIS, ISIS],
    );
    expect(read).toEqual({ ok: true, maps: [FACTS, FACTS] });
  });
});

/**
 * The hub's own answer, copied out of `buildMapLookupBody` run against the names
 * this client sends. The stubs above imitate the same shape, so this is what
 * stops the two imitating each other rather than the hub.
 */
const HUB_ANSWER = `{"format":"coilbox-hub-map-lookup","version":1,"results":[{"map_name":"Isis 1.3","map":{"slug":"isis-1-3","display_name":"Isis","description":"A desert map","authors":[{"key":"someone","name":"Someone"}],"width_elmos":6144,"height_elmos":10240,"world_height_min":-80,"world_height_max":420.5,"min_wind":5,"max_wind":25,"tidal_strength":18,"void_water":false,"water_coverage":0.25,"tags":["desert","8 players"],"points":{"start":[{"x":512,"z":1024,"y":null,"meta":null},{"x":1024,"z":512,"y":null,"meta":null}],"metal":[{"x":100,"z":200,"y":null,"meta":{"amount":2302.56,"radius":45.3}}],"geo":[{"x":300,"z":400,"y":45.5,"meta":{"feature":"GeoVent"}}]},"appearance":{"waterColor":[0.1,0.2,0.3],"voidAlphaMin":0.9}}},{"map_name":"Nobody Has This","map":null},{"map_name":"Isis 1.3","map":{"slug":"isis-1-3","display_name":"Isis","description":"A desert map","authors":[{"key":"someone","name":"Someone"}],"width_elmos":6144,"height_elmos":10240,"world_height_min":-80,"world_height_max":420.5,"min_wind":5,"max_wind":25,"tidal_strength":18,"void_water":false,"water_coverage":0.25,"tags":["desert","8 players"],"points":{"start":[{"x":512,"z":1024,"y":null,"meta":null},{"x":1024,"z":512,"y":null,"meta":null}],"metal":[{"x":100,"z":200,"y":null,"meta":{"amount":2302.56,"radius":45.3}}],"geo":[{"x":300,"z":400,"y":45.5,"meta":{"feature":"GeoVent"}}]},"appearance":{"waterColor":[0.1,0.2,0.3],"voidAlphaMin":0.9}}}]}`;

describe("the hub's own answer", () => {
  it("reads, including the map it knows nothing about and the name asked twice", () => {
    const read = readLookupBody(JSON.parse(HUB_ANSWER), [
      ISIS,
      "Nobody Has This",
      ISIS,
    ]);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.maps[1]).toBeNull();
    expect(read.maps[0]).toEqual(read.maps[2]);
    expect(read.maps[0]).toMatchObject({
      slug: "isis-1-3",
      display_name: "Isis",
      width_elmos: 6144,
      void_water: false,
      tags: ["desert", "8 players"],
    });
    expect(read.maps[0]?.points.start).toHaveLength(2);
    expect(read.maps[0]?.points.geo[0]?.meta).toEqual({ feature: "GeoVent" });
    expect(read.maps[0]?.points.metal[0]?.meta).toEqual({
      amount: 2302.56,
      radius: 45.3,
    });
  });

  /// What the live hub answers today, word for word: the route is deployed and
  /// its catalog read is not. A caller sees no facts, which is the same thing it
  /// sees for a map nobody has submitted.
  it("reads the live hub's refusal as a reason rather than as facts", async () => {
    stubFetch([
      {
        status: 503,
        body: { error: "The map catalog could not be read just now." },
      },
    ]);
    const read = await fetchMapFacts(BASE, [ISIS]);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toBe("The map catalog could not be read just now.");
    }
  });
});

describe("fetchMapFacts", () => {
  it("asks nobody about nothing", async () => {
    const fetched = stubFetch([]);
    expect(await fetchMapFacts(BASE, [])).toEqual({ ok: true, maps: [] });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("posts the names to the lookup route", async () => {
    let seen: { url: string; body: unknown } | null = null;
    stubFetch(
      [{ body: body([{ map_name: ISIS, map: FACTS }]) }],
      (url, init) => {
        seen = { url, body: JSON.parse(String(init.body)) };
      },
    );

    const read = await fetchMapFacts(BASE, [ISIS]);

    expect(read).toEqual({ ok: true, maps: [FACTS] });
    expect(seen).toEqual({
      url: "https://hub.example/api/v1/maps/lookup",
      body: { names: [ISIS] },
    });
  });

  /// The hub refuses a batch over its cap with a 413, so the cap is honoured
  /// rather than discovered.
  it("splits a set larger than the hub's cap and joins the answers", async () => {
    const names = Array.from(
      { length: MAX_LOOKUP_NAMES + 3 },
      (_, at) => `Map ${at}`,
    );
    const fetched = stubEchoingHub(() => FACTS);

    const read = await fetchMapFacts(BASE, names);

    expect(fetched).toHaveBeenCalledTimes(2);
    const sizes = fetched.mock.calls.map(
      ([, init]) => JSON.parse(String((init as RequestInit).body)).names.length,
    );
    expect(sizes).toEqual([MAX_LOOKUP_NAMES, 3]);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.maps).toHaveLength(names.length);
  });

  it("says why when the hub cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const read = await fetchMapFacts(BASE, [ISIS]);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain("hub.example");
  });

  it("passes the hub's own words on from a refusal", async () => {
    stubFetch([
      { status: 413, body: { error: "That request carried 501 names." } },
    ]);
    const read = await fetchMapFacts(BASE, [ISIS]);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain("501 names");
  });
});
