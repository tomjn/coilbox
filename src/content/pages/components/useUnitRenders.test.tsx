// @vitest-environment happy-dom
/**
 * `useUnitRenders` in isolation, with the cache read, the draw and the encode
 * each stubbed at the seam they cross (issue #1951). Real WebGL rendering
 * (`renderUnit`) and the real render cache (`localRenders`/
 * `rememberLocalRender`) are both mocked: happy-dom has no WebGL context, and
 * what this file is checking is the wiring between the two, not either one's
 * own behaviour.
 *
 * The two facts the ticket cares about: every angle is asked about, and an
 * angle the cache already holds is shown without being drawn again.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnitModelPiece, UnitModelResult } from "@/content/bindings";

interface LocalAsk {
  game: string;
  variant: string;
  units: string[];
  sourceArchive?: string;
}

/** Which angles the cache already holds, set per test. Keyed by the bare
 *  angle ("top"), not the `render:` variant string. */
let held: string[] = [];
const localAsks: LocalAsk[] = [];
const remembered: { game: string; unit: string; variant: string }[] = [];
const drawnAngles: string[] = [];
const encodedAngles: string[] = [];
let encodeSkips = false;

vi.mock("@/hub/assets/localRenders", () => ({
  localRenders: async (
    game: string,
    variant: string,
    _rendererVersion: number,
    units: string[],
    sourceArchive?: string,
  ) => {
    localAsks.push({ game, variant, units, sourceArchive });
    const map = new Map<string, { file: string; variant: string }>();
    const angle = variant.replace("render:", "");
    for (const unit of units) {
      if (held.includes(angle))
        map.set(unit, { file: `${unit}-${angle}.webp`, variant });
    }
    return map;
  },
  rememberLocalRender: async (
    game: string,
    unit: string,
    asset: { variant: string },
  ) => {
    remembered.push({ game, unit, variant: asset.variant });
  },
}));

vi.mock("@/hub/assets/renderTop", () => ({
  RENDER_VERSION: 3,
  renderUnit: async (angle: string) => {
    drawnAngles.push(angle);
    return { width: 2, height: 2, rgba: new Uint8Array(2 * 2 * 4), frame: {} };
  },
}));

vi.mock("@/content/bindings", () => ({
  unitsyncUnitRender: async (input: { angle: string }) => {
    encodedAngles.push(input.angle);
    if (encodeSkips) {
      return { assetSkipped: "no-model", errors: [] };
    }
    return {
      asset: {
        variant: `render:${input.angle}`,
        origin: "rendered",
        sourceArchive: "Test Game test-1",
        path: `/cache/${input.angle}.webp`,
        hash: "hash",
        sourceHash: `src-${input.angle}`,
        sourceMember: "objects3d/thing.s3o",
        modelDigest: "digest",
        rendererVersion: 3,
        footprintX: 1,
        footprintZ: 1,
        encodeProfile: "webp-q80-256",
        mime: "image/webp",
        width: 2,
        height: 2,
        bytes: 40,
      },
      dataUrl: `data:image/webp;base64,${input.angle}`,
      errors: [],
    };
  },
}));

vi.mock("./UnitModelPanel", () => ({
  renderSkipReason: (skip: string) => `no picture: ${skip}`,
}));

const { useUnitRenders } = await import("./useUnitRenders");
const { RENDER_ANGLES } = await import("@/hub/assets/vocabulary");

const FIXTURE_MODEL: UnitModelResult = {
  format: "s3o",
  path: "objects3d/thing.s3o",
  radius: 10,
  height: 10,
  mid: [0, 0, 0],
  root: {
    name: "root",
    offset: [0, 0, 0],
    groups: [{ positions: [], normals: [], uvs: [], indices: [0, 1, 2] }],
    children: [],
  } as UnitModelPiece,
  textures: [],
  paletteFaces: 0,
  errors: [],
};

beforeEach(() => {
  held = [];
  localAsks.length = 0;
  remembered.length = 0;
  drawnAngles.length = 0;
  encodedAngles.length = 0;
  encodeSkips = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useUnitRenders", () => {
  it("asks the cache about all four angles", async () => {
    renderHook(() =>
      useUnitRenders(
        "/engine",
        "/data",
        "test.sdz",
        "TG",
        "armsolar",
        "objects3d/thing.s3o",
        1,
        1,
        null,
      ),
    );

    await waitFor(() => expect(localAsks).toHaveLength(RENDER_ANGLES.length));
    expect(localAsks.map((a) => a.variant).sort()).toEqual(
      RENDER_ANGLES.map((a) => `render:${a}`).sort(),
    );
  });

  it("shows a cached render without drawing it again", async () => {
    held = ["top"];

    const { result } = renderHook(() =>
      useUnitRenders(
        "/engine",
        "/data",
        "test.sdz",
        "TG",
        "armsolar",
        "objects3d/thing.s3o",
        1,
        1,
        FIXTURE_MODEL,
      ),
    );

    await waitFor(() => expect(result.current.top.status).toBe("ready"));
    // Wrapped in the `coilbox://` asset scheme, the same as any other cached
    // hub asset (`hubAssetUrl` is the real one here, not stubbed).
    expect(result.current.top.url).toBe(
      "coilbox://localhost/hubasset/armsolar-top.webp",
    );
    // The other three angles have no cached render, so they still get drawn.
    await waitFor(() =>
      expect(drawnAngles.sort()).toEqual(["angled", "front", "side"]),
    );
    // The cached angle is never handed to the drawer.
    expect(drawnAngles).not.toContain("top");
  });

  it("waits for the model before drawing an angle the cache did not have", async () => {
    const { result, rerender } = renderHook(
      ({ model }: { model: UnitModelResult | null }) =>
        useUnitRenders(
          "/engine",
          "/data",
          "test.sdz",
          "TG",
          "armsolar",
          "objects3d/thing.s3o",
          1,
          1,
          model,
        ),
      { initialProps: { model: null as UnitModelResult | null } },
    );

    // The cache read still runs with no model, and finds nothing.
    await waitFor(() => expect(localAsks).toHaveLength(RENDER_ANGLES.length));
    expect(drawnAngles).toHaveLength(0);
    expect(result.current.top.status).not.toBe("ready");

    rerender({ model: FIXTURE_MODEL });

    await waitFor(() =>
      expect(drawnAngles.sort()).toEqual([...RENDER_ANGLES].sort()),
    );
    await waitFor(() => {
      for (const r of Object.values(result.current)) {
        expect(r.status).toBe("ready");
      }
    });
  });

  it("remembers a freshly drawn render so a later visit's cache read can find it", async () => {
    renderHook(() =>
      useUnitRenders(
        "/engine",
        "/data",
        "test.sdz",
        "TG",
        "armsolar",
        "objects3d/thing.s3o",
        1,
        1,
        FIXTURE_MODEL,
      ),
    );

    await waitFor(() => expect(remembered).toHaveLength(RENDER_ANGLES.length));
    expect(remembered.map((r) => r.unit)).toEqual(
      RENDER_ANGLES.map(() => "armsolar"),
    );
    expect(remembered.map((r) => r.variant).sort()).toEqual(
      RENDER_ANGLES.map((a) => `render:${a}`).sort(),
    );
  });

  it("says why an angle the engine refused to draw is unavailable, rather than showing nothing", async () => {
    encodeSkips = true;

    const { result } = renderHook(() =>
      useUnitRenders(
        "/engine",
        "/data",
        "test.sdz",
        "TG",
        "armsolar",
        "objects3d/thing.s3o",
        1,
        1,
        FIXTURE_MODEL,
      ),
    );

    await waitFor(() => expect(result.current.top.status).toBe("unavailable"));
    expect(result.current.top.message).toBe("no picture: no-model");
  });

  it("draws every angle fresh, and remembers none of them, for a game with no modinfo shortname", async () => {
    renderHook(() =>
      useUnitRenders(
        "/engine",
        "/data",
        "test.sdz",
        undefined,
        "armsolar",
        "objects3d/thing.s3o",
        1,
        1,
        FIXTURE_MODEL,
      ),
    );

    await waitFor(() =>
      expect(drawnAngles.sort()).toEqual([...RENDER_ANGLES].sort()),
    );
    expect(localAsks).toHaveLength(0);
    expect(remembered).toHaveLength(0);
  });
});
