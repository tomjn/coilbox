// @vitest-environment happy-dom

/**
 * The wiring between a plan, this machine's own renders and the hub, run rather
 * than read (issue #1724).
 *
 * The rules that live only in the hook are the ones this drives: ask this machine
 * first, ask the hub only about what it has not got, and still draw a plan as its
 * buildings when there is no hub at all. None of those shows up in a unit test of
 * the pieces, because every one of them fails quietly as a plan full of squares,
 * which is exactly what a plan looked like before any of this.
 *
 * A DOM environment is opened for this file alone. Most of the suite has no React
 * in it and putting it all in a DOM costs time for nothing.
 */

import { memoryStorage, PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the plugin was asked for, and what it answers with. The command layer is
 *  stubbed rather than the module, so the arguments the hook really sends are
 *  what a test reads. */
const localAsks: {
  game: string;
  variant: string;
  rendererVersion: number;
  sourceArchive?: string;
  units: string[];
}[] = [];
let holding: string[] = [];

vi.mock("@/content/bindings", () => ({
  unitsyncLocalRenders: async (input: {
    game: string;
    variant: string;
    rendererVersion: number;
    sourceArchive?: string;
    units: string[];
  }) => {
    localAsks.push(input);
    const renders: Record<string, unknown> = {};
    for (const unit of input.units) {
      if (!holding.includes(unit)) continue;
      renders[unit] = {
        game: input.game,
        unit,
        variant: input.variant,
        file: `${unit}-render.webp`,
        path: `/cache/hub/${unit}-render.webp`,
        mime: "image/webp",
        encodeProfile: "webp-q80-256",
        sourceHash: `src-${unit}`,
        modelDigest: `model-${unit}`,
        sourceArchive: "Beyond All Reason test-1",
        rendererVersion: input.rendererVersion,
        width: 255,
        height: 204,
      };
    }
    return { renders };
  },
  unitsyncRememberRender: async () => ({ remembered: true }),
}));

import type { AssetIdentity } from "./have";
import { forgetHeldPictures } from "./heldPictures";
import type { AssetPicture } from "./pictures";
import { useHeldUnitPictures } from "./useUnitPictures";

const HELD: AssetPicture = {
  tier: "static",
  path: "u/bar/armlab/render-top.webp",
  url: "https://hub.example/whatever.webp",
  width: 250,
  height: 200,
  served_variant: "render:top",
  substituted: false,
};

/** A hub holding a render of the named units and nothing else, recording every
 *  batch it is sent. The same stub shape as `./useMapPicture.test.tsx`. */
function stubHub(units: string[] = []) {
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
            key.keyed_on === "unit" && units.includes(key.unit_name)
              ? HELD
              : null,
        })),
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { fn, batches };
}

/** Every unit the hub was asked about, across all batches. */
function askedOf(batches: AssetIdentity[][]): string[] {
  return batches
    .flat()
    .map((key) => (key.keyed_on === "unit" ? key.unit_name : key.map_name));
}

/** The settings store `useHubUrl` reads through, which the frame's `useSetting`
 *  refuses to run outside. */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <PersistentStoreProvider storage={memoryStorage()}>
      {children}
    </PersistentStoreProvider>
  );
}

beforeEach(() => {
  forgetHeldPictures();
  localAsks.length = 0;
  holding = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useHeldUnitPictures", () => {
  /**
   * The whole complaint in the ticket. Coilbox drew these pictures, and a plan
   * went to the network for them anyway.
   */
  it("draws a building from this machine's own render", async () => {
    stubHub([]);
    holding = ["armlab"];

    const { result } = renderHook(
      () => useHeldUnitPictures("bar", ["ArmLab"]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get("armlab")).toEqual({
      url: "coilbox://localhost/hubasset/armlab-render.webp",
      // A render, so it is drawn in a render's box with its bleed.
      framed: true,
    });
  });

  /** The hub is asked about what is left, and not about anything this machine
   *  already answered. Every ask costs somebody else a row read. */
  it("asks the hub only about the units it has no render of", async () => {
    const { fn, batches } = stubHub([]);
    holding = ["armlab"];

    const { result } = renderHook(
      () => useHeldUnitPictures("bar", ["armlab", "armsolar"]),
      { wrapper },
    );

    await waitFor(() => expect(fn).toHaveBeenCalled());
    expect(askedOf(batches)).toEqual(["armsolar"]);
    // And the local one is still on the plan after the hub has answered.
    await waitFor(() => expect(result.current.get("armlab")).toBeTruthy());
  });

  /** A layout of things nobody here has drawn is the ordinary case, and the hub
   *  is still where those come from. */
  it("falls back to the hub for a unit this machine has never drawn", async () => {
    stubHub(["armsolar"]);

    const { result } = renderHook(
      () => useHeldUnitPictures("bar", ["armsolar"]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get("armsolar")?.url).toContain(
      "u/bar/armlab/render-top.webp",
    );
  });

  /** The point of keeping a copy: no hub in the picture at all, and the plan is
   *  still drawn as its buildings. */
  it("draws its buildings with the hub unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no network");
      }),
    );
    holding = ["armlab"];

    const { result } = renderHook(
      () => useHeldUnitPictures("bar", ["armlab", "armsolar"]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get("armlab")?.framed).toBe(true);
    expect(result.current.has("armsolar")).toBe(false);
  });

  /** The version goes in every ask, so a `RENDER_VERSION` bump misses on the
   *  plugin's side rather than being sorted out here. */
  it("asks by the renderer version and the angle a plan draws", async () => {
    stubHub([]);

    renderHook(() => useHeldUnitPictures("bar", ["armlab"]), { wrapper });

    await waitFor(() => expect(localAsks).toHaveLength(1));
    expect(localAsks[0].variant).toBe("render:top");
    expect(localAsks[0].rendererVersion).toBeGreaterThan(0);
    // No archive, because a hub item page has none to give. See the note in
    // `crates/tauri-plugin-coilbox-unitsync/src/renderindex.rs`.
    expect(localAsks[0].sourceArchive).toBeUndefined();
  });

  /** A caller that knows which build the plan is for says so, and a render drawn
   *  against a different one is then refused before it reaches the plan. */
  it("names the archive when the caller knows it", async () => {
    stubHub([]);

    renderHook(
      () => useHeldUnitPictures("bar", ["armlab"], "Beyond All Reason test-1"),
      { wrapper },
    );

    await waitFor(() => expect(localAsks).toHaveLength(1));
    expect(localAsks[0].sourceArchive).toBe("Beyond All Reason test-1");
  });

  /** Once each and in a stable order, so a layout that places the same building
   *  twenty times is one row to read. */
  it("asks about a repeated building once", async () => {
    stubHub([]);

    renderHook(
      () => useHeldUnitPictures("bar", ["armlab", "ARMLAB", "armlab"]),
      { wrapper },
    );

    await waitFor(() => expect(localAsks).toHaveLength(1));
    expect(localAsks[0].units).toEqual(["armlab"]);
  });

  /** A plan with no game to key on asks nothing at all. */
  it("asks nothing for a layout with no game", async () => {
    const { fn } = stubHub([]);

    const { result } = renderHook(() => useHeldUnitPictures(null, ["armlab"]), {
      wrapper,
    });

    await waitFor(() => expect(result.current.size).toBe(0));
    expect(localAsks).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });
});
