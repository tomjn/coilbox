// @vitest-environment happy-dom

/**
 * `useFactionLogos` must not hand one game's emblems to another game (issue
 * #3774). The map lived in state that an effect replaced, so the render where
 * the game changed still returned the old game's map.
 */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({ unitsyncFactionLogos: vi.fn() }));

vi.mock("../content/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../content/bindings")>()),
  ...bindings,
}));

vi.mock("../content/branding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../content/branding")>()),
  useBrandingEntry: () => null,
}));

const { useFactionLogos } = await import("./logos");

afterEach(cleanup);

describe("useFactionLogos", () => {
  it("returns no logos on the first render for a new game", async () => {
    bindings.unitsyncFactionLogos.mockResolvedValueOnce({
      logos: [{ side: "Arm", dataUri: "data:arm", maxDim: 64 }],
      errors: [],
    });
    bindings.unitsyncFactionLogos.mockReturnValueOnce(
      new Promise<never>(() => {}),
    );
    const renders: Record<string, unknown>[] = [];
    const { result, rerender } = renderHook(
      ({ game }: { game: string }) => {
        const value = useFactionLogos({
          enginePath: "/engine",
          dataDir: "/data-logos",
          gameArchive: game,
          sideNames: ["Arm"],
        });
        renders.push(value);
        return value;
      },
      { initialProps: { game: "A.sdz" } },
    );
    await waitFor(() => expect(result.current.arm).toBeDefined());

    const before = renders.length;
    rerender({ game: "B.sdz" });
    expect(renders[before]).toEqual({});
    for (const render of renders.slice(before)) expect(render).toEqual({});
  });
});
