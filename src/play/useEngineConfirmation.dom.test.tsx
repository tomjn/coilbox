// @vitest-environment happy-dom
/**
 * Issue #1340: the launch check reads an engine's reported version as verified
 * only when it is a plausible version, the same rule the replay page applies.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const verify = vi.hoisted(() => vi.fn());
vi.mock("@/content/bindings", () => ({ contentVerifyEngine: verify }));
vi.mock("@/content/contentState", () => ({
  refreshContentState: async () => {},
}));

import type { ContentRequirement } from "@/content/resolveContent";
import { replayEngineRequirement } from "../content/replayEngine";
import type { PlayTarget } from "./config";
import { useEngineConfirmation } from "./useEngineConfirmation";

const RECORDED = "105.1.1-2511-gabc1234 BAR105";
const requirements: ContentRequirement[] = [replayEngineRequirement(RECORDED)];

const target = (syncVersion?: string): PlayTarget => ({
  enginePath: "/root/engine/folder",
  executable: "/root/engine/folder/spring",
  dataDir: "/root",
  engineVersion: "105.1.1-2511-gabc1234",
  syncVersion,
});

describe("useEngineConfirmation", () => {
  it("counts an engine that reported the recorded version as installed", () => {
    const targets = [target(RECORDED)];
    const { result } = renderHook(() =>
      useEngineConfirmation(requirements, targets, false),
    );
    expect(result.current.conclusion).toEqual({ kind: "installed" });
  });

  it.each([
    ["whitespace", "   "],
    ["a hidden folder", ".spring"],
  ])("asks an engine that reported a version that is %s", async (_name, bad) => {
    verify.mockResolvedValue({ engine: { syncVersion: RECORDED } });
    const targets = [target(bad)];
    const { result } = renderHook(() =>
      useEngineConfirmation(requirements, targets, false),
    );
    expect(result.current.conclusion).toEqual({
      kind: "verify",
      executable: "/root/engine/folder/spring",
    });
    await waitFor(() =>
      expect(result.current.conclusion).toEqual({ kind: "installed" }),
    );
    expect(result.current.targets[0].syncVersion).toBe(RECORDED);
  });

  it("does not take an implausible answer from the engine as its version", async () => {
    verify.mockResolvedValue({ engine: { syncVersion: ".spring" } });
    const targets = [target()];
    const { result } = renderHook(() =>
      useEngineConfirmation(requirements, targets, false),
    );
    await waitFor(() =>
      expect(result.current.conclusion?.kind).toBe("unconfirmed"),
    );
    expect(result.current.targets[0].syncVersion).toBeUndefined();
  });
});
