// @vitest-environment happy-dom
/**
 * The galaxy setup panel's Regenerate button when the scan has no lists (issue
 * #3430). It is disabled then, and on a failed scan the panel has to say why
 * rather than leave a dead button.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GalaxyDoc } from "../model";

const REASON = "no space left on device";

const h = vi.hoisted(() => ({
  scan: {
    data: null as unknown,
    error: null as string | null,
    loading: false,
  },
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useHideSidebar: () => {},
}));
vi.mock("../../content/config", () => ({
  useUnitsyncScan: () => ({
    ...h.scan,
    cancelled: false,
    unvouched: null,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false }),
}));
vi.mock("../../content/branding", () => ({
  resolveBranding: () => null,
  useBrandingCatalog: () => [],
}));
vi.mock("../../content/mapEligibility", () => ({
  useMapEligibility: () => ({ eligible: (m: unknown[]) => m }),
}));
vi.mock("../../play/config", () => ({
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      executable: "/engine/spring",
      dataDir: "/data",
      engineVersion: "1",
    },
  }),
}));
vi.mock("../conquests", () => ({
  refreshGalaxies: vi.fn(),
  useConquestState: () => ({ file: { conquests: {} }, saveFor: vi.fn() }),
  useGalaxies: () => ({ galaxies: [], loading: false, error: null }),
}));
vi.mock("@/factions/logos", () => ({
  useFactionLogos: () => ({}),
  useFactionLogo: () => null,
}));
vi.mock("../galaxy3d/GalaxyView", () => ({
  GalaxyView: () => null,
  nodeBodyLabel: () => "",
}));
vi.mock("../useUnlocks", () => ({
  useConquestUnlocks: () => ({ unlocks: {}, award: vi.fn() }),
  useAwardFinishedConquest: () => {},
}));
vi.mock("./components/RunSetup", () => ({
  FactionDot: () => null,
  SidePicker: () => null,
}));

import { RunSetupPanel } from "./GalaxyPage";

const galaxy = {
  id: "g",
  description: "A galaxy",
  game: { shortname: "ba" },
  factions: [],
  playerFactionId: "f",
  generated: { nodeCount: 18, factionCount: 2 },
} as unknown as GalaxyDoc;

function renderPanel() {
  return render(
    <MemoryRouter>
      <RunSetupPanel
        galaxy={galaxy}
        faction="f"
        onFaction={vi.fn()}
        onStart={vi.fn()}
      />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("RunSetupPanel Regenerate button", () => {
  it("is disabled on a failed scan, and the panel gives the reason", () => {
    h.scan = { data: null, error: REASON, loading: false };
    renderPanel();
    const button = screen.getByRole("button", { name: /Regenerate map/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(new RegExp(REASON))).toBeTruthy();
  });

  it("shows no failure while the scan is still running", () => {
    h.scan = { data: null, error: null, loading: true };
    renderPanel();
    const button = screen.getByRole("button", { name: /Regenerate map/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/The scan failed/)).toBeNull();
  });

  it("is enabled once the scan has lists", () => {
    h.scan = {
      data: { maps: [], games: [], errors: [] },
      error: null,
      loading: false,
    };
    renderPanel();
    const button = screen.getByRole("button", { name: /Regenerate map/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/The scan failed/)).toBeNull();
  });
});
