// @vitest-environment happy-dom

/**
 * The wiring between the ladder and the hub, run rather than read.
 *
 * `./picture.test.ts` covers the order of the rungs, `./heldPictures.test.ts`
 * covers the batching and the session memory, and neither notices when the hook
 * between them stops asking: every map quietly falls back to the drawing and
 * every other test still passes (issue #1706). The rules that live only in the
 * hook are "ask the hub only when there is no local picture" and "a profile with
 * the hub switched off asks nothing", so those are what this drives.
 *
 * A DOM environment is opened for this file alone, by the docblock at the top.
 * Most of the suite has no React in it and putting it all in a DOM costs time
 * for nothing.
 */

import { memoryStorage, PersistentStoreProvider } from "@picoframe/frame";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfile } from "@/profile/profile";
import type { AssetIdentity } from "./have";
import { forgetHeldPictures } from "./heldPictures";
import type { MapPicture } from "./picture";
import type { AssetPicture } from "./pictures";
import { DEFAULT_ASSET_CDN_BASE } from "./tier";
import { useMapPictureLadder, useMapPictureRung } from "./useMapPicture";

const HELD: AssetPicture = {
  tier: "static",
  path: "maps/minimap/isis-abcdef.webp",
  url: "https://tomjn.github.io/coilbox-assets/maps/minimap/isis-abcdef.webp",
  width: 1024,
  height: 768,
  served_variant: "minimap",
  substituted: false,
};

/** A hub holding a picture of the named maps and nothing else, recording every
 *  batch it is sent. The same stub shape as `./heldPictures.test.ts`. */
function stubHub(holding: string[] = []) {
  const batches: AssetIdentity[][] = [];
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const asked = JSON.parse(String(init.body)).keys as AssetIdentity[];
    batches.push(asked);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        format: "coilbox-hub-asset-pictures",
        version: 1,
        results: asked.map((key) => ({
          ...key,
          picture:
            key.keyed_on === "map" && holding.includes(key.map_name)
              ? HELD
              : null,
        })),
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { fn, batches };
}

/** Every map the hub was asked about, across all batches. */
function asked(batches: AssetIdentity[][]): string[] {
  return batches
    .flat()
    .map((key) => (key.keyed_on === "map" ? key.map_name : key.unit_name));
}

/** The settings store `useHubUrl` reads through, which the frame's `useSetting`
 *  refuses to run outside. Nothing is written to it, so the hub address under
 *  test is the built-in default. */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <PersistentStoreProvider storage={memoryStorage()}>
      {children}
    </PersistentStoreProvider>
  );
}

beforeEach(() => {
  forgetHeldPictures();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMapPictureLadder", () => {
  it("puts the hub's picture on the ladder for a map nobody here has", async () => {
    stubHub(["Isis 1.3"]);

    const { result } = renderHook(() => useMapPictureLadder("Isis 1.3", null), {
      wrapper,
    });

    // Before the hub answers there is nothing to draw but the outline.
    expect(result.current.map((rung) => rung.from)).toEqual(["placeholder"]);

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0]).toEqual({
      from: "static",
      url: `${DEFAULT_ASSET_CDN_BASE}maps/minimap/isis-abcdef.webp`,
      // The hub's own pixels, so the card does not reshape when it loads.
      width: 1024,
      height: 768,
    });
    expect(result.current[1].from).toBe("placeholder");
  });

  it("leaves the drawing in place when the hub holds no picture", async () => {
    const { fn } = stubHub([]);

    const { result } = renderHook(
      () => useMapPictureLadder("Nothing Here 1.0", null),
      { wrapper },
    );

    await waitFor(() => expect(fn).toHaveBeenCalled());
    expect(result.current.map((rung) => rung.from)).toEqual(["placeholder"]);
  });

  /** An installed archive wins the ladder outright, so asking is a request
   *  somebody else pays for and nobody reads. */
  it("does not ask about a map this session already has a picture of", async () => {
    const { fn, batches } = stubHub([]);

    // Two cards on one screen, one installed and one not, which is what makes
    // the assertion evidence rather than a race: the batch proves the flush ran.
    const { result } = renderHook(
      () => ({
        installed: useMapPictureLadder("Isis 1.3", "asset://minimap.png"),
        absent: useMapPictureLadder("Absent 1.0", null),
      }),
      { wrapper },
    );

    await waitFor(() => expect(fn).toHaveBeenCalled());
    expect(asked(batches)).toEqual(["Absent 1.0"]);
    expect(result.current.installed.map((rung) => rung.from)).toEqual([
      "local",
      "placeholder",
    ]);
  });

  it("asks about a map whose local picture never arrives", async () => {
    const { batches, fn } = stubHub(["Isis 1.3"]);

    // A card starts with the scan pending and gives up, which is a different
    // path through the hook than starting with the archive already rendered.
    const { result, rerender } = renderHook(
      ({ local }: { local: string | null }) =>
        useMapPictureLadder("Isis 1.3", local),
      {
        wrapper,
        initialProps: { local: "asset://minimap.png" as string | null },
      },
    );
    rerender({ local: null });

    await waitFor(() => expect(fn).toHaveBeenCalled());
    expect(asked(batches)).toEqual(["Isis 1.3"]);
    await waitFor(() => expect(result.current[0].from).toBe("static"));
  });

  /** A battle room's card outlives the map on it, so the picture has to go when
   *  the map does rather than when its replacement arrives. Held over, a room
   *  that switched to a map the hub has never seen keeps the old minimap. */
  it("drops the last map's picture the moment the card's map changes", async () => {
    stubHub(["Isis 1.3"]);

    const { result, rerender } = renderHook(
      ({ mapName }: { mapName: string }) => useMapPictureLadder(mapName, null),
      { wrapper, initialProps: { mapName: "Isis 1.3" } },
    );
    await waitFor(() => expect(result.current[0].from).toBe("static"));

    rerender({ mapName: "Nothing Here 1.0" });
    expect(result.current.map((rung) => rung.from)).toEqual(["placeholder"]);

    // And the hub answering for the new map does not bring the old one back.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.map((rung) => rung.from)).toEqual(["placeholder"]);
  });

  /** The one place a picture would otherwise reach a hub the distributor turned
   *  off. */
  it("asks a hub the profile switched off for nothing at all", async () => {
    const { fn } = stubHub(["Isis 1.3"]);
    const profile = getProfile();
    profile.hub = false;

    try {
      const { result } = renderHook(
        () => useMapPictureLadder("Isis 1.3", null),
        { wrapper },
      );
      // Long enough for the queue's microtask and the request after it.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(fn).not.toHaveBeenCalled();
      expect(result.current.map((rung) => rung.from)).toEqual(["placeholder"]);
    } finally {
      profile.hub = undefined;
    }

    // The control: the same map, the same stub, the hub back on. Without this
    // the case above passes for a broken harness that could never ask anything.
    const { result } = renderHook(() => useMapPictureLadder("Isis 1.3", null), {
      wrapper,
    });
    await waitFor(() => expect(result.current[0].from).toBe("static"));
  });

  it("asks nothing for a card that has no map name yet", async () => {
    const { fn } = stubHub([]);

    renderHook(() => useMapPictureLadder(undefined, null), { wrapper });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fn).not.toHaveBeenCalled();
  });
});

function rung(from: MapPicture["from"], url: string): MapPicture {
  if (from === "placeholder") return { from, name: "Isis 1.3", size: null };
  return { from, url, width: null, height: null };
}

describe("useMapPictureRung", () => {
  it("demotes a rung that fails to load, and stops at the drawing", () => {
    const ladder = [
      rung("local", "asset://minimap.png"),
      rung("static", "https://cdn.example/isis.webp"),
      rung("placeholder", ""),
    ];
    const { result } = renderHook(() => useMapPictureRung(ladder));

    expect(result.current.picture.from).toBe("local");
    act(() => result.current.onError());
    expect(result.current.picture.from).toBe("static");
    act(() => result.current.onError());
    expect(result.current.picture.from).toBe("placeholder");
    // The drawing has no URL to remember, so reporting a failure on it is a
    // no-op rather than the end of the ladder.
    act(() => result.current.onError());
    expect(result.current.picture.from).toBe("placeholder");
  });

  /** The ladder is rebuilt as its sources arrive, so a remembered position would
   *  point at a different rung than the one that failed. */
  it("remembers the URL that failed, not where it was", () => {
    const local = rung("local", "asset://minimap.png");
    const held = rung("static", "https://cdn.example/isis.webp");
    const drawing = rung("placeholder", "");

    const { result, rerender } = renderHook(
      ({ ladder }: { ladder: MapPicture[] }) => useMapPictureRung(ladder),
      { initialProps: { ladder: [local, drawing] } },
    );

    act(() => result.current.onError());
    expect(result.current.picture.from).toBe("placeholder");

    // The hub answers late and the local rung keeps its place at the top.
    rerender({ ladder: [local, held, drawing] });
    expect(result.current.picture).toBe(held);
  });
});
