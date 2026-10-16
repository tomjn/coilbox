// @vitest-environment happy-dom
/**
 * The crash drawer needs the log's path and time and none of its lines, so
 * triage asks for none (issue #4167).
 */
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ playInfolog: vi.fn() }));

vi.mock("./bindings", () => ({ playInfolog: m.playInfolog }));

import { useCrashTriage } from "./useCrashTriage";

it("asks for no lines of the log", async () => {
  m.playInfolog.mockResolvedValue({
    log: {
      path: "/x/infolog.txt",
      modifiedMs: 2_000,
      totalLines: 10,
      lines: [],
      truncated: true,
    },
  });
  const { result } = renderHook(() => useCrashTriage());
  await act(async () => {
    await result.current.inspect({
      outcome: { exitCode: 1, signal: null },
      runKind: "skirmish",
      dataDir: "/root",
      startedAtMs: 1_000,
    });
  });
  expect(m.playInfolog).toHaveBeenCalledWith({ dataDir: "/root", maxLines: 0 });
  expect(result.current.triage?.log?.path).toBe("/x/infolog.txt");
});
