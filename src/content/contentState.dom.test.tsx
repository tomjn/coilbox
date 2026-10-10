// @vitest-environment happy-dom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentState } from "./bindings";

const { contentStateLoad } = vi.hoisted(() => ({ contentStateLoad: vi.fn() }));
vi.mock("./bindings", () => ({ contentStateLoad }));

import {
  loadContentState,
  refreshContentState,
  resetContentState,
  setContentState,
  useContentState,
} from "./contentState";

const state = (...paths: string[]): ContentState =>
  ({
    schemaVersion: 1,
    roots: paths.map((path) => ({ path, engines: [] })),
  }) as unknown as ContentState;

beforeEach(() => {
  vi.clearAllMocks();
  resetContentState();
  contentStateLoad.mockResolvedValue({ state: state("/a") });
});

describe("content state store", () => {
  it("shares one request between readers that ask together", async () => {
    const [a, b] = await Promise.all([loadContentState(), loadContentState()]);
    expect(a).toBe(b);
    expect(contentStateLoad).toHaveBeenCalledTimes(1);
  });

  it("answers from the held value once the first read has finished", async () => {
    await loadContentState();
    await loadContentState();
    expect(contentStateLoad).toHaveBeenCalledTimes(1);
  });

  it("does not remember a rejection", async () => {
    contentStateLoad.mockRejectedValueOnce(new Error("boom"));
    await expect(loadContentState()).rejects.toThrow("boom");
    await expect(loadContentState()).resolves.toEqual(state("/a"));
    expect(contentStateLoad).toHaveBeenCalledTimes(2);
  });

  it("keeps a write that landed while a read was open", async () => {
    let finish: (v: { state: ContentState }) => void = () => {};
    contentStateLoad.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const read = refreshContentState();
    setContentState(state("/new"));
    finish({ state: state("/old") });
    await expect(read).resolves.toEqual(state("/new"));
  });
});

describe("useContentState", () => {
  it("gives a hook mounted after the first read the value on its first render", async () => {
    const first = renderHook(() => useContentState());
    await waitFor(() => expect(first.result.current.state).not.toBeNull());

    const seen: unknown[] = [];
    renderHook(() => {
      const r = useContentState();
      seen.push(r);
      return r;
    });
    expect(seen[0]).toMatchObject({ state: state("/a"), loading: false });
    expect(contentStateLoad).toHaveBeenCalledTimes(1);
  });

  it("starts as null and loading, then settles", async () => {
    const { result } = renderHook(() => useContentState());
    expect(result.current.state).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state).toEqual(state("/a"));
  });

  it("reports a failed first read, and the next mount retries", async () => {
    contentStateLoad.mockRejectedValueOnce(new Error("no disk"));
    const first = renderHook(() => useContentState());
    await waitFor(() => expect(first.result.current.error).toBe("no disk"));
    expect(first.result.current.loading).toBe(false);

    const second = renderHook(() => useContentState());
    await waitFor(() => expect(second.result.current.state).not.toBeNull());
    expect(contentStateLoad).toHaveBeenCalledTimes(2);
  });

  it("updates every mounted hook when a command writes the state", async () => {
    const one = renderHook(() => useContentState());
    const two = renderHook(() => useContentState());
    await waitFor(() => expect(one.result.current.state).not.toBeNull());

    act(() => one.result.current.setState(state("/a", "/b")));
    expect(two.result.current.state).toEqual(state("/a", "/b"));
  });

  it("checks the disk once on focus however many hooks are mounted", async () => {
    const one = renderHook(() => useContentState());
    renderHook(() => useContentState());
    renderHook(() => useContentState());
    await waitFor(() => expect(one.result.current.state).not.toBeNull());
    contentStateLoad.mockClear();
    contentStateLoad.mockResolvedValue({ state: state("/a", "/gone-check") });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(one.result.current.state).toEqual(state("/a", "/gone-check")),
    );
    expect(contentStateLoad).toHaveBeenCalledTimes(1);
  });

  it("keeps the same object when a focus check finds nothing new", async () => {
    const one = renderHook(() => useContentState());
    await waitFor(() => expect(one.result.current.state).not.toBeNull());
    const before = one.result.current.state;
    await act(async () => {
      await refreshContentState();
    });
    expect(one.result.current.state).toBe(before);
  });
});
