import { describe, expect, it } from "vitest";
import type { ContentState } from "./bindings";
import { deriveSetup } from "./setup";

const root = (engines: number) => ({
  id: "r1",
  path: "/p",
  source: "manual" as const,
  kind: "data" as const,
  origins: [],
  exists: true,
  valid: true,
  portable: false,
  counts: { games: 0, maps: 0, engines, packages: 0 },
  engines: Array.from({ length: engines }, (_, i) => ({
    id: `e${i}`,
    rootPath: "/p",
    path: "/p/engine/x",
    executable: "spring",
    version: "1",
  })),
});

describe("deriveSetup", () => {
  it("needsFolder when no roots", () => {
    const s = deriveSetup(
      { schemaVersion: 1, roots: [] } as ContentState,
      "/std",
    );
    expect(s).toMatchObject({
      needsFolder: true,
      needsEngine: false,
      complete: false,
      standardPath: "/std",
    });
  });

  it("needsEngine when roots but no engines", () => {
    const s = deriveSetup(
      { schemaVersion: 1, roots: [root(0)] } as unknown as ContentState,
      "/std",
    );
    expect(s).toMatchObject({
      needsFolder: false,
      needsEngine: true,
      complete: false,
    });
  });

  it("complete when a root has an engine", () => {
    const s = deriveSetup(
      { schemaVersion: 1, roots: [root(1)] } as unknown as ContentState,
      "/std",
    );
    expect(s).toMatchObject({
      needsFolder: false,
      needsEngine: false,
      complete: true,
    });
  });
});
