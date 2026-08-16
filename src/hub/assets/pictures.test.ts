import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetIdentity } from "./have";
import {
  type AssetPicture,
  fetchHubPictures,
  hubPicturesUrl,
  MAX_PICTURE_KEYS,
  readPicturesBody,
} from "./pictures";

const BASE = "https://hub.example";

const MAP: AssetIdentity = {
  keyed_on: "map",
  map_name: "Comet Catcher Remake 1.8",
  variant: "minimap",
};

const UNIT: AssetIdentity = {
  keyed_on: "unit",
  game: "bar",
  unit_name: "armsolar",
  variant: "buildpic",
};

/** The picture the local hub answers with for the map above, field for field. */
const HELD: AssetPicture = {
  tier: "static",
  path: "maps/minimap/ccr18-abcdef.webp",
  url: "https://tomjn.github.io/coilbox-assets/maps/minimap/ccr18-abcdef.webp",
  width: 1024,
  height: 1024,
  served_variant: "minimap",
  substituted: false,
};

/** An answer in the shape `buildAssetPicturesBody` builds. */
function body(results: unknown[], over: Record<string, unknown> = {}) {
  return {
    format: "coilbox-hub-asset-pictures",
    version: 1,
    results,
    ...over,
  };
}

function mapResult(picture: unknown, over: Record<string, unknown> = {}) {
  return { ...MAP, picture, ...over };
}

/** Stub `fetch` with one canned response per call, cycling the last one. */
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

/**
 * Stub a hub that answers every batch with the keys it was asked, in order, and
 * whatever `picture` the test hands back for that batch. Needed wherever the
 * request is split, since a canned answer cannot echo keys it has not seen.
 */
function stubEchoingHub(
  onBatch: (asked: AssetIdentity[]) => AssetPicture | null,
) {
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const asked = JSON.parse(String(init.body)).keys as AssetIdentity[];
    const picture = onBatch(asked);
    return {
      ok: true,
      status: 200,
      json: async () => body(asked.map((key) => ({ ...key, picture }))),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hubPicturesUrl", () => {
  it("hangs off the configured base", () => {
    expect(hubPicturesUrl(BASE)).toBe(`${BASE}/api/v1/assets/pictures`);
  });

  it("keeps a hub served under a path prefix", () => {
    expect(hubPicturesUrl("https://example.com/hub/")).toBe(
      "https://example.com/hub/api/v1/assets/pictures",
    );
  });
});

describe("the request", () => {
  it("sends the keys by the names the hub insists on", async () => {
    let sent: unknown;
    stubFetch(
      [{ body: body([mapResult(null), { ...UNIT, picture: null }]) }],
      (_url, init) => {
        sent = JSON.parse(String(init.body));
      },
    );

    await fetchHubPictures(BASE, [MAP, UNIT]);

    // Snake case, flat, and no `source_hash`: an unknown field is a 400 on the
    // hub and a `mapName` that was ignored would draw a placeholder over a
    // picture that exists.
    expect(sent).toEqual({
      keys: [
        {
          keyed_on: "map",
          map_name: "Comet Catcher Remake 1.8",
          variant: "minimap",
        },
        {
          keyed_on: "unit",
          game: "bar",
          unit_name: "armsolar",
          variant: "buildpic",
        },
      ],
    });
  });

  it("carries no bearer token, because the route is public", async () => {
    let headers: unknown;
    stubFetch([{ body: body([mapResult(null)]) }], (_url, init) => {
      headers = init.headers;
    });

    await fetchHubPictures(BASE, [MAP]);

    expect(Object.keys(headers as Record<string, string>)).not.toContain(
      "authorization",
    );
  });

  it("asks nobody at all for an empty set", async () => {
    const fetched = stubFetch([{ body: body([]) }]);
    expect(await fetchHubPictures(BASE, [])).toEqual({
      ok: true,
      pictures: [],
    });
    expect(fetched).not.toHaveBeenCalled();
  });

  /** The hub refuses 501 keys with a 413, so the cap is honoured rather than
   *  discovered. */
  it("splits a set larger than the hub's cap rather than being refused", async () => {
    const keys: AssetIdentity[] = Array.from({ length: 1200 }, (_, n) => ({
      keyed_on: "map",
      map_name: `Map ${n}`,
      variant: "minimap",
    }));
    const sizes: number[] = [];
    stubEchoingHub((asked) => {
      sizes.push(asked.length);
      return null;
    });

    const answered = await fetchHubPictures(BASE, keys);

    expect(sizes).toEqual([MAX_PICTURE_KEYS, MAX_PICTURE_KEYS, 200]);
    expect(answered).toEqual({ ok: true, pictures: keys.map(() => null) });
  });
});

describe("the answer", () => {
  it("reads a picture the hub holds", async () => {
    stubFetch([{ body: body([mapResult(HELD)]) }]);
    expect(await fetchHubPictures(BASE, [MAP])).toEqual({
      ok: true,
      pictures: [HELD],
    });
  });

  it("reads a null for an identity the hub holds nothing approved for", () => {
    // The pending row on the local hub answers exactly this: a 200 with no
    // picture, because moderation has not passed it.
    expect(readPicturesBody(body([mapResult(null)]), [MAP])).toEqual({
      ok: true,
      pictures: [null],
    });
  });

  it("keeps the served variant, so a substituted picture can be told apart", () => {
    const render: AssetIdentity = { ...UNIT, variant: "render:top" };
    const substituted = {
      ...HELD,
      served_variant: "buildpic",
      substituted: true,
    };
    expect(
      readPicturesBody(body([{ ...render, picture: substituted }]), [render]),
    ).toEqual({ ok: true, pictures: [substituted] });
  });

  it("refuses something that is not this hub's lookup", () => {
    const refused = readPicturesBody({ results: [] }, [MAP]);
    expect(refused).toEqual({
      ok: false,
      reason: expect.stringContaining("not a coilbox hub"),
    });
  });

  it("refuses a newer version rather than guessing at it", () => {
    const refused = readPicturesBody(body([], { version: 2 }), [MAP]);
    expect(refused).toEqual({
      ok: false,
      reason: expect.stringContaining("Update coilbox"),
    });
  });

  /** Answers are read by index, so a short one cannot be lined up. */
  it("refuses an answer that does not cover the batch", () => {
    expect(readPicturesBody(body([]), [MAP, UNIT])).toEqual({
      ok: false,
      reason: "The hub answered 0 of 2 keys.",
    });
  });

  /** Worse than no picture: one map's minimap on another map's card. */
  it("refuses an answer that came back against a different key", () => {
    const swapped = body([{ ...UNIT, picture: null }, mapResult(HELD)]);
    expect(readPicturesBody(swapped, [MAP, UNIT])).toEqual({
      ok: false,
      reason: "The hub answered key 0 with a different key.",
    });
  });

  it("reads a malformed picture as no picture", () => {
    const nonsense = body([mapResult({ tier: "somewhere", path: 4 })]);
    expect(readPicturesBody(nonsense, [MAP])).toEqual({
      ok: true,
      pictures: [null],
    });
  });
});

describe("a hub that will not answer", () => {
  it("passes on the hub's own words when it refuses", async () => {
    stubFetch([
      { status: 400, body: { error: "keys[3] unknown field: hash" } },
    ]);
    expect(await fetchHubPictures(BASE, [MAP])).toEqual({
      ok: false,
      reason: "keys[3] unknown field: hash",
    });
  });

  it("names the host when it cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no route");
      }),
    );
    expect(await fetchHubPictures(BASE, [MAP])).toEqual({
      ok: false,
      reason: "Could not reach the hub at hub.example.",
    });
  });

  /** A partial answer read by index would line the rest up against the wrong
   *  keys, so one bad request fails the set rather than half of it. */
  it("fails the whole set when one batch of a split fails", async () => {
    const keys: AssetIdentity[] = Array.from({ length: 501 }, (_, n) => ({
      keyed_on: "map",
      map_name: `Map ${n}`,
      variant: "minimap",
    }));
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const asked = JSON.parse(String(init.body)).keys as AssetIdentity[];
        if (call++ === 1) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: "The hub is asleep." }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () =>
            body(asked.map((key) => ({ ...key, picture: null }))),
        } as Response;
      }),
    );

    expect(await fetchHubPictures(BASE, keys)).toEqual({
      ok: false,
      reason: "The hub is asleep.",
    });
  });
});
