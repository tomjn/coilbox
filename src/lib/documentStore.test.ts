// @vitest-environment happy-dom
/**
 * The one behaviour this exists to guarantee: a write from one mounted
 * consumer reaches every other one. `runlite/runs.ts` shipped without it
 * (issue #2440) and the hub's item page proved it reachable, mounting
 * `useRuns` twice at once through `useHubItemPresence` and `useHubRemoval`.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDocumentStore } from "./documentStore";

describe("createDocumentStore", () => {
  it("starts loading and serves the fetched value once it resolves", async () => {
    const fetch = vi.fn(async () => ["a"]);
    const store = createDocumentStore<string[]>(fetch, []);

    const { result } = renderHook(() => store.useStore());
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);

    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(["a"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("serves the warm cache on a second mount without fetching again", async () => {
    const fetch = vi.fn(async () => ["a"]);
    const store = createDocumentStore<string[]>(fetch, []);

    const first = renderHook(() => store.useStore());
    await act(async () => {});
    expect(first.result.current.data).toEqual(["a"]);

    const second = renderHook(() => store.useStore());
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.data).toEqual(["a"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("pushes a refresh to every mounted consumer, not just the one that called it", async () => {
    let version = 1;
    const fetch = vi.fn(async () => [`v${version}`]);
    const store = createDocumentStore<string[]>(fetch, []);

    const a = renderHook(() => store.useStore());
    const b = renderHook(() => store.useStore());
    await act(async () => {});
    expect(a.result.current.data).toEqual(["v1"]);
    expect(b.result.current.data).toEqual(["v1"]);

    version = 2;
    await act(async () => {
      await a.result.current.refresh();
    });

    expect(a.result.current.data).toEqual(["v2"]);
    expect(b.result.current.data).toEqual(["v2"]);
  });

  it("pushes a publish to every mounted consumer, for an optimistic write", async () => {
    const fetch = vi.fn(async () => ({ id: "x" }));
    const store = createDocumentStore<{ id: string }>(fetch, { id: "" });

    const a = renderHook(() => store.useStore());
    const b = renderHook(() => store.useStore());
    await act(async () => {});

    act(() => {
      store.publish({ id: "y" });
    });

    expect(a.result.current.data).toEqual({ id: "y" });
    expect(b.result.current.data).toEqual({ id: "y" });
    expect(store.getCached()).toEqual({ id: "y" });
  });

  it("reports a rejected fetch as an error rather than throwing", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("disk unreadable");
    });
    const store = createDocumentStore<string[]>(fetch, []);

    const { result } = renderHook(() => store.useStore());
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("disk unreadable");
    expect(result.current.data).toEqual([]);
  });

  it("getCached answers null before anything has loaded, then the last value", async () => {
    const fetch = vi.fn(async () => ["a"]);
    const store = createDocumentStore<string[]>(fetch, []);

    expect(store.getCached()).toBeNull();
    await act(async () => {
      await store.refresh();
    });
    expect(store.getCached()).toEqual(["a"]);
  });
});
