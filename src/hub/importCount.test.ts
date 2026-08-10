import { afterEach, describe, expect, it, vi } from "vitest";

// Same stubs as config.test.ts: both published dists use extensionless relative
// imports Vitest's node resolver won't load from node_modules. These tests only
// exercise importCountUrl and reportImport, which are pure of both.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [true, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { importCountUrl, reportImport } from "./importCount";

const HUB = "https://hub.test";

describe("importCountUrl", () => {
  it("addresses the item that was imported", () => {
    expect(importCountUrl("item-1", HUB, true)).toBe(
      "https://hub.test/api/v1/items/item-1/imported",
    );
  });

  it("keeps a hub served under a path prefix", () => {
    expect(importCountUrl("item-1", "https://example.test/hub/", true)).toBe(
      "https://example.test/hub/api/v1/items/item-1/imported",
    );
  });

  it("encodes an id that would otherwise change the path", () => {
    expect(importCountUrl("a/b", HUB, true)).toBe(
      "https://hub.test/api/v1/items/a%2Fb/imported",
    );
  });

  it("reports nothing for an import that named no item", () => {
    expect(importCountUrl(undefined, HUB, true)).toBeNull();
  });

  it("reports nothing when there is no hub this session trusts", () => {
    expect(importCountUrl("item-1", null, true)).toBeNull();
  });

  it("reports nothing when counting is switched off", () => {
    expect(importCountUrl("item-1", HUB, false)).toBeNull();
  });
});

describe("reportImport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts with no body", () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    reportImport(`${HUB}/api/v1/items/item-1/imported`);

    expect(fetch).toHaveBeenCalledWith(
      "https://hub.test/api/v1/items/item-1/imported",
      { method: "POST" },
    );
  });

  it("sends nothing when there is nothing to report", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    reportImport(null);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns before the request settles, so an import never waits on it", () => {
    // Never resolves. The call still has to come straight back, because the
    // import has already succeeded by the time this runs.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    expect(reportImport(`${HUB}/api/v1/items/item-1/imported`)).toBeUndefined();
  });

  it("hands the request a failure handler, so an unreachable hub raises nothing", () => {
    const request = { catch: vi.fn() };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => request),
    );

    reportImport(`${HUB}/api/v1/items/item-1/imported`);

    expect(request.catch).toHaveBeenCalled();
  });
});
