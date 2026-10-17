// @vitest-environment happy-dom

import { act, renderHook, waitFor } from "@testing-library/react";
import { gzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { legoGeometryUrl } from "../lib/assetUrl";
import { type LegoProject, newProject } from "./model";
import { encodeRawGeometry, type RawGeometry } from "./rawGeometry";
import { useRawGeometry } from "./useRawGeometry";

function geometry(id: string): RawGeometry {
  return {
    byId: new Map([
      [
        id,
        {
          id,
          vFirst: 0,
          vCount: 1,
          iFirst: 0,
          iCount: 3,
          bbox: { min: [0, 0, 0], max: [0, 0, 0] },
        },
      ],
    ]),
    vertices: new Float32Array(8),
    indices: new Uint32Array(3),
  };
}

const parts = newProject({
  id: "unit",
  rootPieceId: "root",
  name: "Rover",
  packId: "lego",
  packVersion: "1",
  now: "2026-10-17T00:00:00Z",
});

/** The unit with a lifted turret on its root. */
const mixed: LegoProject = {
  ...parts,
  pieces: [
    ...parts.pieces,
    {
      ...parts.pieces[0],
      id: "turret",
      name: "turret",
      parentId: "root",
      meshId: "mod/m0",
    },
  ],
};

let reads: string[];

beforeEach(() => {
  reads = [];
  vi.stubGlobal("fetch", async (url: string) => {
    reads.push(url);
    if (url === legoGeometryUrl("unit")) {
      return new Response(gzipSync(encodeRawGeometry(geometry("mod/m0"))));
    }
    return new Response(null, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRawGeometry", () => {
  it("reads nothing for a unit of parts", () => {
    const { result } = renderHook(() => useRawGeometry(parts));
    expect(result.current.raw).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(reads).not.toContain(legoGeometryUrl("unit"));
  });

  it("reads the unit's own file once it holds a lifted piece", async () => {
    const { result } = renderHook(() => useRawGeometry(mixed));
    await waitFor(() => expect(result.current.raw).not.toBeNull());
    expect([...(result.current.raw?.byId.keys() ?? [])]).toEqual(["mod/m0"]);
  });

  it("keeps geometry handed over for the first lifted piece, rather than reading it back", async () => {
    const { result, rerender } = renderHook(
      ({ project }) => useRawGeometry(project),
      { initialProps: { project: parts } },
    );
    const written = geometry("mod/m0");
    act(() => result.current.adopt(written));
    rerender({ project: mixed });

    expect(result.current.raw).toBe(written);
    expect(result.current.loading).toBe(false);
    expect(reads).not.toContain(legoGeometryUrl("unit"));
  });
});
