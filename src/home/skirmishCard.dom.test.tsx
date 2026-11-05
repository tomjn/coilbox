// @vitest-environment happy-dom

/**
 * The skirmish card's icon square (#5080), as the continue zone draws it.
 *
 * The card's title is a map's name, which says nothing about being a map, so
 * the square shows the map's minimap, or a map icon when there is none. The
 * minimap comes through the home card art's loader, so the loader's unitsync
 * calls are the stubs here and the hook between them runs for real.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MinimapResult } from "../content/bindings";
import type { ResumeCandidate } from "./continue";

// Same stubs `continueZone.test.ts` uses, for the same reasons.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
  buttonVariants: () => "button",
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("../multiplayer/ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("../multiplayer/ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("../multiplayer/chat/mentionCue", () => ({
  triggerMentionCue: () => {},
}));

const resume =
  vi.fn<() => { candidates: ResumeCandidate[]; loading: boolean }>();
vi.mock("./continue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./continue")>()),
  useResume: () => resume(),
}));

// The scan target and the minimap render, as unitsync would answer them.
const minimap =
  vi.fn<(engine: string, data: string, map: string) => MinimapResult>();
vi.mock("../content/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../content/config")>()),
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  currentScan: async () => undefined,
  loadUnitsyncMinimap: async (engine: string, data: string, map: string) =>
    minimap(engine, data, map),
}));
vi.mock("../content/scanHints", () => ({ mapInScan: () => true }));

import Continue from "./zones/Continue";

const SKIRMISH: ResumeCandidate = {
  id: "skirmish:draft",
  kind: "skirmish",
  title: "BarR 1.1",
  detail: "Beyond All Reason",
  to: "/play/skirmish",
  touchedAt: 0,
  mapName: "BarR 1.1",
};

function renderZone() {
  return render(
    <MemoryRouter>
      <Continue />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resume.mockReturnValue({ candidates: [SKIRMISH], loading: false });
  minimap.mockReset();
  minimap.mockReturnValue({
    dataUrl: "data:image/png;base64,AAAA",
    startPositions: [],
    errors: [],
  });
});
afterEach(cleanup);

describe("the skirmish card's icon square", () => {
  it("shows the map's minimap", async () => {
    const { container } = renderZone();
    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,AAAA",
      );
    });
    expect(minimap).toHaveBeenCalledWith("/engine", "/data", "BarR 1.1");
  });

  it("fades the minimap in over the map icon once it has decoded", async () => {
    // The icon holds the square until the picture is ready, so the square
    // never jumps from one to the other.
    const { container } = renderZone();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const img = container.querySelector("img") as HTMLImageElement;
    expect(screen.getByTestId("continue-map-icon")).toBeTruthy();
    fireEvent.load(img);
    expect(img.className).toContain("opacity-100");
    expect(img.parentElement?.className).toContain("border-border");
  });

  it("shows a map icon when the map has no minimap", async () => {
    minimap.mockReturnValue({ startPositions: [], errors: [] });
    const { container } = renderZone();
    await waitFor(() => expect(minimap).toHaveBeenCalled());
    expect(screen.getByTestId("continue-map-icon")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps the kind's icon for a skirmish with no map named", () => {
    resume.mockReturnValue({
      candidates: [{ ...SKIRMISH, mapName: undefined }],
      loading: false,
    });
    renderZone();
    expect(screen.queryByTestId("continue-map-icon")).toBeNull();
    expect(minimap).not.toHaveBeenCalled();
  });
});
