// @vitest-environment happy-dom
/**
 * The projects list, driven under a real DOM (issue #2696).
 *
 * Two things here are worth a test rather than a read. Starting a project has
 * to open what it made, or the button does nothing anybody can see. And a link
 * built before this issue, `/workshop?game=&unit=`, has to land on the unit it
 * names rather than on this page: somebody who pressed "Edit in Unit tweaks"
 * chose a unit, not a project, and losing it is the one answer that would be
 * worse than what was there before.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};
const GAME = {
  name: "Test Game",
  primaryArchive: { name: "testgame.sdd", path: "/data/games/testgame.sdd" },
};
const GAME_2 = {
  name: "Test Game 2",
  primaryArchive: { name: "testgame2.sdd", path: "/data/games/testgame2.sdd" },
};

vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({ selected: SELECTED }),
  useUnitsyncScan: () => ({
    data: { games: [GAME, GAME_2], maps: [] },
    loading: false,
    error: null,
    run: () => {},
  }),
}));

// The two file dialogs. Nothing here drives them, but importing the page pulls
// the Tauri plugin in, which has no window to talk to under happy-dom.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async () => null,
  save: async () => null,
}));

// A plain <select>, the stand-in `UnitPage.dom.test.tsx` uses for the same
// reason: the real picker is a Radix popover happy-dom cannot drive.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="">Pick a game</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const { default: ProjectsPage } = await import("./ProjectsPage");
const { PersistentStoreProvider } = await import("@picoframe/frame");
const { installSettingsStorage, memorySettingsStorage, readStoredSetting } =
  await import("@/lib/storedSetting");
const { EMPTY_EDITS, PROJECTS_KEY } = await import("../project");
type ModProject = import("../project").ModProject;

let storage = memorySettingsStorage();

/** Where the editor would be, so a test can read what the page navigated to. */
function EditorProbe() {
  const { id } = useParams();
  const { search } = useLocation();
  return <p>{`editor ${id}${search}`}</p>;
}

function project(fields: {
  id: string;
  name: string;
  gameName: string;
}): ModProject {
  return {
    ...fields,
    edits: EMPTY_EDITS,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function show(saved: ModProject[] = [], entry = "/workshop") {
  storage.set(PROJECTS_KEY, JSON.stringify(saved));
  return render(
    <PersistentStoreProvider storage={storage}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/workshop" element={<ProjectsPage />} />
          <Route path="/workshop/:id" element={<EditorProbe />} />
        </Routes>
      </MemoryRouter>
    </PersistentStoreProvider>,
  );
}

/** What is stored now, which is what a create or a rename has to have written. */
const stored = () => readStoredSetting<ModProject[]>(PROJECTS_KEY, []);

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
});

afterEach(cleanup);

describe("ProjectsPage", () => {
  it("says there is nothing yet before anything is started", () => {
    show();
    expect(screen.getByText(/No tweak projects yet/)).toBeTruthy();
  });

  it("says which game each project changes and how much", () => {
    show([project({ id: "a", name: "Slower tanks", gameName: GAME.name })]);
    expect(screen.getByText("Slower tanks")).toBeTruthy();
    expect(screen.getByText(GAME.name)).toBeTruthy();
    expect(screen.getByText(/Nothing changed yet/)).toBeTruthy();
  });

  it("links each project to its own editor", () => {
    show([project({ id: "abc", name: "Slower tanks", gameName: GAME.name })]);
    fireEvent.click(screen.getByText("Slower tanks"));
    expect(screen.getByText("editor abc")).toBeTruthy();
  });

  it("starts a project against a game and opens it", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    fireEvent.change(screen.getByLabelText("Game for the new project"), {
      target: { value: GAME_2.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start editing" }));

    const [made] = stored();
    expect(made).toMatchObject({
      gameName: GAME_2.name,
      name: `${GAME_2.name} tweaks`,
    });
    expect(screen.getByText(`editor ${made.id}`)).toBeTruthy();
  });

  it("renames a project", () => {
    show([project({ id: "abc", name: "Slower tanks", gameName: GAME.name })]);
    fireEvent.click(screen.getByRole("button", { name: /Rename/ }));
    const box = screen.getByLabelText("Name of Slower tanks");
    fireEvent.change(box, { target: { value: "Faster tanks" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(stored()[0]).toHaveProperty("name", "Faster tanks");
  });

  it("deletes a project once, after asking", async () => {
    show([project({ id: "abc", name: "Slower tanks", gameName: GAME.name })]);
    fireEvent.click(
      screen.getByRole("button", { name: /Delete Slower tanks/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(stored()).toEqual([]);
    expect(screen.getByText(/No tweak projects yet/)).toBeTruthy();
  });

  /**
   * The link `GameUnitPage` built before #2696, and the shape of any bookmark
   * anybody kept. Both halves matter: the unit has to survive, and a game that
   * already has a project must not get a second one for looking at a unit.
   */
  describe("a link from before the list existed", () => {
    it("opens the game's own project on the unit it names", () => {
      show(
        [project({ id: "abc", name: "Slower tanks", gameName: GAME.name })],
        `/workshop?game=${encodeURIComponent(GAME.name)}&unit=armcom`,
      );
      expect(screen.getByText("editor abc?unit=armcom")).toBeTruthy();
      expect(stored()).toHaveLength(1);
    });

    it("opens the editor with no project when the game has none", () => {
      show([], `/workshop?game=${encodeURIComponent(GAME.name)}&unit=armcom`);
      expect(
        screen.getByText(`editor new?game=Test+Game&unit=armcom`),
      ).toBeTruthy();
      // Nothing started for a unit somebody has only looked at.
      expect(stored()).toEqual([]);
    });
  });
});
