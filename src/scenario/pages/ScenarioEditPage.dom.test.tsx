// @vitest-environment happy-dom
/**
 * What the scenario editor's header offers for the scenario as a whole
 * (issue #2203).
 *
 * Before this, sharing or deleting a scenario meant going back to the list,
 * which is not where an author is when they decide to do either. The two that
 * belong to the document rather than to its contents are pinned here: that
 * they are reachable without a mouse, that a delete asks first and leaves the
 * editor afterwards, and that neither is offered where it cannot be performed.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
vi.mock("../saveIntoGame", () => ({
  saveEditedScenario: async (_loaded: unknown, document: unknown) => document,
}));
// What a copy does with the dialogue clips is pinned where it happens, in
// `components/duplicate.test.ts` and against the list page. Here it is stood in
// for, so what is under test is the header: which document it copies, and where
// the author lands afterwards.
const { duplicateScenario } = vi.hoisted(() => ({
  duplicateScenario: vi.fn(),
}));
vi.mock("./components/duplicate", () => ({ duplicateScenario }));

// Everything the editor reads off this machine's content. None of it bears on
// the header, and all of it reaches for a real Tauri context.
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({ data: { games: [], maps: [] } }),
}));
vi.mock("@/play/config", () => ({ usePreferredTarget: () => ({}) }));
const { useGameUnits } = vi.hoisted(() => ({
  useGameUnits: vi.fn(() => ({ units: [], loading: false })),
}));
vi.mock("@/content/useGameUnits", () => ({ useGameUnits }));
vi.mock("@/content/pages/components/UnitPicker", () => ({
  UnitGameProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../campaign/campaigns", () => ({
  useCampaigns: () => ({ campaigns: [] }),
}));
vi.mock("./components/useScenarioMapExtent", () => ({
  useScenarioMapExtent: () => undefined,
}));
const { useMissionProblems } = vi.hoisted(() => ({
  useMissionProblems: vi.fn(
    (): { blocking: unknown[]; warnings: unknown[] } => ({
      blocking: [],
      warnings: [],
    }),
  ),
}));
vi.mock("./components/useMissionProblems", () => ({ useMissionProblems }));
vi.mock("./components/useScenarioGate", () => ({
  useScenarioGate: () => ({ gate: undefined, extensions: undefined }),
}));

// The editing surface and the panels under it. The header is what is under
// test, and a WebGL scene is not something happy-dom draws.
vi.mock("./components/ScenarioMapScene", () => ({
  ScenarioMapScene: () => null,
}));
vi.mock("./components/ScenarioTestDrawer", () => ({
  ScenarioTestDrawer: () => null,
}));
vi.mock("./components/MissionLuaView", () => ({ MissionLuaView: () => null }));
vi.mock("./components/SetupPanel", () => ({ SetupPanel: () => null }));
vi.mock("./components/TriggerPanel", () => ({ TriggerPanel: () => null }));
vi.mock("./components/ObjectivePanel", () => ({ ObjectivePanel: () => null }));
vi.mock("./components/DialoguePanel", () => ({ DialoguePanel: () => null }));
vi.mock("./components/RestrictionPanel", () => ({
  RestrictionPanel: () => null,
}));
vi.mock("./components/BlueprintPanel", () => ({ BlueprintPanel: () => null }));
vi.mock("./components/VarPanel", () => ({ VarPanel: () => null }));

import { newScenario } from "../create";
import type { LoadedScenario } from "../storage";
import ScenarioEditPage from "./ScenarioEditPage";

const local: LoadedScenario = {
  scenario: { ...newScenario("Beachhead"), id: "beachhead" },
  source: "local",
};

/** A mission inside a loose `.sdd` game: editable here, never deleted here. */
const inGame: LoadedScenario = {
  scenario: { ...newScenario("Landing"), id: "landing" },
  source: "game",
  origin: {
    gameName: "Splinter Faction",
    archivePath: "/games/sf.sdd",
    folder: "missions/landing",
    loose: true,
  },
};

const bundled: LoadedScenario = {
  scenario: { ...newScenario("Tutorial"), id: "tutorial" },
  source: "bundled",
};

function edit(loaded: LoadedScenario, ...also: LoadedScenario[]) {
  useScenarios.mockReturnValue({
    scenarios: [loaded, ...also],
    loading: false,
    error: null,
    refresh: async () => {},
  });
  render(
    <MemoryRouter initialEntries={[`/scenario-builder/${loaded.scenario.id}`]}>
      <Routes>
        <Route path="/scenario-builder" element={<p>The scenario list</p>} />
        <Route path="/scenario-builder/:id" element={<ScenarioEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open the header's menu the way a keyboard does, and hand back its items. */
function openMenuByKeyboard(name: string) {
  const trigger = screen.getByRole("button", { name: `Actions for ${name}` });
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
}

// The same cost the scenario list's share test pays, for the same reason. The
// header's Share loads its form with a dynamic import, and in a test that is
// Vite transforming the form's whole module graph on demand rather than fetching
// a built chunk, inside the 1000ms `vi.waitFor` below.
//
// This one is a precaution rather than a repair. Only the list's share test was
// ever seen to fail (issue #2215), but this is the same wait around the same
// import of the same form, so it is one machine being slightly slower away from
// being the one that fails next.
beforeAll(async () => {
  await import("./components/ShareScenarioForm");
});

afterEach(() => {
  cleanup();
  opened.length = 0;
  vi.clearAllMocks();
  // clearAllMocks drops call history but not a return value set with
  // mockReturnValue, so the two tests below that override these would
  // otherwise leak their state into whichever test runs next.
  useGameUnits.mockReturnValue({ units: [], loading: false });
  useMissionProblems.mockReturnValue({ blocking: [], warnings: [] });
});

describe("the scenario editor's header", () => {
  it("reaches Duplicate, Share and Delete from the keyboard alone", () => {
    edit(local);

    expect(openMenuByKeyboard("Beachhead")).toEqual([
      expect.stringContaining("Duplicate"),
      expect.stringContaining("Share"),
      expect.stringContaining("Delete"),
    ]);
  });

  it("shares the scenario it has open", async () => {
    edit(local);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Share/ }), {
      key: "Enter",
    });

    // Share loads its form on demand, so the drawer opens a tick later.
    await vi.waitFor(() =>
      expect(opened.map((o) => o.title)).toEqual(["Share Beachhead"]),
    );
  });

  it("asks before deleting, and goes back to the list once it has", async () => {
    edit(local);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Delete/ }), {
      key: "Enter",
    });
    expect(opened.map((o) => o.title)).toEqual(["Delete Beachhead"]);

    // The drawer's content is the shell's to render, so it is rendered here,
    // beside the editor it was opened from rather than instead of it.
    render(opened[0].content);
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));

    await vi.waitFor(() =>
      expect(deleteScenario).toHaveBeenCalledWith("beachhead", {
        keepMedia: false,
      }),
    );
    await vi.waitFor(() =>
      expect(screen.getByText("The scenario list")).toBeTruthy(),
    );
  });

  it("leaves the author editing when the delete is not confirmed", () => {
    edit(local);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Delete/ }), {
      key: "Enter",
    });

    expect(deleteScenario).not.toHaveBeenCalled();
    expect(screen.queryByText("The scenario list")).toBeNull();
    expect(
      screen
        .getByRole("textbox", { name: "Scenario name" })
        .getAttribute("value"),
    ).toBe("Beachhead");
  });

  // Issue #2183. The moment an author wants a variant is usually with the
  // mission open, so the copy is made from the document on screen and the
  // editor moves onto it. There is no confirmation: the copy is one more
  // scenario, and being taken to it is what says it happened.
  it("duplicates the scenario it has open and edits the copy", async () => {
    const copy: LoadedScenario = {
      scenario: {
        ...local.scenario,
        id: "beachhead-copy",
        name: "Copy of Beachhead",
      },
      source: "local",
    };
    duplicateScenario.mockResolvedValue(copy.scenario);
    edit(local, copy);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Duplicate/ }), {
      key: "Enter",
    });

    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("textbox", { name: "Scenario name" })
          .getAttribute("value"),
      ).toBe("Copy of Beachhead"),
    );
    // The document on screen, and the names the copy has to avoid.
    expect(duplicateScenario).toHaveBeenCalledWith(
      expect.objectContaining({ id: "beachhead", name: "Beachhead" }),
      ["Beachhead", "Copy of Beachhead"],
    );
  });

  it("says so when the copy could not be written, and stays where it is", async () => {
    duplicateScenario.mockRejectedValue(new Error("disk full"));
    edit(local);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Duplicate/ }), {
      key: "Enter",
    });

    await vi.waitFor(() => expect(screen.getByText("disk full")).toBeTruthy());
    expect(
      screen
        .getByRole("textbox", { name: "Scenario name" })
        .getAttribute("value"),
    ).toBe("Beachhead");
  });

  // Editable and deletable are not the same question. A mission inside a loose
  // game folder is written back into that folder, and leaving the game is a
  // move rather than a delete (issue #2160). Its dialogue clips live in the
  // game archive rather than in the media store, so a copy has nothing to take
  // them from either.
  it("offers neither Duplicate nor Delete for a mission that lives inside a game", () => {
    edit(inGame);

    expect(openMenuByKeyboard("Landing")).toEqual([
      expect.stringContaining("Share"),
    ]);
  });
});

// Issue #2272. A clean mission and one nobody has checked yet used to render
// identically: nothing. The button is now present for all three states the
// validator can be in, so an author always has something to read.
describe("the problems button", () => {
  it("is disabled and says Checking while the game's units are still loading", () => {
    useGameUnits.mockReturnValue({ units: [], loading: true });
    edit(local);

    const button = screen.getByRole("button", { name: /Checking/ });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("says No problems, enabled, once the units have loaded and nothing is wrong", () => {
    useGameUnits.mockReturnValue({ units: [], loading: false });
    useMissionProblems.mockReturnValue({ blocking: [], warnings: [] });
    edit(local);

    const button = screen.getByRole("button", { name: /No problems/ });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("names the count once the validator has found something", () => {
    useGameUnits.mockReturnValue({ units: [], loading: false });
    useMissionProblems.mockReturnValue({
      blocking: [{ path: "triggers.0", message: "Missing zone" }],
      warnings: [],
    });
    edit(local);

    const button = screen.getByRole("button", { name: /1 problem/ });
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});

describe("a read-only scenario's editor route", () => {
  it("offers no actions at all, because there is no editor to act on", () => {
    edit(bundled);

    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
    expect(screen.getByText(/can't be edited/)).toBeTruthy();
  });
});
