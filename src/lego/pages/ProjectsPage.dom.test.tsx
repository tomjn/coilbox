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
  useLegoProjects: () => ({ projects: [], loading: false, error: null }),
  saveProject: (project: unknown) => saveProject(project),
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

beforeEach(() => {
  saveProject.mockReset();
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
});
