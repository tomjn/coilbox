// @vitest-environment happy-dom
/**
 * Issue #3452: the remix panel offers to stamp an engine version on the copy. It
 * stamped the engine's folder name when the engine had not reported a version.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const target = vi.hoisted(() => ({
  current: null as { engineVersion: string; syncVersion?: string } | null,
}));

vi.mock("../../config", () => ({
  useUnitsyncScan: () => ({
    data: null,
    unvouched: null,
    loading: false,
    error: null,
    cancelled: false,
    run: async () => null,
    cancel: () => {},
  }),
}));
vi.mock("../../../play/config", () => ({
  useReplayTarget: () => ({
    resolved: target.current ? { target: target.current, matched: true } : null,
  }),
}));
vi.mock("../../bindings", () => ({ contentRewriteDemo: async () => ({}) }));

import { RemixPanel } from "./RemixPanel";

afterEach(cleanup);

function open() {
  render(
    <RemixPanel
      replayPath="/r.sdfz"
      recordedGameType="Some Game 1.0"
      recordedEngineVersion="105.1.1-2511-gabc1234"
      enginePath="/e"
      dataDir="/d"
      onRemixed={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /remix/i }));
}

describe("RemixPanel engine stamp", () => {
  it("offers the version an engine reported", () => {
    target.current = {
      engineVersion: "105.1.1-2511-gabc1234 BAR105",
      syncVersion: "105.1.1-2511-gabc1234 BAR105",
    };
    open();
    expect(screen.getByText("Also stamp the engine version")).toBeTruthy();
  });

  it("offers no stamp for an engine that has only a folder name", () => {
    target.current = { engineVersion: "105.1.1-2511-gabc1234" };
    open();
    expect(screen.queryByText("Also stamp the engine version")).toBeNull();
  });
});
