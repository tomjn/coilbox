// @vitest-environment happy-dom

/**
 * What the battle launch gate says when the content scan's unitsync `Init`
 * failed (issue #3398). The run has no missing game or map to name, because the
 * scan could not say, so the gate says the scan failed and offers no download.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BattleLaunchGate } from "./BattleOverlayParts";

// The missing-content gate reads the frame's settings store through these.
vi.mock("../../../play/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../play/config")>()),
  usePreferredTarget: () => ({ target: null, loading: false, error: null }),
}));
vi.mock("../../../play/useGameCatalog", () => ({
  useGameCatalog: () => ({
    entries: [],
    suggested: [],
    repos: [],
    newestArchive: () => undefined,
  }),
}));
vi.mock("../../../downloads/useQueuedDownload", () => ({
  useQueuedDownload: () => ({
    busy: false,
    status: "idle",
    error: null,
    start: async () => null,
  }),
}));

afterEach(cleanup);

const base = {
  noEngine: false,
  missing: null,
  canStart: false,
  running: false,
  scanLoading: false,
  aisAvailable: true,
  onStart: () => {},
  mapName: "Some Map",
  onRecheck: () => {},
};

describe("BattleLaunchGate when the scan failed", () => {
  it("says the scan failed, with the reason, instead of preparing forever", () => {
    render(
      <MemoryRouter>
        <BattleLaunchGate {...base} scanFailure="no space left" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no space left/)).toBeTruthy();
    expect(screen.queryByText("Preparing…")).toBeNull();
  });

  it("keeps the preparing button when the scan did not fail", () => {
    render(
      <MemoryRouter>
        <BattleLaunchGate {...base} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Preparing…")).toBeTruthy();
  });
});

describe("BattleLaunchGate when a game's dependency is not installed", () => {
  const missing = {
    kind: "dependency" as const,
    name: "zero-k v1.7.6.4",
    gameName: "Zero-K Benchmark v3",
  };

  it("names the archive and the game that needs it before the engine starts", () => {
    render(
      <MemoryRouter>
        <BattleLaunchGate {...base} missing={missing} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Archive not installed/)).toBeTruthy();
    expect(screen.getByText("zero-k v1.7.6.4")).toBeTruthy();
    expect(screen.getByText("Zero-K Benchmark v3")).toBeTruthy();
    expect(screen.queryByText("Launch battle")).toBeNull();
  });

  it("offers the downloads page, not a download of the game it belongs to", () => {
    render(
      <MemoryRouter>
        <BattleLaunchGate
          {...base}
          missing={missing}
          game={{ shortname: "ZK", pinnedName: "Zero-K Benchmark v3" }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Open game downloads/)).toBeTruthy();
  });
});
