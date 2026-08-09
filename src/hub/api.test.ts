import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchHubItems,
  hubItemsUrl,
  hubItemUrl,
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
    expect(hubItemsUrl(BASE, { kind: "", q: "  ", game: "" })).toBe(
      `${BASE}/api/v1/items`,
    );
  });

  it("carries every filter the API accepts", () => {
    const url = new URL(
      hubItemsUrl(BASE, {
        kind: "challenge",
        game: "Balanced Annihilation",
        map: "Comet Catcher",
        tag: "1v1",
        author: "tomjn",
        q: "obsidian",
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
      page: "3",
    });
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
