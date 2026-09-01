// @vitest-environment happy-dom
/**
 * What a scenario row does when it is clicked, and what it still offers when it
 * is not (issue #2182).
 *
 * The row became a link and the buttons became a menu, which is two ways to
 * lose an action: a menu a keyboard cannot open, and a read-only scenario that
 * is offered a Delete it must never have. Both are pinned here, against the
 * real menu rather than a stand-in for it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The drawer is the app shell's, so it is stubbed down to what opened in it.
// Share and the delete confirmation both land here.
const opened: { title: string; content: React.ReactNode }[] = [];
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({
    open: (o: { title: string; content: React.ReactNode }) => opened.push(o),
    close: () => {},
    isOpen: false,
  }),
}));

// Stored scenarios come off disk through the plugin. What is under test is the
// row built from them, not the read.
const { useScenarios, deleteScenario } = vi.hoisted(() => ({
  useScenarios: vi.fn(),
  deleteScenario: vi.fn(async () => {}),
}));
vi.mock("../scenarios", () => ({
  useScenarios,
  refreshScenarios: async () => {},
}));
vi.mock("../storage", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../storage")),
  deleteScenario,
}));
vi.mock("../../campaign/campaigns", () => ({
  useCampaigns: () => ({ campaigns: [] }),
}));
vi.mock("@/play/config", () => ({ usePreferredTarget: () => ({}) }));
// The map pictures and the list of maps this machine has both come off the
// scan target, so they are stood in for and set per test. `scanned` is the
// difference between a scan that found no maps and one that has not run.
const content = vi.hoisted(() => ({
  scanned: false,
  maps: [] as { name: string }[],
  thumbs: new Map<string, { url: string; width?: number; height?: number }>(),
  thumbsLoading: false,
}));
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({
    data: content.scanned ? { maps: content.maps, games: [] } : null,
  }),
  useUnitsyncThumbnails: () => ({
    thumbs: content.thumbs,
    loading: content.thumbsLoading,
  }),
}));
// Neither bears on the row, and both reach for a real Tauri context.
vi.mock("./components/ReclaimClipsButton", () => ({
  ReclaimClipsButton: () => null,
}));
vi.mock("./components/ScenarioImportButton", () => ({
  ScenarioImportButton: () => null,
}));

import { newScenario } from "../create";
import type { LoadedScenario } from "../storage";
import ScenarioBuilderPage from "./ScenarioBuilderPage";

const local: LoadedScenario = {
  scenario: { ...newScenario("Beachhead"), id: "beachhead" },
  source: "local",
};

const bundled: LoadedScenario = {
  scenario: { ...newScenario("Tutorial"), id: "tutorial" },
  source: "bundled",
};

/** The same local scenario, set on a map. */
function onMap(mapName: string): LoadedScenario {
  const scenario = local.scenario;
  return {
    scenario: { ...scenario, setup: { ...scenario.setup, mapName } },
    source: "local",
  };
}

function show(scenarios: LoadedScenario[]) {
  useScenarios.mockReturnValue({
    scenarios,
    loading: false,
    error: null,
    refresh: async () => {},
  });
  render(
    <MemoryRouter initialEntries={["/scenario-builder"]}>
      <Routes>
        <Route path="/scenario-builder" element={<ScenarioBuilderPage />} />
        <Route
          path="/scenario-builder/:id"
          element={<p>Editing this scenario</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open a row's menu the way a keyboard does, and hand back its items. */
function openMenuByKeyboard(name: string) {
  const trigger = screen.getByRole("button", { name: `Actions for ${name}` });
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
}

afterEach(() => {
  cleanup();
  opened.length = 0;
  content.scanned = false;
  content.maps = [];
  content.thumbs = new Map();
  content.thumbsLoading = false;
  vi.clearAllMocks();
});

describe("a scenario row", () => {
  it("opens the scenario when the row itself is clicked", () => {
    show([local]);

    fireEvent.click(screen.getByRole("link", { name: /Beachhead/ }));

    expect(screen.getByText("Editing this scenario")).toBeTruthy();
  });

  it("reaches Edit, Share and Delete from the keyboard alone", () => {
    show([local]);

    expect(openMenuByKeyboard("Beachhead")).toEqual([
      expect.stringContaining("Edit"),
      expect.stringContaining("Share"),
      expect.stringContaining("Delete"),
    ]);
  });

  it("shares from the menu without a mouse", async () => {
    show([local]);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Share/ }), {
      key: "Enter",
    });

    // Share loads its form on demand, so the drawer opens a tick later.
    await vi.waitFor(() =>
      expect(opened.map((o) => o.title)).toEqual(["Share Beachhead"]),
    );
  });

  it("asks before deleting, and deletes when the drawer says so", async () => {
    show([local]);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Delete/ }), {
      key: "Enter",
    });
    expect(opened.map((o) => o.title)).toEqual(["Delete Beachhead"]);

    // The drawer's content is the shell's to render, so it is rendered here.
    cleanup();
    render(opened[0].content);
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    await vi.waitFor(() =>
      expect(deleteScenario).toHaveBeenCalledWith("beachhead", {
        keepMedia: false,
      }),
    );
  });

  // Issue #2203: the trigger used to fade in from `opacity-0`, which leaves
  // nothing to notice at rest and nothing to aim at on a touch screen.
  // Emphasis may change on hover. Existence may not, so the class that took it
  // away is pinned out here rather than left to be tidied back in.
  it("shows its menu trigger before anything is hovered", () => {
    show([local]);

    const trigger = screen.getByRole("button", {
      name: "Actions for Beachhead",
    });

    expect(trigger.className).not.toMatch(/(^|\s|:)opacity-0(\s|$)/);
    expect(trigger.className).toMatch(/group-hover:opacity-100/);
  });
});

describe("the map at the start of a scenario row", () => {
  /** A target with Comet Catcher installed and its minimap already rendered. */
  function haveCometCatcher() {
    content.scanned = true;
    content.maps = [{ name: "Comet Catcher" }];
    content.thumbs = new Map([
      ["Comet Catcher", { url: "asset://comet.png", width: 512, height: 256 }],
    ]);
  }

  it("draws the minimap of an installed map", () => {
    haveCometCatcher();

    show([onMap("Comet Catcher")]);

    const img = screen.getByRole("img", { name: "Minimap of Comet Catcher" });
    expect(img.getAttribute("src")).toBe("asset://comet.png");
  });

  it("draws no picture for a draft that has not picked a map", () => {
    content.scanned = true;

    show([local]);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("No map yet")).toBeTruthy();
  });

  // A missing map is not the same fact as no map, and it is the one that will
  // stop the scenario playing, so the slot says which.
  it("says so when the map the scenario names is not installed", () => {
    haveCometCatcher();

    show([onMap("Red Comet")]);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Red Comet is not installed")).toBeTruthy();
  });

  it("keeps quiet about a missing map until the scan has said", () => {
    show([onMap("Red Comet")]);

    expect(screen.queryByText("Red Comet is not installed")).toBeNull();
  });

  it("adds no tab stop inside the row's link", () => {
    haveCometCatcher();

    show([onMap("Comet Catcher")]);

    const link = screen.getByRole("link", { name: /Beachhead/ });
    expect(
      link.querySelectorAll(
        "a, button, input, select, textarea, [tabindex], [contenteditable]",
      ),
    ).toHaveLength(0);
  });
});

describe("a read-only scenario's row", () => {
  it("offers neither Edit nor Delete, but still shares", () => {
    show([bundled]);

    expect(openMenuByKeyboard("Tutorial")).toEqual([
      expect.stringContaining("Share"),
    ]);
  });

  it("still opens on a row click, which explains itself", () => {
    show([bundled]);

    expect(
      screen.getByRole("link", { name: /Tutorial/ }).getAttribute("href"),
    ).toBe("/scenario-builder/tutorial");
  });
});
