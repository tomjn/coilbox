// @vitest-environment happy-dom

/**
 * Choosing the game a new model is for (issue #4465). The choice lives in the
 * "New model" popover, as a labelled field, and not in the page header.
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

import { BODY_PLANS } from "../bodyPlans";
import ProjectsPage from "./ProjectsPage";

const saveProject = vi.fn();
const saveThumbnailPng = vi.fn();
const saved = vi.hoisted(() => ({ projects: [] as unknown[] }));
const navigate = vi.fn();

const GAME = {
  name: "Splinter Faction 0.1.89",
  primaryArchive: { name: "SplinterFaction_0.1.89.sdz" },
};

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));
vi.mock("../projects", () => ({
  useLegoProjects: () => ({
    projects: saved.projects,
    loading: false,
    error: null,
  }),
  saveProject: (project: unknown) => saveProject(project),
  saveThumbnailPng: (id: string, png: string) => saveThumbnailPng(id, png),
  deleteProject: vi.fn(),
}));
vi.mock("../pack", () => ({
  loadPack: () =>
    Promise.resolve({
      manifest: { id: "lego", version: "1" },
      library: { atlases: [] },
    }),
}));
vi.mock("./components/useTestGame", () => ({
  useTestGame: () => ({
    games: [GAME],
    scan: { data: { games: [GAME] } },
  }),
}));
vi.mock("./components/GameModelDrawer", () => ({
  GameModelDrawer: () => null,
}));
vi.mock("./components/ImportDrawer", () => ({ ImportDrawer: () => null }));
const GENERATED = {
  id: "generated-unit",
  name: "Assault Biped 7",
  generated: {
    seed: 7,
    plan: "biped",
    job: "assault",
    size: "medium",
    modules: [],
  },
};
vi.mock("./components/GenerateDrawer", () => ({
  GenerateDrawer: ({
    open,
    onOpened,
  }: {
    open: boolean;
    onOpened: (project: unknown) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onOpened(GENERATED)}>
        Seed 7
      </button>
    ) : null,
}));

vi.mock("./components/RosterDrawer", () => ({
  RosterDrawer: ({
    open,
    onSaved,
  }: {
    open: boolean;
    onSaved: (units: unknown[], pictures: string[]) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => onSaved(ROSTER, ["data:image/png;base64,AA==", ""])}
      >
        Save roster
      </button>
    ) : null,
}));

/** A roster's two units, saved newest first as the page lists them. */
const ROSTER = [2, 1].map((tier) => ({
  id: `roster-unit-${tier}`,
  name: `Raiders Scout ${tier}`,
  unitName: `raiders_scout_t${tier}`,
  pieces: [],
  roster: { id: "r1", name: "Raiders", job: "scout", tier, tiers: 2 },
}));

beforeEach(() => {
  saved.projects = [];
  navigate.mockReset();
  saveProject.mockReset();
  saveThumbnailPng.mockReset();
  saveThumbnailPng.mockResolvedValue(undefined);
  saveProject.mockImplementation((project) => Promise.resolve(project));
});
afterEach(cleanup);

function show() {
  render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  );
}

describe("ProjectsPage game choice", () => {
  it("has no game dropdown in the header", () => {
    show();

    expect(
      screen.queryByRole("combobox", { name: "Game for a new model" }),
    ).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("offers a labelled Game field in the New model popover", () => {
    show();
    fireEvent.click(screen.getAllByRole("button", { name: /New model/ })[0]);

    expect(screen.getByRole("combobox", { name: "Game" })).toBeTruthy();
    expect(screen.getByText("No game")).toBeTruthy();
  });

  it("makes a model for the chosen game", async () => {
    show();
    fireEvent.click(screen.getAllByRole("button", { name: /New model/ })[0]);
    fireEvent.click(screen.getByRole("combobox", { name: "Game" }));
    fireEvent.click(await screen.findByRole("option", { name: GAME.name }));
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(BODY_PLANS[0].label) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));
    expect(saveProject.mock.calls[0][0].game).toMatchObject({
      name: GAME.name,
      archive: GAME.primaryArchive.name,
    });
  });

  it("makes a model for no game by default", async () => {
    show();
    fireEvent.click(screen.getAllByRole("button", { name: /New model/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Blank/ }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));
    expect(saveProject.mock.calls[0][0].game).toBeNull();
  });

  it("saves and opens a generated candidate", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(screen.getByRole("button", { name: "Seed 7" }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));
    expect(saveProject.mock.calls[0][0]).toEqual(GENERATED);
    expect(navigate).toHaveBeenCalledWith("/lego/generated-unit");
  });
});

describe("ProjectsPage rosters (#3239)", () => {
  it("saves every unit of a roster and stays on the page", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    fireEvent.click(screen.getByRole("button", { name: "Save roster" }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(2));
    expect(saveProject.mock.calls.map((call) => call[0])).toEqual(ROSTER);
    // Only the unit with a picture gets one, and before its card can ask.
    expect(saveThumbnailPng.mock.calls).toEqual([
      ["roster-unit-2", "data:image/png;base64,AA=="],
    ]);
    expect(saveThumbnailPng.mock.invocationCallOrder[0]).toBeLessThan(
      saveProject.mock.invocationCallOrder[0],
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows a roster's units together under its name, by tier", () => {
    saved.projects = [
      ...ROSTER,
      { id: "loner", name: "Cakebot", unitName: "cake", pieces: [] },
    ];
    show();

    const heading = screen.getByRole("button", { name: /^Raiders \d/ });
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    const section = heading.closest("div") as HTMLElement;
    const names = [...section.querySelectorAll("li p:first-child")].map(
      (p) => p.textContent,
    );
    expect(names).toEqual(["Raiders Scout 1", "Raiders Scout 2"]);
    expect(screen.getByText("Rosters")).toBeTruthy();
    expect(screen.getByText("No game")).toBeTruthy();

    fireEvent.click(heading);
    expect(section.querySelectorAll("li")).toHaveLength(0);
  });
});
