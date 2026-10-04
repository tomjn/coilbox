// @vitest-environment happy-dom
/**
 * Issue #3423: a failed unitsync scan has no data and carries the engine's
 * reason in `error`. The map picker this surface opens used to say "No maps
 * installed" for it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const REASON = "no space left on device";

vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({
    data: null,
    unvouched: null,
    loading: false,
    error: REASON,
    cancelled: false,
    run: async () => null,
    cancel: () => {},
  }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map(), loading: false }),
}));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/e", dataDir: "/d" },
    loading: false,
  }),
}));
vi.mock("@/content/useGameUnits", () => ({
  useGameUnits: () => ({ units: [] }),
}));
vi.mock("@/campaign/pages/components/useMissionMapAssets", () => ({
  useMissionMapAssets: () => ({}),
}));
vi.mock("./useScenarioUnits", () => ({
  useScenarioUnits: () => ({
    placements: [],
    ground: null,
    groundAt: () => 0,
    settled: false,
    heightsUnread: false,
  }),
}));
vi.mock("./useLayoutPreview", () => ({
  useLayoutPreview: () => ({ count: null, dragging: false }),
}));
vi.mock("./useScenarioFootprints", () => ({ useScenarioFootprints: () => {} }));
vi.mock("./useMapEditing", () => ({ useMapEditing: () => {} }));
vi.mock("./PlacementSurface", () => ({
  PlacementSurface: () => null,
  SurfaceMessage: () => null,
}));
vi.mock("./LayoutControls", () => ({
  LayoutNotes: () => null,
  UncheckedNote: () => null,
  WaterlessNote: () => null,
}));

import { BlueprintOnMap } from "./BlueprintOnMap";

afterEach(cleanup);

describe("the blueprint map surface on a failed scan", () => {
  it("shows the failure in the map picker, not 'No maps installed'", () => {
    render(
      <MemoryRouter>
        <BlueprintOnMap
          blueprint={{ buildings: [], designedFor: undefined } as never}
          gameName="Some Game"
          onClose={() => {}}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /choose a map/i }));
    expect(screen.queryByText(/No maps installed/)).toBeNull();
    expect(screen.getByText(new RegExp(REASON))).toBeTruthy();
  });
});
