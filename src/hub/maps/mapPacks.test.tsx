// @vitest-environment happy-dom

/**
 * The wiring between the hub's (proposed, not-yet-built - issue #3143) map
 * packs route and the "Map packs" menu, run rather than read. `hubMapPackToList`
 * on its own proves nothing about when the hook asks, what it does with a pack
 * that isn't featured, or what it shows while the hub is unreachable, so those
 * are what this drives.
 */

import { memoryStorage, PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProfile } from "@/profile/profile";
import type { HubMapPack } from "../api";
import { hubMapPackToList, useFeaturedHubMapPacks } from "./mapPacks";

function mapPacksBody(packs: unknown[]) {
  return { format: "coilbox-hub-map-packs", version: 1, packs };
}

const FEATURED: HubMapPack = {
  id: "bar-classics",
  title: "BAR classics",
  blurb: "The maps everyone plays",
  featured: true,
  maps: [
    {
      id: "isis",
      title: "Isis",
      download: { kind: "map", springName: "Isis 1.3" },
    },
  ],
};

const UNFEATURED = { ...FEATURED, id: "unfeatured", featured: false };

/** A hub answering one canned map-packs response, recording every request. */
function stubHub(response: unknown, status = 200) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <PersistentStoreProvider storage={memoryStorage()}>
      {children}
    </PersistentStoreProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("hubMapPackToList", () => {
  it("carries a pack's maps across unchanged, dropping only `featured`", () => {
    expect(hubMapPackToList(FEATURED)).toEqual({
      id: "bar-classics",
      title: "BAR classics",
      blurb: "The maps everyone plays",
      maps: FEATURED.maps,
    });
  });
});

describe("useFeaturedHubMapPacks", () => {
  it("returns the hub's featured packs", async () => {
    stubHub(mapPacksBody([FEATURED]));

    const { result } = renderHook(() => useFeaturedHubMapPacks(), { wrapper });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe("bar-classics");
  });

  it("leaves out a pack the hub holds but has not featured", async () => {
    stubHub(mapPacksBody([UNFEATURED]));

    const { result } = renderHook(() => useFeaturedHubMapPacks(), { wrapper });

    // Give the fetch a turn, then check nothing ever lands.
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("returns no packs, not an error, when the hub has none featured", async () => {
    stubHub(mapPacksBody([]));

    const { result } = renderHook(() => useFeaturedHubMapPacks(), { wrapper });

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("returns no packs, not an error, when the hub cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const { result } = renderHook(() => useFeaturedHubMapPacks(), { wrapper });

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("returns no packs, not an error, when the route does not exist yet (issue #3143)", async () => {
    stubHub({ error: "not found" }, 404);

    const { result } = renderHook(() => useFeaturedHubMapPacks(), { wrapper });

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("asks a hub the profile switched off for nothing at all", async () => {
    const fn = stubHub(mapPacksBody([FEATURED]));
    const profile = getProfile();
    profile.hub = false;

    try {
      const { result } = renderHook(() => useFeaturedHubMapPacks(), {
        wrapper,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fn).not.toHaveBeenCalled();
      expect(result.current).toEqual([]);
    } finally {
      profile.hub = undefined;
    }
  });
});
