// @vitest-environment happy-dom

/**
 * A hook keyed by game or map must not hand one key's result to another key
 * (issue #3772). The result lived in state that an effect replaced, so the render
 * where the key changed still returned the old key's result. The game page took
 * the start units from it and asked the new game for the old game's units.
 *
 * Every test reads the very first render after the key changes.
 */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  unitsyncGameInfo: vi.fn(),
  unitsyncUnitDataset: vi.fn(),
  unitsyncMapInfo: vi.fn(),
  unitsyncUnitBuildpics: vi.fn(),
  unitsyncUnitModels: vi.fn(),
}));

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  ...bindings,
}));

vi.mock("./modelFile", () => ({
  readCachedModel: vi.fn(async (file: string) => ({ path: file })),
}));

const {
  useUnitsyncGameInfo,
  useUnitsyncMapInfo,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
  useUnitsyncUnitModel,
} = await import("./config");

let n = 0;
let dir = "";

beforeEach(() => {
  for (const fn of Object.values(bindings)) fn.mockReset();
  n += 1;
  dir = `/data-${n}`;
});

afterEach(cleanup);

/**
 * Render a hook and record every value it returns. `rerender` runs effects
 * before it returns, so `result.current` is the last render, not the first one
 * after the key changed. The first render after a key change is the one at the
 * index the list had just before it.
 */
function recorded<P, R>(hook: (props: P) => R, initialProps: P) {
  const renders: R[] = [];
  const view = renderHook(
    (props: P) => {
      const value = hook(props);
      renders.push(value);
      return value;
    },
    { initialProps },
  );
  return { ...view, renders };
}

/** A read that never lands, so the new key stays loading. */
const never = () => new Promise<never>(() => {});

const gameInfoA = {
  sides: [],
  unitCount: 1,
  units: [],
  options: [],
  checksum: "a",
  errors: [],
};

describe("useUnitsyncGameInfo", () => {
  it("returns no info and loading on the first render for a new game", async () => {
    bindings.unitsyncGameInfo.mockResolvedValueOnce(gameInfoA);
    bindings.unitsyncGameInfo.mockReturnValueOnce(never());
    const { result, rerender, renders } = recorded(
      ({ game }: { game?: string }) =>
        useUnitsyncGameInfo("/engine", dir, game),
      { game: "A.sdz" },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.info).toBe(gameInfoA);

    const before = renders.length;
    rerender({ game: "B.sdz" });
    const first = renders[before];
    expect(first.info).toBeNull();
    expect(first.status).toBe("loading");
    expect(first.loading).toBe(true);
    for (const render of renders.slice(before)) expect(render.info).toBeNull();
  });

  it("reports idle when the game goes away", async () => {
    bindings.unitsyncGameInfo.mockResolvedValue(gameInfoA);
    const { result, rerender, renders } = recorded(
      ({ game }: { game?: string }) =>
        useUnitsyncGameInfo("/engine", dir, game),
      { game: "A.sdz" } as { game?: string },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const before = renders.length;
    rerender({ game: undefined });
    expect(renders[before].info).toBeNull();
    expect(renders[before].status).toBe("idle");
  });
});

describe("useUnitsyncUnitDataset", () => {
  it("returns no dataset and loading on the first render for a new game", async () => {
    const datasetA = { units: [{ name: "a" }], checksum: "a", errors: [] };
    bindings.unitsyncUnitDataset.mockResolvedValueOnce(datasetA);
    bindings.unitsyncUnitDataset.mockReturnValueOnce(never());
    const { result, rerender, renders } = recorded(
      ({ game }: { game: string }) =>
        useUnitsyncUnitDataset("/engine", dir, game),
      { game: "A.sdz" },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.dataset).toBe(datasetA);
    const before = renders.length;
    rerender({ game: "B.sdz" });
    expect(renders[before].dataset).toBeNull();
    expect(renders[before].status).toBe("loading");
  });
});

describe("useUnitsyncMapInfo", () => {
  it("returns no info and loading on the first render for a new map", async () => {
    bindings.unitsyncMapInfo.mockResolvedValueOnce({
      options: [],
      checksum: "a",
    });
    bindings.unitsyncMapInfo.mockReturnValueOnce(never());
    const { result, rerender, renders } = recorded(
      ({ map }: { map: string }) => useUnitsyncMapInfo("/engine", dir, map),
      { map: "A" },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.loadedMap).toBe("A");
    const before = renders.length;
    rerender({ map: "B" });
    expect(renders[before].info).toBeNull();
    expect(renders[before].status).toBe("loading");
    expect(renders[before].loadedMap).toBeUndefined();
  });
});

describe("useUnitsyncUnitBuildpics", () => {
  it("returns no icons on the first render for a new game", async () => {
    const dataA = { units: { a: { name: "A" } }, errors: [] };
    bindings.unitsyncUnitBuildpics.mockResolvedValueOnce(dataA);
    bindings.unitsyncUnitBuildpics.mockReturnValueOnce(never());
    const { result, rerender, renders } = recorded(
      ({ game }: { game: string }) =>
        useUnitsyncUnitBuildpics("/engine", dir, game, ["a"]),
      { game: "A.sdz" },
    );
    await waitFor(() => expect(result.current).toBe(dataA));
    const before = renders.length;
    rerender({ game: "B.sdz" });
    expect(renders[before]).toBeNull();
  });
});

describe("useUnitsyncUnitModel", () => {
  it("returns no model and loading on the first render for a new unit", async () => {
    bindings.unitsyncUnitModels.mockResolvedValueOnce({
      models: { a: { file: "a.bin" } },
    });
    bindings.unitsyncUnitModels.mockReturnValueOnce(never());
    const { result, rerender, renders } = recorded(
      ({ object }: { object: string }) =>
        useUnitsyncUnitModel("/engine", dir, "A.sdz", object),
      { object: "a" },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());
    const before = renders.length;
    rerender({ object: "b" });
    expect(renders[before].model).toBeNull();
    expect(renders[before].loading).toBe(true);
    expect(renders[before].failed).toBe(false);
  });
});

describe("the game page's build picture request", () => {
  it("never pairs a new game with the old game's start units", async () => {
    const side = (startUnit: string) => ({ name: startUnit, startUnit });
    bindings.unitsyncGameInfo.mockResolvedValueOnce({
      ...gameInfoA,
      sides: [side("armcom")],
    });
    bindings.unitsyncGameInfo.mockResolvedValueOnce({
      ...gameInfoA,
      checksum: "b",
      sides: [side("corcom")],
    });
    bindings.unitsyncUnitBuildpics.mockResolvedValue({ units: {}, errors: [] });
    // Mirrors GameDetailPage: start units come from the game info.
    const page = ({ game }: { game: string }) => {
      const { info } = useUnitsyncGameInfo("/engine", dir, game);
      const startUnits = (info?.sides ?? []).map((s) => s.startUnit as string);
      return useUnitsyncUnitBuildpics("/engine", dir, game, startUnits);
    };
    const { rerender } = renderHook(page, { initialProps: { game: "A.sdz" } });
    await waitFor(() =>
      expect(bindings.unitsyncUnitBuildpics).toHaveBeenCalledTimes(1),
    );
    rerender({ game: "B.sdz" });
    await waitFor(() =>
      expect(bindings.unitsyncUnitBuildpics).toHaveBeenCalledTimes(2),
    );
    const asked = bindings.unitsyncUnitBuildpics.mock.calls.map(
      ([args]) => `${args.gameArchive}:${args.units.join(",")}`,
    );
    expect(asked).toEqual(["A.sdz:armcom", "B.sdz:corcom"]);
  });
});
