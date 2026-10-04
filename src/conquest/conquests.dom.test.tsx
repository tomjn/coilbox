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
