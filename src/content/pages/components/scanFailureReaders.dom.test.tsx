// @vitest-environment happy-dom
/**
 * Issue #3423: a scan whose unitsync `Init` failed has no data and carries the
 * engine's reason in `error`. The build tree embed sat on a skeleton forever
 * and the remix panel said no games were installed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const REASON = "no space left on device";

vi.mock("../../config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/e", rootPath: "/d" },
  }),
  useUnitsyncScan: () => ({
    data: null,
    unvouched: null,
    loading: false,
    error: REASON,
    cancelled: false,
    run: async () => null,
    cancel: () => {},
  }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false }),
  useUnitsyncUnitBuildpics: () => new Map(),
  useUnitsyncUnitDataset: () => ({ dataset: null }),
}));
vi.mock("../../../play/config", () => ({
  useReplayTarget: () => ({ resolved: null }),
}));
vi.mock("../../bindings", () => ({ contentRewriteDemo: async () => ({}) }));
vi.mock("./BuildTreeDrawer", () => ({ BuildTreeDrawer: () => null }));
vi.mock("./FactionBuildList", () => ({ FactionBuildList: () => null }));

import { BuildTreeEmbed } from "./BuildTreeEmbed";
import { RemixPanel } from "./RemixPanel";

afterEach(cleanup);

describe("readers of a failed scan", () => {
  it("the build tree embed shows the failure, not a skeleton", () => {
    const { container } = render(
      <BuildTreeEmbed arg="Some Game" mode="graph" />,
    );
    expect(screen.getByText(/scan failed/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(REASON))).toBeTruthy();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it("the remix panel shows the failure, not 'No installed games found'", () => {
    render(
      <RemixPanel
        replayPath="/r.sdfz"
        recordedGameType="Some Game 1.0"
        recordedEngineVersion="105"
        enginePath="/e"
        dataDir="/d"
        onRemixed={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remix/i }));
    expect(screen.getByText(/scan failed/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(REASON))).toBeTruthy();
    expect(screen.queryByText(/No installed games found/)).toBeNull();
  });
});
