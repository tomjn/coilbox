// @vitest-environment happy-dom
/**
 * Triage reads everything a crash report needs at the moment of the crash,
 * because the next launch overwrites both log files. A log goes in whole, so
 * triage asks for every line of it (issues #4064 and #4167).
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  playInfolog: vi.fn(),
  playEngineOutput: vi.fn(),
  playSystemInfo: vi.fn(),
  getVersion: vi.fn(),
  loadContentState: vi.fn(),
}));

vi.mock("./bindings", () => ({
  playInfolog: m.playInfolog,
  playEngineOutput: m.playEngineOutput,
  playSystemInfo: m.playSystemInfo,
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: m.getVersion }));
vi.mock("@/content/contentState", () => ({
  loadContentState: m.loadContentState,
}));

import { useCrashTriage } from "./useCrashTriage";

const file = (path: string, modifiedMs: number) => ({
  path,
  modifiedMs,
  totalLines: 2,
  lines: ["first", "last"],
  truncated: false,
});

beforeEach(() => {
  m.playInfolog.mockResolvedValue({ log: file("/x/infolog.txt", 2_000) });
  m.playEngineOutput.mockResolvedValue({
    log: file("/cache/engine-output.log", 2_000),
  });
  m.playSystemInfo.mockResolvedValue({
    os: "windows",
    osVersion: "10.0.19045",
    arch: "x86_64",
  });
  m.getVersion.mockResolvedValue("1.42.0");
  m.loadContentState.mockResolvedValue({
    roots: [
      {
        path: "/root",
        engines: [
          { executable: "/e/other/spring", version: "other" },
          {
            executable: "/e/2025.06.19/spring",
            version: "2025.06.19",
            syncVersion: "2025.06.19-abc",
          },
        ],
      },
    ],
  });
});

async function inspect(startedAtMs = 1_000) {
  const { result } = renderHook(() => useCrashTriage());
  await act(async () => {
    await result.current.inspect({
      outcome: { exitCode: 1, signal: null },
      runKind: "skirmish",
      engine: "/e/2025.06.19/spring",
      dataDir: "/root",
      startedAtMs,
    });
  });
  return result.current.triage;
}

it("reads the whole log", async () => {
  const triage = await inspect();
  expect(m.playInfolog).toHaveBeenCalledWith({ dataDir: "/root" });
  expect(triage?.log?.lines).toEqual(["first", "last"]);
});

it("gathers the versions and system a helper asks for", async () => {
  const triage = await inspect();
  expect(triage?.appVersion).toBe("1.42.0");
  expect(triage?.system?.os).toBe("windows");
  expect(triage?.engineVersion).toBe("2025.06.19-abc");
  expect(triage?.output?.path).toBe("/cache/engine-output.log");
});

it("drops logs written before this run started", async () => {
  const triage = await inspect(5_000);
  expect(triage?.log).toBeNull();
  expect(triage?.stale).toBe(true);
  expect(triage?.output).toBeNull();
});

it("still opens when every extra read fails", async () => {
  m.playInfolog.mockRejectedValue(new Error("no engine log was found"));
  m.playEngineOutput.mockRejectedValue(new Error("nope"));
  m.playSystemInfo.mockRejectedValue(new Error("nope"));
  m.getVersion.mockRejectedValue(new Error("nope"));
  m.loadContentState.mockRejectedValue(new Error("nope"));
  const triage = await inspect();
  expect(triage).toMatchObject({
    log: null,
    output: null,
    system: null,
    appVersion: null,
    engineVersion: null,
  });
});
