// @vitest-environment happy-dom

/**
 * A machine with no engine installed still reads a replay (issue #3403): the
 * detail page needs the replay's recorded engine version to offer that engine,
 * and used to wait for an installed engine before decoding anything.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoInfo } from "./bindings";
import { replayEngineDecision } from "./replayEngine";

const { contentDemoInfo, writeRootPath } = vi.hoisted(() => ({
  contentDemoInfo: vi.fn(),
  writeRootPath: vi.fn<() => string | undefined>(),
}));

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  contentDemoInfo,
}));
vi.mock("../downloads/config", () => ({
  useWriteRootPath: () => writeRootPath(),
}));

import { useDemoInfo } from "./config";
import { useReplaysRoot } from "./useReplaysRoot";

const info = {
  engineVersion: "105.1.1-2511-g1234567 BAR105",
  gameType: "Beyond All Reason test-30018",
  mapName: "Comet Catcher Remake 1.8",
} as DemoInfo;

beforeEach(() => {
  contentDemoInfo.mockReset();
  contentDemoInfo.mockResolvedValue({ info });
  writeRootPath.mockReset();
});

describe("useDemoInfo with no engine", () => {
  it("decodes the replay without an engine path", async () => {
    const { result } = renderHook(() =>
      useDemoInfo(undefined, "/content/demos/no-engine.sdfz"),
    );
    await waitFor(() => expect(result.current.info).toEqual(info));
    expect(contentDemoInfo).toHaveBeenCalledWith({
      enginePath: undefined,
      replayPath: "/content/demos/no-engine.sdfz",
    });
  });

  it("still reads nothing until a replay is chosen", () => {
    const { result } = renderHook(() => useDemoInfo(undefined, undefined));
    expect(result.current.info).toBeNull();
    expect(contentDemoInfo).not.toHaveBeenCalled();
  });

  it("gives the recorded engine to the #3370 offer", async () => {
    const { result } = renderHook(() =>
      useDemoInfo(undefined, "/content/demos/offer.sdfz"),
    );
    await waitFor(() => expect(result.current.info).not.toBeNull());
    const decision = replayEngineDecision({
      recorded: result.current.info?.engineVersion ?? "",
      engines: [],
      resolve: { loading: false, canDownload: true, noWriteRoot: false },
    });
    expect(decision.notice).toEqual({
      kind: "download",
      version: "105.1.1-2511-g1234567 BAR105",
    });
  });
});

describe("useReplaysRoot", () => {
  it("lists from the download folder when no engine gives a root", () => {
    writeRootPath.mockReturnValue("/content");
    const { result } = renderHook(() => useReplaysRoot(undefined));
    expect(result.current).toBe("/content");
  });

  it("keeps the selected engine's root when there is one", () => {
    writeRootPath.mockReturnValue("/content");
    const { result } = renderHook(() => useReplaysRoot("/engine-root"));
    expect(result.current).toBe("/engine-root");
  });
});
