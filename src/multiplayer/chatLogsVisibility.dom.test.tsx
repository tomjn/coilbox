// @vitest-environment happy-dom

/**
 * `useMpChatLogsVisible`, the Chat logs nav item's `useVisible` (issue #4082).
 * It is true once the user has connected, or when a saved log exists, and the
 * disk is read once however often the sidebar renders.
 */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({
  revealed: false,
  accounts: [] as { account: string; threads: unknown[] }[],
  reads: 0,
}));

vi.mock("../profile/hidden", () => ({ isProfileHidden: () => false }));
vi.mock("./store", () => ({
  useMultiplayer: () => ({ revealed: wire.revealed }),
  useConnection: () => null,
  useProtocolServers: () => [],
}));
vi.mock("./bindings", () => ({
  mpChatLogs: async () => {
    wire.reads++;
    return { accounts: wire.accounts };
  },
}));

async function freshHook() {
  vi.resetModules();
  return (await import("./navPredicates")).useMpChatLogsVisible;
}

beforeEach(() => {
  wire.revealed = false;
  wire.accounts = [];
  wire.reads = 0;
});
afterEach(cleanup);

describe("useMpChatLogsVisible", () => {
  it("is hidden with no connection and no saved logs", async () => {
    const use = await freshHook();
    const { result } = renderHook(use);
    await waitFor(() => expect(wire.reads).toBe(1));
    expect(result.current).toBe(false);
  });

  it("is hidden when an account folder holds no conversations", async () => {
    wire.accounts = [{ account: "a_host_1", threads: [] }];
    const use = await freshHook();
    const { result } = renderHook(use);
    await waitFor(() => expect(wire.reads).toBe(1));
    expect(result.current).toBe(false);
  });

  it("shows when a saved log exists", async () => {
    wire.accounts = [{ account: "a_host_1", threads: [{}] }];
    const use = await freshHook();
    const { result } = renderHook(use);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("shows once the user has connected", async () => {
    wire.revealed = true;
    const use = await freshHook();
    const { result } = renderHook(use);
    expect(result.current).toBe(true);
  });

  it("reads the disk once across renders and mounts", async () => {
    const use = await freshHook();
    const a = renderHook(use);
    a.rerender();
    a.rerender();
    renderHook(use);
    await waitFor(() => expect(wire.reads).toBe(1));
    expect(wire.reads).toBe(1);
  });
});
