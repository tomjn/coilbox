// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  list: vi.fn(),
  stateLoad: vi.fn(),
  stateSave: vi.fn(),
}));

vi.mock("./bindings", () => ({
  conquestList: hoisted.list,
  conquestStateLoad: hoisted.stateLoad,
  conquestStateSave: hoisted.stateSave,
}));

afterEach(cleanup);

beforeEach(() => {
  hoisted.stateLoad.mockReset();
  hoisted.stateSave.mockReset().mockResolvedValue(undefined);
});

async function load() {
  vi.resetModules();
  const mod = await import("./conquests");
  let api: ReturnType<typeof mod.useConquestState>;
  function Probe() {
    api = mod.useConquestState();
    return null;
  }
  render(<Probe />);
  return () => api;
}

describe("conquest run state", () => {
  it("writes nothing after the state failed to load, and rejects", async () => {
    hoisted.stateLoad.mockRejectedValue(new Error("disk unreadable"));
    const get = await load();
    await waitFor(() => expect(get().error).not.toBeNull());
    await expect(get().saveFor("g1", undefined)).rejects.toThrow(
      /disk unreadable/,
    );
    expect(hoisted.stateSave).not.toHaveBeenCalled();
  });

  it("keeps saving on a good load", async () => {
    hoisted.stateLoad.mockResolvedValue({
      json: JSON.stringify({ schemaVersion: 1, conquests: {} }),
    });
    const get = await load();
    await waitFor(() => expect(get().loading).toBe(false));
    await act(async () => {
      await get().saveFor("g1", undefined);
    });
    expect(hoisted.stateSave).toHaveBeenCalledTimes(1);
  });
});

describe("a damaged run state file", () => {
  const damaged: [string, string, RegExp][] = [
    [
      "text that is not JSON",
      '{"schemaVersion":1,"conquests":{"a":',
      /not valid JSON/,
    ],
    ["JSON of the wrong shape", "[]", /not a JSON object/],
    ["no conquests object", '{"schemaVersion":1}', /no conquests object/],
    [
      "a file made by a newer coilbox",
      JSON.stringify({ schemaVersion: 2, conquests: { g1: { seed: 1 } } }),
      /newer version of coilbox/,
    ],
  ];

  for (const [name, json, reason] of damaged) {
    it(`reads ${name} as a failed load and a save writes nothing`, async () => {
      hoisted.stateLoad.mockResolvedValue({ json });
      const get = await load();
      await waitFor(() => expect(get().error).toMatch(reason));
      await expect(get().saveFor("g1", undefined)).rejects.toThrow(reason);
      expect(hoisted.stateSave).not.toHaveBeenCalled();
    });
  }

  for (const json of ["", '{"schemaVersion":1,"conquests":{}}']) {
    it(`reads ${JSON.stringify(json)} as no conquests and a save writes`, async () => {
      hoisted.stateLoad.mockResolvedValue({ json });
      const get = await load();
      await waitFor(() => expect(get().loading).toBe(false));
      expect(get().error).toBeNull();
      await act(async () => {
        await get().saveFor("g1", undefined);
      });
      expect(hoisted.stateSave).toHaveBeenCalledTimes(1);
    });
  }

  it("writes back every saved conquest it read, including an odd one", async () => {
    hoisted.stateLoad.mockResolvedValue({
      json: JSON.stringify({
        schemaVersion: 1,
        conquests: { odd: { seed: "not a number" }, g2: { seed: 2 } },
      }),
    });
    const get = await load();
    await waitFor(() => expect(get().loading).toBe(false));
    await act(async () => {
      await get().saveFor("g1", undefined);
    });
    const saved = JSON.parse(hoisted.stateSave.mock.calls[0][0].json);
    expect(saved.conquests).toEqual({
      odd: { seed: "not a number" },
      g2: { seed: 2 },
    });
  });
});
