import { afterEach, describe, expect, it, vi } from "vitest";
import { containerKindName, containerKindPlural } from "@/container/names";
import {
  describeItem,
  fetchHubGames,
  fetchHubItems,
  HUB_KINDS,
  hubGamesUrl,
  hubItemsUrl,
  hubItemUrl,
  kindLabelPlural,
  kindsPlural,
  readGamesBody,
  readItemBody,
  readItemsBody,
} from "./api";

const BASE = "https://hub.example";

function itemsBody(items: unknown[] = []) {
  return {
    format: "coilbox-hub-items",
    version: 1,
    page: 1,
    page_size: 24,
    total: items.length,
    items,
  };
}

/** Stub `fetch` with one canned response. */
function stubFetch(
  response: Partial<Response> & { json?: () => Promise<unknown> },
) {
  const fn = vi.fn(async () => response as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hubItemsUrl", () => {
  it("sends no query string when nothing is filtered", () => {
    expect(hubItemsUrl(BASE, {})).toBe(`${BASE}/api/v1/items`);
  });

  it("leaves blank filters off rather than sending them empty", () => {
    expect(hubItemsUrl(BASE, { kind: [], tag: [""], q: "  ", game: "" })).toBe(
      `${BASE}/api/v1/items`,
    );
  });

  it("carries every filter the API accepts", () => {
    const url = new URL(
      hubItemsUrl(BASE, {
        kind: ["challenge"],
        game: "Balanced Annihilation",
        map: "Comet Catcher",
        tag: ["1v1"],
        author: ["tomjn"],
        q: "obsidian",
        sort: "title",
        page: 3,
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "challenge",
      game: "Balanced Annihilation",
      map: "Comet Catcher",
      tag: "1v1",
      author: "tomjn",
      q: "obsidian",
      sort: "title",
      page: "3",
    });
  });

  it("repeats kind, author and tag for more than one value", () => {
    const url = new URL(
      hubItemsUrl(BASE, {
        kind: ["preset", "blueprint"],
        author: ["tomjn", "someone"],
        tag: ["1v1", "flat"],
      }),
    );
    expect(url.searchParams.getAll("kind")).toEqual(["preset", "blueprint"]);
    expect(url.searchParams.getAll("author")).toEqual(["tomjn", "someone"]);
    expect(url.searchParams.getAll("tag")).toEqual(["1v1", "flat"]);
  });

  it("omits sort when it is newest, the default", () => {
    expect(hubItemsUrl(BASE, { sort: undefined })).toBe(`${BASE}/api/v1/items`);
  });

  it("omits page 1, which is the default", () => {
    expect(hubItemsUrl(BASE, { page: 1 })).toBe(`${BASE}/api/v1/items`);
  });

  it("keeps a hub served under a path prefix working", () => {
    expect(hubItemsUrl("https://example.com/hub/", {})).toBe(
      "https://example.com/hub/api/v1/items",
    );
  });

  it("escapes an id in an item URL", () => {
    expect(hubItemUrl(BASE, "a/b")).toBe(`${BASE}/api/v1/items/a%2Fb`);
  });
});

describe("readItemsBody", () => {
  it("reads a listing", () => {
    const result = readItemsBody(itemsBody([{ id: "1", title: "One" }]));
    expect(result).toMatchObject({
      ok: true,
      value: { page: 1, pageSize: 24, total: 1 },
    });
  });

  it("refuses a version this build predates", () => {
    const result = readItemsBody({ ...itemsBody(), version: 2 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("newer than this copy");
  });

  it("refuses a response that is not the hub's at all", () => {
    const result = readItemsBody({ hello: "world" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("not a coilbox hub");
  });

  it("refuses a listing whose items are missing", () => {
    const result = readItemsBody({ ...itemsBody(), items: undefined });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("readItemBody", () => {
  it("reads an item with a container address", () => {
    const result = readItemBody({
      format: "coilbox-hub-item",
      version: 1,
      item: { id: "1", container_url: `${BASE}/i/1` },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { container_url: `${BASE}/i/1` },
    });
  });

  it("refuses an item with no container address", () => {
    const result = readItemBody({
      format: "coilbox-hub-item",
      version: 1,
      item: { id: "1" },
    });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("fetchHubItems", () => {
  it("names the host when the hub cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await fetchHubItems(BASE, {});
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toContain("hub.example");
      expect(result.reason).toContain("waking up");
    }
  });

  it("passes a 400 back in the hub's own words", async () => {
    stubFetch({
      ok: false,
      status: 400,
      json: async () => ({ error: "Unknown kind: nope" }),
    });
    const result = await fetchHubItems(BASE, {});
    expect(result).toEqual({ ok: false, reason: "Unknown kind: nope" });
  });

  it("blames a cold start for a 5xx", async () => {
    stubFetch({
      ok: false,
      status: 503,
      json: async () => ({ error: "The gallery could not be read just now." }),
    });
    const result = await fetchHubItems(BASE, {});
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("waking up");
  });

  it("survives an error response with no JSON body", async () => {
    stubFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    const result = await fetchHubItems(BASE, {});
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("could not answer");
  });

  it("returns the page on a good response", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => itemsBody([{ id: "1" }]),
    });
    const result = await fetchHubItems(BASE, { q: "x" });
    expect(result).toMatchObject({ ok: true, value: { total: 1 } });
  });
});

function gamesBody(games: unknown[] = []) {
  return {
    format: "coilbox-hub-games",
    version: 1,
    games,
  };
}

const A_GAME = {
  shortname: "BA",
  title: "Balanced Annihilation",
  description: null,
  featured: true,
  downloads: [{ kind: "rapid", value: "ba:stable" }],
  logo: null,
  card: null,
  faction_count: 2,
  unit_count: 400,
  item_count: 12,
};

describe("hubGamesUrl", () => {
  it("builds the games listing address", () => {
    expect(hubGamesUrl(BASE)).toBe(`${BASE}/api/v1/games`);
  });

  it("keeps a hub served under a path prefix working", () => {
    expect(hubGamesUrl("https://example.com/hub/")).toBe(
      "https://example.com/hub/api/v1/games",
    );
  });
});

describe("readGamesBody", () => {
  it("reads a listing", () => {
    const result = readGamesBody(gamesBody([A_GAME]));
    expect(result).toEqual({ ok: true, value: [A_GAME] });
  });

  it("reads an empty listing as no games, not a failure", () => {
    const result = readGamesBody(gamesBody([]));
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("refuses a version this build predates", () => {
    const result = readGamesBody({ ...gamesBody(), version: 2 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("newer than this copy");
  });

  it("refuses a response that is not the hub's games route at all", () => {
    const result = readGamesBody({ hello: "world" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("not a coilbox hub");
  });

  it("refuses a listing whose games are missing", () => {
    const result = readGamesBody({ ...gamesBody(), games: undefined });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("fetchHubGames", () => {
  it("names the host when the hub cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await fetchHubGames(BASE);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toContain("hub.example");
      expect(result.reason).toContain("waking up");
    }
  });

  // The hub deliberately answers 503 rather than an empty list when its
  // catalog cannot be read (`GET /api/v1/games` in coilbox-hub): an empty list
  // is a claim the hub holds no games, and a 503 says it could not check.
  it("blames a cold start for a 503, rather than reading it as no games", async () => {
    stubFetch({
      ok: false,
      status: 503,
      json: async () => ({ error: "The catalog could not be read just now." }),
    });
    const result = await fetchHubGames(BASE);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("waking up");
  });

  it("passes a 4xx back in the hub's own words", async () => {
    stubFetch({
      ok: false,
      status: 400,
      json: async () => ({ error: "nope" }),
    });
    const result = await fetchHubGames(BASE);
    expect(result).toEqual({ ok: false, reason: "nope" });
  });

  it("returns the games on a good response", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => gamesBody([A_GAME]),
    });
    const result = await fetchHubGames(BASE);
    expect(result).toEqual({ ok: true, value: [A_GAME] });
  });
});

/**
 * The sentence a screen uses to say what the hub carries (issue #1502). Built
 * from the kinds rather than written out, because the hand written version sat
 * under a row of filter chips it contradicted.
 */
describe("the kinds, as a sentence", () => {
  it("lists every kind the hub carries, in the plural", () => {
    expect(kindsPlural()).toBe(
      "Singleplayer presets, challenges, setup packs, scenarios, base blueprints and unit tweak projects",
    );
  });

  it("cannot fall behind the kinds the filter chips offer", () => {
    for (const kind of HUB_KINDS) {
      expect(kindsPlural().toLowerCase()).toContain(
        kindLabelPlural(kind).toLowerCase(),
      );
    }
  });
});

/**
 * What a filter chip calls a kind (issue #1795). The chips used to keep their
 * own shorter plurals here, because they shared a row with the search box and
 * had no room for the longer words. The chips have a row of their own now, so
 * they read from the same names as everything else.
 */
describe("what a filter chip calls a kind", () => {
  it("uses the name the rest of coilbox gives the kind", () => {
    for (const kind of HUB_KINDS) {
      expect(kindLabelPlural(kind).toLowerCase()).toBe(
        containerKindPlural(kind),
      );
    }
  });

  it("opens with a capital, because a chip is not part of a sentence", () => {
    expect(kindLabelPlural("preset")).toBe("Singleplayer presets");
    expect(kindLabelPlural("blueprint")).toBe("Base blueprints");
  });

  it("carries a unit tweak project, now the hub accepts the kind (issue #2727)", () => {
    expect(HUB_KINDS).toContain("mod-project");
    expect(kindLabelPlural("mod-project")).toBe("Unit tweak projects");
  });
});

/**
 * The badge on a card (issue #1520). It used to read from a second map of names
 * kept here, which said "Preset" and "Blueprint" where every other screen in
 * coilbox says Singleplayer preset and Base blueprint.
 */
describe("what a card's badge calls an item", () => {
  it("uses the name the rest of coilbox gives the kind", () => {
    for (const kind of HUB_KINDS) {
      expect(describeItem(kind, null).toLowerCase()).toBe(
        containerKindName(kind),
      );
    }
  });

  it("opens with a capital, because a badge is not part of a sentence", () => {
    expect(describeItem("preset", null)).toBe("Singleplayer preset");
    expect(describeItem("blueprint", null)).toBe("Base blueprint");
  });

  it("says which of the two a challenge is, in place of the kind", () => {
    expect(describeItem("challenge", "conquest")).toBe("Conquest challenge");
    expect(describeItem("challenge", "warpath")).toBe("Warpath challenge");
    expect(describeItem("challenge", null)).toBe("Challenge");
  });
});
