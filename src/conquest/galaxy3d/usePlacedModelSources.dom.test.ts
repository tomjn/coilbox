// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacedModel } from "../placedModels";

const hoisted = vi.hoisted(() => ({ fileUrls: vi.fn() }));
vi.mock("../handmade/library", () => ({
  handmadeMapFileUrls: hoisted.fileUrls,
}));

const { usePlacedModelSources } = await import("./usePlacedModelSources");

const IMAGE = "coilbox://localhost/conquestmap/two-shores/picture.png";
const terrain = { image: IMAGE, width: 1600, height: 960 };
const cairn: PlacedModel = { model: { file: "cairn.gltf" }, pos: [1, 1] };
const tree: PlacedModel = { model: { game: "pinetree" }, pos: [2, 2] };
const GAME = { enginePath: "/engine", dataDir: "/data", gameArchive: "tg.sdz" };

beforeEach(() => {
  hoisted.fileUrls.mockReset();
});

describe("placed model sources", () => {
  it("asks for nothing when the map places no models", () => {
    const { result } = renderHook(() =>
      usePlacedModelSources({ terrain }, GAME),
    );
    expect(result.current).toBeUndefined();
    expect(hoisted.fileUrls).not.toHaveBeenCalled();
  });

  it("does not list a folder for a map with game models only", () => {
    const { result } = renderHook(() =>
      usePlacedModelSources({ terrain, models: [tree] }, GAME),
    );
    expect(result.current).toEqual({ game: GAME, fileUrl: undefined });
    expect(hoisted.fileUrls).not.toHaveBeenCalled();
  });

  it("waits for the folder, then resolves files, and stays the same object", async () => {
    const fileUrl = (name: string) => `${IMAGE}/../${name}`;
    hoisted.fileUrls.mockResolvedValue(fileUrl);
    const galaxy = { terrain, models: [cairn, tree] };
    const { result, rerender } = renderHook(() =>
      usePlacedModelSources(galaxy, { ...GAME }),
    );
    expect(result.current).toEqual({ pending: true });
    await waitFor(() => expect(result.current?.pending).toBeUndefined());
    expect(hoisted.fileUrls).toHaveBeenCalledWith(IMAGE);
    expect(result.current).toEqual({ game: GAME, fileUrl });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("waits while the installed games are scanned", () => {
    const { result } = renderHook(() =>
      usePlacedModelSources({ terrain, models: [tree] }, { pending: true }),
    );
    expect(result.current).toEqual({ pending: true });
  });

  it("stops waiting when the folder cannot be listed", async () => {
    hoisted.fileUrls.mockRejectedValue(new Error("no plugin"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const galaxy = { terrain, models: [cairn] };
    const { result } = renderHook(() => usePlacedModelSources(galaxy, {}));
    expect(result.current).toEqual({ pending: true });
    await waitFor(() => expect(result.current).toBeUndefined());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
