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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The drawer is the app shell's, so it is stubbed down to what opened in it.
// Share loads its form on demand and lands here, the same way
// `ScenarioBuilderPage.dom.test.tsx` stubs it for `ShareScenarioForm`.
const opened: { title: string; content: unknown }[] = [];
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({
    open: (o: { title: string; content: unknown }) => opened.push(o),
    close: () => {},
    isOpen: false,
  }),
}));

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};
const GAME = {
  name: "Test Game",
  primaryArchive: { name: "testgame.sdd", path: "/data/games/testgame.sdd" },
  dependencyArchives: [],
  info: {},
};
const GAME_2 = {
  name: "Test Game 2",
  primaryArchive: { name: "testgame2.sdd", path: "/data/games/testgame2.sdd" },
  dependencyArchives: [],
  info: {},
};

// Mutable so a test can stand in whichever games are "installed" for the
// heading lookup, without every other test having to know about it. Named
// with the `mock` prefix vitest requires for a variable a hoisted `vi.mock`
// factory is allowed to close over.
let mockScanGames: (typeof GAME)[] = [GAME, GAME_2];

vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({ selected: SELECTED }),
  useUnitsyncGameHeaders: () => ({ headers: new Map(), loading: false }),
  useUnitsyncScan: () => ({
    data: { games: mockScanGames, maps: [] },
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

// The hub import record is its own store behind its own hook, the same way
// `ScenariosPage` and `BlueprintsPage` keep it out of this page's own tests:
// what belongs here is only that a save that came from the hub calls it with
// the item id, the project it made, and where to find it (issue #2728).
const recordHubImport = vi.fn();
vi.mock("@/hub/imports", () => ({
  useRecordHubImport: () => recordHubImport,
}));

const { default: ProjectsPage } = await import("./ProjectsPage");
const { PersistentStoreProvider } = await import("@picoframe/frame");
const { installSettingsStorage, memorySettingsStorage, readStoredSetting } =
  await import("@/lib/storedSetting");
const { EMPTY_EDITS, PROJECTS_KEY, modProjectCode } = await import(
  "../project"
);
const { rememberShortnames, resetShortnames } = await import(
  "@/container/shortnames"
);
type ModProject = import("../project").ModProject;
type GameIdentity = import("@/container/gameIdentity").GameIdentity;

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
  description?: string;
  game?: GameIdentity;
  createdAt?: string;
  updatedAt?: string;
}): ModProject {
  const { createdAt, updatedAt, ...rest } = fields;
  return {
    ...rest,
    edits: EMPTY_EDITS,
    createdAt: createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: updatedAt ?? "2026-01-01T00:00:00.000Z",
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

/** Open a card's action menu the way a keyboard does. The menu is a Radix
 *  dropdown, which happy-dom cannot drive with a pointer but does open on
 *  Enter, the same route `ScenarioBuilderPage.dom.test.tsx` takes. */
function openCardMenu(name: string) {
  const trigger = screen.getByRole("button", { name: `Actions for ${name}` });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

// Share loads its form with a dynamic import. Paying the transform here,
// rather than inside the share test's own wait, is the fix issue #2215
// recorded for `ShareScenarioForm`'s equivalent flake under a parallel run.
beforeAll(async () => {
  await import("./components/ShareProjectForm");
});

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
  resetShortnames();
  mockScanGames = [GAME, GAME_2];
});

afterEach(() => {
  cleanup();
  opened.length = 0;
  recordHubImport.mockClear();
});

describe("ProjectsPage", () => {
  it("says there is nothing yet before anything is started", () => {
    show();
    expect(screen.getByText(/No tweak projects yet/)).toBeTruthy();
  });

  it("says which game each project changes and how much", () => {
    show([project({ id: "a", name: "Slower tanks", gameName: GAME.name })]);
    expect(screen.getByText("Slower tanks")).toBeTruthy();
    // Twice: once as the group heading, once on the card itself.
    expect(screen.getAllByText(GAME.name)).toHaveLength(2);
    expect(screen.getByText(/Nothing changed yet/)).toBeTruthy();
  });

  it("links each project to its own editor", () => {
    show([project({ id: "abc", name: "Slower tanks", gameName: GAME.name })]);
    fireEvent.click(screen.getByText("Slower tanks"));
    expect(screen.getByText("editor abc")).toBeTruthy();
  });

  it("shows the description a project was given", () => {
    show([
      project({
        id: "a",
        name: "Slower tanks",
        gameName: GAME.name,
        description: "Everything on tracks costs more.",
      }),
    ]);
    expect(screen.getByText("Everything on tracks costs more.")).toBeTruthy();
  });

  /**
   * The whole of #2707: the drawer asks for a name and a description at the
   * moment the project is started, rather than naming it after the game and
   * leaving a rename button on every card to undo that (issue #2706).
   */
  it("starts a project under the name and description it was given", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    fireEvent.click(screen.getByLabelText("Game for the new project"));
    fireEvent.click(screen.getByRole("button", { name: GAME_2.name }));
    fireEvent.change(screen.getByLabelText("Name for the new project"), {
      target: { value: "Slower tanks" },
    });
    fireEvent.change(screen.getByLabelText("What the project is for"), {
      target: { value: "Everything on tracks costs more." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start editing" }));

    const [made] = stored();
    expect(made).toMatchObject({
      gameName: GAME_2.name,
      name: "Slower tanks",
      description: "Everything on tracks costs more.",
    });
    expect(screen.getByText(`editor ${made.id}`)).toBeTruthy();
  });

  it("takes the game's name for a project nobody named", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    fireEvent.click(screen.getByLabelText("Game for the new project"));
    fireEvent.click(screen.getByRole("button", { name: GAME_2.name }));
    fireEvent.click(screen.getByRole("button", { name: "Start editing" }));

    const [made] = stored();
    expect(made).toMatchObject({
      gameName: GAME_2.name,
      name: `${GAME_2.name} tweaks`,
    });
    expect(made).not.toHaveProperty("description");
    expect(screen.getByText(`editor ${made.id}`)).toBeTruthy();
  });

  it("renames a project from the card's menu", async () => {
    show([project({ id: "abc", name: "Slower tanks", gameName: GAME.name })]);
    openCardMenu("Slower tanks");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));

    const box = await screen.findByLabelText("Project name");
    fireEvent.change(box, { target: { value: "Faster tanks" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(stored()[0]).toHaveProperty("name", "Faster tanks");
  });

  it("deletes a project once, after asking", async () => {
    show([project({ id: "abc", name: "Slower tanks", gameName: GAME.name })]);
    openCardMenu("Slower tanks");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }));
    expect(stored()).toEqual([]);
    expect(screen.getByText(/No tweak projects yet/)).toBeTruthy();
  });

  it("reaches every action on a card by its name", async () => {
    show([project({ id: "abc", name: "Slower tanks", gameName: GAME.name })]);
    openCardMenu("Slower tanks");
    expect(
      (await screen.findAllByRole("menuitem")).map((i) => i.textContent),
    ).toEqual([
      expect.stringContaining("Rename"),
      expect.stringContaining("Duplicate"),
      expect.stringContaining("Share"),
      expect.stringContaining("Delete"),
    ]);
  });

  /**
   * Share is a code, a link, a file and a publish to the Coilbox hub, all
   * behind `ShareProjectForm` (issue #2727). What belongs to this page is
   * only that the menu opens it with the right project and title. The form's
   * own routes are its own business.
   */
  it("shares a project from the card's menu", async () => {
    show([project({ id: "abc", name: "Slower tanks", gameName: GAME.name })]);
    openCardMenu("Slower tanks");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Share/ }));

    await vi.waitFor(() =>
      expect(opened.map((o) => o.title)).toEqual(["Share Slower tanks"]),
    );
  });

  /**
   * A `coilbox://import` link carrying a project's code lands here the same
   * way `ScenariosPage` and `BlueprintsPage` do, with `&hub=<id>` beside the
   * code when the hub browse screen started it (issue #2728). The record is
   * what lets the hub count the import and later tell someone where a project
   * came from, so it has to name the project this save actually made, not the
   * shared code's own id.
   */
  describe("importing a project from a shared link", () => {
    it("records the hub item behind a shared project once it is saved", () => {
      const code = modProjectCode(
        project({ id: "shared", name: "Borrowed tanks", gameName: GAME.name }),
      );
      if (!code.ok) throw new Error("test project code did not fit");
      show(
        [],
        `/workshop?import=${encodeURIComponent(code.code)}&hub=hub-item-1`,
      );

      const [made] = stored();
      expect(made).toMatchObject({
        name: "Borrowed tanks",
        gameName: GAME.name,
      });
      expect(screen.getByText(`editor ${made.id}`)).toBeTruthy();
      expect(recordHubImport).toHaveBeenCalledWith(
        "hub-item-1",
        [made.id],
        `/workshop/${made.id}`,
      );
    });

    it("saves nothing and records nothing for a link that is not a project", () => {
      show([], "/workshop?import=not-a-real-code&hub=hub-item-1");

      expect(
        screen.getByText(/That link is not a coilbox tweak project\./),
      ).toBeTruthy();
      expect(stored()).toEqual([]);
      expect(recordHubImport).not.toHaveBeenCalled();
    });
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

  /**
   * Issue #3071: projects group under a heading per game rather than sitting
   * in one flat list, so a game's several versions collapse into one group a
   * person actually recognises.
   */
  describe("grouping by game", () => {
    it("groups two versions of the same game under one heading", () => {
      show([
        project({
          id: "old",
          name: "Old build",
          gameName: "Balanced Annihilation V15.9.7",
          game: { name: "Balanced Annihilation V15.9.7", shortname: "BA" },
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        project({
          id: "new",
          name: "New build",
          gameName: "Balanced Annihilation V15.9.8",
          game: { name: "Balanced Annihilation V15.9.8", shortname: "BA" },
          updatedAt: "2026-02-01T00:00:00.000Z",
        }),
      ]);

      // One heading, not two. Neither build is installed here, so the
      // heading falls back to the newest project's exact gameName.
      expect(
        screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["Balanced Annihilation V15.9.8"]);
      expect(screen.getByText("Old build")).toBeTruthy();
      expect(screen.getByText("New build")).toBeTruthy();
    });

    it("heads the group with the installed game's modinfo name, not a build", () => {
      // An installed game whose shortname matches the group answers the
      // heading with its versionless modinfo name, rather than the exact
      // build either project happens to pin (issue #3071 review: a heading
      // reading "V15.9.8" over a group holding V15.9.7 too looks like the
      // group were that one build).
      mockScanGames = [
        {
          name: "Balanced Annihilation V15.9.8",
          primaryArchive: { name: "ba.sdz", path: "/data/games/ba.sdz" },
          dependencyArchives: [],
          info: { name: "Balanced Annihilation", shortname: "BA" },
        },
      ];
      show([
        project({
          id: "old",
          name: "Old build",
          gameName: "Balanced Annihilation V15.9.7",
          game: { name: "Balanced Annihilation V15.9.7", shortname: "BA" },
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        project({
          id: "new",
          name: "New build",
          gameName: "Balanced Annihilation V15.9.8",
          game: { name: "Balanced Annihilation V15.9.8", shortname: "BA" },
          updatedAt: "2026-02-01T00:00:00.000Z",
        }),
      ]);

      expect(
        screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["Balanced Annihilation"]);
    });

    it("falls back to a remembered shortname when a project carries none", () => {
      rememberShortnames([{ name: "Zero-K v1.12", info: { shortname: "ZK" } }]);
      show([
        project({
          id: "remembered",
          name: "No shortname on the project itself",
          gameName: "Zero-K v1.12",
        }),
        project({
          id: "current",
          name: "Shortname on the project",
          gameName: "Zero-K v1.13",
          game: { name: "Zero-K v1.13", shortname: "ZK" },
        }),
      ]);

      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    });

    it("groups a project with no recoverable shortname under its own game name", () => {
      show([
        project({
          id: "a",
          name: "Unknown game project",
          gameName: "Some Unread Game 1.0",
        }),
        project({ id: "b", name: "Slower tanks", gameName: GAME.name }),
      ]);

      expect(
        screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["Some Unread Game 1.0", GAME.name]);
    });
  });

  /**
   * Issue #3071: a search box narrows the list to projects whose name,
   * description or game name matches, hiding a group with no match at all.
   */
  describe("searching", () => {
    it("matches on name, description and game name, ignoring case", () => {
      show([
        project({ id: "a", name: "Slower tanks", gameName: GAME.name }),
        project({
          id: "b",
          name: "Faster bots",
          gameName: GAME_2.name,
          description: "Rebalances air units.",
        }),
      ]);

      fireEvent.change(screen.getByLabelText("Search projects"), {
        target: { value: "AIR" },
      });
      expect(screen.getByText("Faster bots")).toBeTruthy();
      expect(screen.queryByText("Slower tanks")).toBeNull();
    });

    it("says nothing matches rather than showing an empty list", () => {
      show([project({ id: "a", name: "Slower tanks", gameName: GAME.name })]);
      fireEvent.change(screen.getByLabelText("Search projects"), {
        target: { value: "nothing matches this" },
      });
      expect(screen.getByText(/No projects match/)).toBeTruthy();
    });
  });

  /**
   * Issue #3071: the sort dropdown orders projects within each group, and the
   * choice is remembered through the settings store so it survives a restart.
   */
  describe("sorting", () => {
    it("orders by last changed, newest first, by default", () => {
      show([
        project({
          id: "a",
          name: "Older",
          gameName: GAME.name,
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        project({
          id: "b",
          name: "Newer",
          gameName: GAME.name,
          updatedAt: "2026-02-01T00:00:00.000Z",
        }),
      ]);
      const names = screen.getAllByRole("link").map((l) => l.textContent);
      expect(names.findIndex((t) => t?.startsWith("Newer"))).toBeLessThan(
        names.findIndex((t) => t?.startsWith("Older")),
      );
    });

    it("sorts by name A-Z when chosen, and remembers the choice", async () => {
      show([
        project({ id: "a", name: "Zebra project", gameName: GAME.name }),
        project({ id: "b", name: "Alpha project", gameName: GAME.name }),
      ]);

      fireEvent.click(screen.getByRole("combobox", { name: "Sort projects" }));
      fireEvent.click(await screen.findByText("Name A–Z"));

      const names = screen.getAllByRole("link").map((l) => l.textContent);
      expect(
        names.findIndex((t) => t?.startsWith("Alpha project")),
      ).toBeLessThan(names.findIndex((t) => t?.startsWith("Zebra project")));
      expect(readStoredSetting("workshop.projectsSort", "updated-desc")).toBe(
        "name-asc",
      );

      // A fresh mount reads the remembered choice back rather than resetting
      // to "last changed".
      cleanup();
      show([
        project({ id: "a", name: "Zebra project", gameName: GAME.name }),
        project({ id: "b", name: "Alpha project", gameName: GAME.name }),
      ]);
      const namesAfterRemount = screen
        .getAllByRole("link")
        .map((l) => l.textContent);
      expect(
        namesAfterRemount.findIndex((t) => t?.startsWith("Alpha project")),
      ).toBeLessThan(
        namesAfterRemount.findIndex((t) => t?.startsWith("Zebra project")),
      );
    });
  });
});
