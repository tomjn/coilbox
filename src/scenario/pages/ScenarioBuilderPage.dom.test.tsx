// @vitest-environment happy-dom
/**
 * What a scenario row does when it is clicked, and what it still offers when it
 * is not (issue #2182).
 *
 * The row became a link and the buttons became a menu, which is two ways to
 * lose an action: a menu a keyboard cannot open, and a read-only scenario that
 * is offered a Delete it must never have. Both are pinned here, against the
 * real menu rather than a stand-in for it.
 *
 * What the row says about the scenario is at the foot of the file (issue #2179).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Campaign } from "../../campaign/model";

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
// Duplicating runs the real storage module, because copying the dialogue clips
// is the whole of what it does (issue #2183) and a stand-in for it would prove
// nothing. Only the plugin underneath is stubbed, so what the copy asks the
// disk for is what these tests read.
const plugin = vi.hoisted(() => ({
  save: vi.fn(async (_a: { id: string; json: string }) => ({})),
  mediaRead: vi.fn(async (_a: { scenarioId: string; file: string }) => ({
    dataUrl: "data:image/png;base64,AA==",
  })),
  mediaWrite: vi.fn(
    async (_a: { scenarioId: string; file: string; dataUri: string }) => ({}),
  ),
}));
vi.mock("../bindings", () => ({
  scenarioList: vi.fn(async () => ({ items: [] })),
  scenarioSave: plugin.save,
  scenarioDelete: vi.fn(async () => ({})),
  scenarioMediaImport: vi.fn(async () => ({ file: "" })),
  scenarioMediaDelete: vi.fn(async () => ({})),
  scenarioMediaRead: plugin.mediaRead,
  scenarioMediaSweep: vi.fn(async () => ({ summary: {} })),
  scenarioMediaWrite: plugin.mediaWrite,
}));
// Duplicate reports a failure through a toast, which has no shell here, and a
// rescan says it ran through the same channel (issue #2184).
const toasted = vi.hoisted(() => ({
  errors: [] as string[],
  successes: [] as string[],
}));
vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => toasted.errors.push(message),
    success: (message: string) => toasted.successes.push(message),
  },
}));
// Which campaigns exist decides which rows are attached to one, so the list is
// set per test.
const stored = vi.hoisted(() => ({
  campaigns: [] as { campaign: Campaign; source: "local" }[],
}));
vi.mock("../../campaign/campaigns", () => ({
  useCampaigns: () => ({ campaigns: stored.campaigns }),
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
// The reclaim preview reads the campaigns and sweeps real files, so what it
// finds is not this file's business. That the menu opens it is, and the drawer
// stub above records that without rendering the form.
vi.mock("./components/ReclaimClipsForm", () => ({
  ReclaimClipsForm: () => null,
}));

import { newScenario } from "../create";
import type { Scenario } from "../model";
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

/** The same local scenario, finished: it names a game and a map. */
function setUp(): LoadedScenario {
  const scenario = local.scenario;
  return {
    scenario: {
      ...scenario,
      setup: {
        ...scenario.setup,
        gameName: "Balanced Annihilation",
        mapName: "Comet Catcher",
      },
    },
    source: "local",
  };
}

/** A campaign whose only mission carries a copy of the scenario named. */
function campaignUsing(title: string, scenarioId: string) {
  const campaign = {
    schemaVersion: 1,
    id: `campaign-${title}`,
    type: "ta",
    title,
    description: "",
    missions: [
      {
        id: `mission-${title}`,
        title: "One",
        briefing: "",
        objectives: [],
        snapshot: local.scenario.setup,
        scenario: { ...local.scenario, id: scenarioId },
        disabledUnits: [],
        skippable: false,
      },
    ],
    createdAt: "",
    updatedAt: "",
  } as Campaign;
  return { campaign, source: "local" as const };
}

/** The editor's route, saying which scenario it was opened on. */
function Editing() {
  const { id } = useParams();
  return (
    <>
      <p>Editing this scenario</p>
      <p data-testid="editing">{id}</p>
    </>
  );
}

/** Which scenario the editor route is showing, or null when it is not. */
const editingId = () => screen.queryByTestId("editing")?.textContent ?? null;

function show(scenarios: LoadedScenario[], refresh = async () => {}) {
  useScenarios.mockReturnValue({
    scenarios,
    loading: false,
    error: null,
    refresh,
  });
  render(
    <MemoryRouter initialEntries={["/scenario-builder"]}>
      <Routes>
        <Route path="/scenario-builder" element={<ScenarioBuilderPage />} />
        <Route path="/scenario-builder/:id" element={<Editing />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The names of the rows on screen, in the order they are drawn. */
const rowNames = () =>
  screen
    .getAllByRole("link")
    .map((link) => link.querySelector("span.font-medium")?.textContent);

/** The group headings on screen, in the order they are drawn. */
const headings = () =>
  screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

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
  toasted.errors.length = 0;
  toasted.successes.length = 0;
  stored.campaigns = [];
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

  it("reaches Edit, Duplicate, Share and Delete from the keyboard alone", () => {
    show([local]);

    expect(openMenuByKeyboard("Beachhead")).toEqual([
      expect.stringContaining("Edit"),
      expect.stringContaining("Duplicate"),
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

// Issue #2178: a scenario missing a game or a map cannot be launched, and used
// to look exactly like one that can.
describe("the Draft badge", () => {
  it("marks a scenario that names neither a game nor a map", () => {
    show([local]);

    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("stays off a scenario that names both", () => {
    show([setUp()]);

    expect(screen.queryByText("Draft")).toBeNull();
  });

  // The thumbnail can only speak about the map. A scenario set on a map it has
  // and no game draws a perfectly good minimap and still cannot be launched,
  // which is the row the badge exists for.
  it("marks a scenario that has a map but no game", () => {
    content.scanned = true;
    content.maps = [{ name: "Comet Catcher" }];
    content.thumbs = new Map([["Comet Catcher", { url: "asset://comet.png" }]]);

    show([onMap("Comet Catcher")]);

    expect(
      screen.getByRole("img", { name: "Minimap of Comet Catcher" }),
    ).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
  });
});

describe("the In campaign badge", () => {
  it("stays off a scenario no campaign has attached", () => {
    show([setUp()]);

    expect(screen.queryByText(/In campaign|In \d+ campaigns/)).toBeNull();
  });

  it("marks a scenario a campaign mission carries, and names it on hover", () => {
    stored.campaigns = [campaignUsing("Core Contingency", "beachhead")];

    show([setUp()]);

    expect(screen.getByText("In campaign").getAttribute("title")).toBe(
      "Used by Core Contingency",
    );
  });

  // Nothing stops two missions attaching the same scenario, so the badge counts
  // rather than claiming there is one campaign to go to.
  it("counts the campaigns when more than one carries it", () => {
    stored.campaigns = [
      campaignUsing("Core Contingency", "beachhead"),
      campaignUsing("Battle Tactics", "beachhead"),
    ];

    show([setUp()]);

    expect(screen.getByText("In 2 campaigns").getAttribute("title")).toBe(
      "Used by Core Contingency, Battle Tactics",
    );
  });

  // The row is itself a link into the editor. Linking the badge to the campaign
  // would nest one anchor in another, so it is text, and the row keeps its one
  // tab stop.
  it("is not a link, and adds no tab stop inside the row's link", () => {
    stored.campaigns = [campaignUsing("Core Contingency", "beachhead")];

    show([setUp()]);

    const badge = screen.getByText("In campaign");
    expect(badge.tagName).toBe("SPAN");
    // The only link around it is the row's own, into the editor.
    expect(badge.closest("a")?.getAttribute("href")).toBe(
      "/scenario-builder/beachhead",
    );
    expect(
      screen
        .getByRole("link", { name: /Beachhead/ })
        .querySelectorAll("a, button, [tabindex]"),
    ).toHaveLength(0);
  });
});

/**
 * What a row says about the scenario (issue #2179), and how it says what the
 * scenario holds (issue #2180). The counts themselves are a plain unit test in
 * `listing.test.ts`. What is pinned here is that the row draws them as chips
 * rather than a sentence, that a count of nothing is still drawn, that the
 * description only takes a line when there is one, and that none of it added a
 * second thing to tab to.
 */
describe("what a scenario row says", () => {
  /** The same local scenario, described and last written two hours ago. */
  function described(description: string): LoadedScenario {
    return {
      scenario: {
        ...local.scenario,
        description,
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      source: "local",
    };
  }

  /** A scenario holding one of each kind of content, and no objectives. */
  function holding(): LoadedScenario {
    return {
      scenario: {
        ...local.scenario,
        actors: [
          {
            id: "a1",
            unitDef: "armcom",
            team: "you",
            pos: { x: 0, z: 0 },
            facing: 0,
          },
        ],
        zones: [
          {
            id: "z1",
            name: "Base",
            shape: "box",
            min: { x: 0, z: 0 },
            max: { x: 100, z: 100 },
          },
        ],
        triggers: [
          {
            id: "t1",
            name: "t1",
            enabled: true,
            repeat: false,
            conditions: { op: "all", conditions: [] },
            actions: [],
          },
        ],
      },
      source: "local",
    };
  }

  /** The column of lines beside a row's map picture. */
  const columnOf = (name: string) =>
    screen
      .getByRole("link", { name: new RegExp(name) })
      .querySelector("div.flex-col") as HTMLElement;

  /**
   * The lines under a row's name, in the order they are drawn. The line saying
   * what the scenario holds is icons and numbers, so it is named rather than
   * read out.
   */
  const linesUnder = (name: string) =>
    [...columnOf(name).children]
      .slice(1)
      .map((el) =>
        el.querySelector("svg") ? "the content chips" : el.textContent,
      );

  /**
   * Every content chip in a row, by the phrase it carries. These fixtures are in
   * no campaign, so the chips are the only titled things inside the link.
   */
  const chipsOf = (name: string) =>
    [
      ...screen
        .getByRole("link", { name: new RegExp(name) })
        .querySelectorAll("span[title]"),
    ].map((el) => el.getAttribute("title"));

  it("shows the description, on one truncated line", () => {
    show([described("Hold the landing zone until the second wave lands.")]);

    const line = screen.getByText(
      "Hold the landing zone until the second wave lands.",
    );
    expect(line.className).toMatch(/truncate/);
  });

  // The list is ordered newest edit first, and until now nothing on screen said
  // so or separated two scenarios of the same name.
  it("says when the scenario was last edited", () => {
    show([described("Anything")]);

    expect(screen.getByText("edited 2h ago")).toBeTruthy();
  });

  it("leaves the edit time off a document carrying no stamp", () => {
    show([local]);

    expect(screen.queryByText(/^edited\b/)).toBeNull();
  });

  // The game used to sit on this line too. It is the group heading now
  // (issue #2181), so the row is left with the half of the pair the heading
  // does not cover.
  it("gives a scenario with no description no line to hold it", () => {
    show([local]);

    expect(linesUnder("Beachhead")).toEqual(["No map", "the content chips"]);
  });

  it("puts the description under what the scenario holds", () => {
    show([described("Hold the landing zone.")]);

    expect(linesUnder("Beachhead")).toEqual([
      "No map",
      "the content chips",
      "Hold the landing zone.",
    ]);
  });

  // Issue #2180: the counts used to be a sentence, and a screenful of rows all
  // reading the same shape of sentence hid the row that was different.
  it("draws what the scenario holds as chips, not as a sentence", () => {
    show([holding()]);

    expect(chipsOf("Beachhead")).toEqual([
      "1 unit placement",
      "1 zone",
      "1 trigger",
      "0 objectives",
    ]);
    expect(screen.queryByText(/unit placements? · \d+ zones?/)).toBeNull();
  });

  // A chip is an icon beside a digit, which says nothing to a screen reader, so
  // the phrase is the only text either the chip or the row's own name is given.
  it("gives every chip its phrase in text, and hides the digit from it", () => {
    show([holding()]);

    const zones = screen.getByTitle("1 zone");
    expect(zones.querySelector("span.sr-only")?.textContent).toBe("1 zone");
    expect(zones.querySelector("span[aria-hidden='true']")?.textContent).toBe(
      "1",
    );
    expect(zones.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  /**
   * A count of nothing is dimmed, not dropped. A dropped chip slides the rest
   * along, so no kind sits in the same place twice down the list, and a gap
   * makes no claim at all where "0 triggers" does.
   */
  it("keeps a chip for a kind the scenario has none of, dimmed", () => {
    show([holding()]);

    expect(chipsOf("Beachhead")).toContain("0 objectives");
    expect(screen.getByTitle("0 objectives").className).toMatch(/opacity-40/);
    expect(screen.getByTitle("1 zone").className).not.toMatch(/opacity-40/);
  });

  // Everything added here is text inside the row's own link. A second tab stop
  // in a row is a list a keyboard has to walk twice.
  it("adds nothing inside the row link that takes focus", () => {
    show([described("Hold the landing zone.")]);

    expect(
      screen
        .getByRole("link", { name: /Beachhead/ })
        .querySelectorAll("a, button, input, select, textarea, [tabindex]"),
    ).toHaveLength(0);
  });
});

/**
 * Narrowing the list and gathering it under the game (issue #2181).
 *
 * Past a screenful the list could only be scrolled, and the game repeated on
 * every row. What is pinned here is that the search and the chips actually
 * narrow it, that a search matching nothing says the scenarios are still there
 * rather than going blank, that the controls can be reached without a mouse, and
 * that the groups come out newest edit first the way the flat list did.
 */
describe("finding a scenario in the list", () => {
  /** A scenario as the list holds one: named, on a game, from a source. */
  function made(
    name: string,
    {
      game = "",
      map = "Comet Catcher",
      source = "local",
      edited = "2026-01-01T00:00:00.000Z",
    }: {
      game?: string;
      map?: string;
      source?: LoadedScenario["source"];
      edited?: string;
    } = {},
  ): LoadedScenario {
    const scenario = {
      ...newScenario(name),
      id: name.toLowerCase().replace(/\W+/g, "-"),
      updatedAt: edited,
    };
    return {
      scenario: {
        ...scenario,
        setup: { ...scenario.setup, gameName: game, mapName: map },
      },
      source,
      ...(source === "game"
        ? {
            origin: {
              gameName: game,
              archivePath: `/games/${game}.sdd`,
              folder: "missions",
              loose: true,
            },
          }
        : {}),
    };
  }

  const searchBox = () =>
    screen.getByRole("textbox", { name: "Search scenarios by name" });

  it("narrows the list to the names matching what is typed", () => {
    show([made("Beachhead"), made("Bridgehead"), made("Last Stand")]);

    fireEvent.change(searchBox(), { target: { value: "head" } });

    expect(rowNames()).toEqual(["Beachhead", "Bridgehead"]);
  });

  it("ignores case and surrounding space in the search", () => {
    show([made("Beachhead"), made("Last Stand")]);

    fireEvent.change(searchBox(), { target: { value: "  BEACH " } });

    expect(rowNames()).toEqual(["Beachhead"]);
  });

  // A blank list is indistinguishable from a list that has lost its documents,
  // so the empty state counts what is being hidden and offers the way back.
  it("says the scenarios are still there when nothing matches", () => {
    show([made("Beachhead"), made("Last Stand")]);

    fireEvent.change(searchBox(), { target: { value: "zzz" } });

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(
      screen.getByText("No scenarios match. All 2 are still here."),
    ).toBeTruthy();
  });

  it("brings the whole list back from the empty state, without a mouse", () => {
    show([made("Beachhead"), made("Last Stand")]);
    fireEvent.change(searchBox(), { target: { value: "zzz" } });

    const button = screen.getByRole("button", { name: "Show all scenarios" });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);

    expect(rowNames()).toEqual(["Beachhead", "Last Stand"]);
    expect((searchBox() as HTMLInputElement).value).toBe("");
  });

  it("offers no source chips when every scenario came from the same place", () => {
    show([made("Beachhead"), made("Last Stand")]);

    expect(screen.queryByRole("button", { name: "Mine" })).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("offers a chip per source once the list holds more than one", () => {
    show([
      made("Beachhead"),
      made("Tutorial", { source: "bundled" }),
      made("Skirmish", { game: "BA", source: "game" }),
    ]);

    expect(
      screen
        .getAllByRole("button", { pressed: false })
        .map((b) => b.textContent),
    ).toEqual(["Mine", "Bundled", "From games"]);
    expect(
      screen.getByRole("button", { name: "All", pressed: true }),
    ).toBeTruthy();
  });

  it("narrows to one source when its chip is pressed", () => {
    show([
      made("Beachhead"),
      made("Tutorial", { source: "bundled" }),
      made("Skirmish", { game: "BA", source: "game" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Bundled" }));

    expect(rowNames()).toEqual(["Tutorial"]);
    expect(
      screen.getByRole("button", { name: "Bundled", pressed: true }),
    ).toBeTruthy();
  });

  it("applies the search and the chip together", () => {
    show([
      made("Beachhead"),
      made("Beach Landing", { source: "bundled" }),
      made("Tutorial", { source: "bundled" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Bundled" }));
    fireEvent.change(searchBox(), { target: { value: "beach" } });

    expect(rowNames()).toEqual(["Beach Landing"]);
  });

  // Every control added here is a plain button or a text box, so it is in the
  // tab order and works on Enter without any handler of its own. What would
  // break that is a tabindex taking one back out, so that is what is checked.
  it("puts the search box and every chip in the tab order", () => {
    show([made("Beachhead"), made("Tutorial", { source: "bundled" })]);

    const controls = [
      searchBox(),
      ...screen
        .getAllByRole("button")
        .filter((b) =>
          ["All", "Mine", "Bundled"].includes(b.textContent ?? ""),
        ),
    ];
    expect(controls).toHaveLength(4);
    for (const control of controls) {
      expect(control.getAttribute("tabindex")).toBeNull();
      control.focus();
      expect(document.activeElement).toBe(control);
    }
  });
});

describe("the list gathered under each game", () => {
  function onGame(name: string, game: string, edited: string): LoadedScenario {
    const scenario = { ...newScenario(name), id: name, updatedAt: edited };
    return {
      scenario: {
        ...scenario,
        setup: { ...scenario.setup, gameName: game, mapName: "Comet Catcher" },
      },
      source: "local",
    };
  }

  it("names the game once above its scenarios instead of on every row", () => {
    show([
      onGame("One", "Balanced Annihilation", "2026-01-03T00:00:00.000Z"),
      onGame("Two", "Balanced Annihilation", "2026-01-02T00:00:00.000Z"),
    ]);

    expect(headings()).toEqual(["Balanced Annihilation"]);
    expect(screen.queryAllByText("Balanced Annihilation")).toHaveLength(1);
  });

  // The list arrives newest edit first and nothing here reorders it, so the
  // group holding the newest scenario leads and each group is internally newest
  // first. That keeps the one thing the ordering was for: the scenario just
  // edited is the first on the screen.
  it("leads with the group holding the newest edit", () => {
    show([
      onGame("Newest", "Zero-K", "2026-03-01T00:00:00.000Z"),
      onGame("Older", "Balanced Annihilation", "2026-02-01T00:00:00.000Z"),
      onGame("Oldest", "Zero-K", "2026-01-01T00:00:00.000Z"),
    ]);

    expect(headings()).toEqual(["Zero-K", "Balanced Annihilation"]);
    expect(rowNames()).toEqual(["Newest", "Oldest", "Older"]);
  });

  // A draft names no game and cannot be filed under one, so it gets a heading
  // that says as much rather than an empty one or a silent first section.
  it("gathers the scenarios with no game under a heading of their own", () => {
    show([local, onGame("Two", "Zero-K", "2020-01-01T00:00:00.000Z")]);

    expect(headings()).toEqual(["No game yet", "Zero-K"]);
  });
});

/**
 * Duplicate (issue #2183). The issue expected a copy to share the original's
 * dialogue clips the way an attached campaign mission does, but a mission shares
 * them by keeping the source scenario's id and a copy has an id of its own, so
 * the clips are copied instead. What is pinned here is the whole chain from the
 * menu item to what lands on disk, because a copy that quietly loses its clips
 * looks exactly like one that worked.
 */
describe("duplicating a scenario", () => {
  /** The local scenario with a dialogue line carrying both kinds of clip. */
  const withClips = (): LoadedScenario => ({
    scenario: {
      ...local.scenario,
      dialogue: [
        {
          id: "open",
          speaker: "Command",
          text: "Go.",
          portrait: "a.png",
          audio: "b.ogg",
        },
      ],
    },
    source: "local",
  });

  /** Pick Duplicate out of a row's menu, the way a keyboard does. */
  function duplicateByKeyboard(name: string) {
    openMenuByKeyboard(name);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Duplicate/ }), {
      key: "Enter",
    });
  }

  /** The document the copy wrote, once it has been written. */
  async function written() {
    await vi.waitFor(() => expect(plugin.save).toHaveBeenCalledTimes(1));
    const { id, json } = plugin.save.mock.calls[0][0];
    return { id, document: JSON.parse(json) as Scenario };
  }

  it("writes a second scenario rather than touching the one it came from", async () => {
    show([local]);

    duplicateByKeyboard("Beachhead");

    const { id, document } = await written();
    expect(id).not.toBe("beachhead");
    expect(document.id).toBe(id);
    expect(document.name).toBe("Copy of Beachhead");
    // The original is still exactly what it was: one write, and not to it.
    expect(plugin.save).toHaveBeenCalledTimes(1);
    expect(local.scenario.name).toBe("Beachhead");
  });

  it("opens the editor on the copy, not on the original", async () => {
    show([local]);

    duplicateByKeyboard("Beachhead");

    const { id } = await written();
    await vi.waitFor(() => expect(editingId()).toBe(id));
    expect(id).not.toBe("beachhead");
  });

  // The load-bearing half. A clip lives at `media/<scenarioId>/<file>`, so a
  // copy under a new id that took only the document would name two files that
  // are not under it, and play silent.
  it("copies the dialogue clips into the copy's own media folder", async () => {
    show([withClips()]);

    duplicateByKeyboard("Beachhead");

    const { id } = await written();
    expect(plugin.mediaRead.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        { scenarioId: "beachhead", file: "a.png" },
        { scenarioId: "beachhead", file: "b.ogg" },
      ]),
    );
    expect(
      plugin.mediaWrite.mock.calls.map(([{ scenarioId, file }]) => ({
        scenarioId,
        file,
      })),
    ).toEqual(
      expect.arrayContaining([
        { scenarioId: id, file: "a.png" },
        { scenarioId: id, file: "b.ogg" },
      ]),
    );
  });

  // Duplicating twice is the fastest way to two rows nothing on screen can tell
  // apart, which is what the row was rebuilt to avoid (issue #2179).
  it("counts up when the obvious copy name is already in the list", async () => {
    show([
      local,
      {
        scenario: {
          ...local.scenario,
          id: "copy-1",
          name: "Copy of Beachhead",
        },
        source: "local",
      },
    ]);

    duplicateByKeyboard("Beachhead");

    const { document } = await written();
    expect(document.name).toBe("Copy of Beachhead (2)");
  });

  it("says so when the copy could not be written, and stays on the list", async () => {
    plugin.save.mockRejectedValueOnce(new Error("disk full"));
    show([local]);

    duplicateByKeyboard("Beachhead");

    await vi.waitFor(() =>
      expect(toasted.errors).toEqual([
        "Could not duplicate Beachhead: disk full",
      ]),
    );
    expect(editingId()).toBeNull();
  });
});

/**
 * The starter, offered where somebody has nothing to copy (issue #2183). What
 * it holds is pinned in `create.test.ts`, against the validator. What is pinned
 * here is that the empty state can actually reach it, and that picking it saves
 * the mission rather than the blank document the other button saves.
 */
describe("the empty state's starter", () => {
  /** Fill in the form the drawer opened and create the scenario. */
  function createNamed(name: string) {
    render(opened[0].content);
    fireEvent.change(screen.getByPlaceholderText("Name"), {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
  }

  it("offers the starter only while there are no scenarios", () => {
    show([]);
    expect(
      screen.getByRole("button", { name: /Start from the starter/ }),
    ).toBeTruthy();

    cleanup();
    show([local]);
    expect(
      screen.queryByRole("button", { name: /Start from the starter/ }),
    ).toBeNull();
  });

  it("saves a scenario with a mission in it, not an empty one", async () => {
    show([]);

    fireEvent.click(
      screen.getByRole("button", { name: /Start from the starter/ }),
    );
    expect(opened.map((o) => o.title)).toEqual([
      "New scenario from the starter",
    ]);
    createNamed("First mission");

    await vi.waitFor(() => expect(plugin.save).toHaveBeenCalledTimes(1));
    const document = JSON.parse(plugin.save.mock.calls[0][0].json) as Scenario;
    expect(document.name).toBe("First mission");
    expect(document.triggers.length).toBeGreaterThan(0);
    expect(document.objectives.length).toBeGreaterThan(0);
  });

  it("still saves an empty document from New scenario", async () => {
    show([]);

    fireEvent.click(screen.getByRole("button", { name: /New scenario/ }));
    expect(opened.map((o) => o.title)).toEqual(["New scenario"]);
    createNamed("From scratch");

    await vi.waitFor(() => expect(plugin.save).toHaveBeenCalledTimes(1));
    const document = JSON.parse(plugin.save.mock.calls[0][0].json) as Scenario;
    expect(document.triggers).toEqual([]);
    expect(document.objectives).toEqual([]);
  });
});

describe("a read-only scenario's row", () => {
  // A bundled scenario's clips are not in the media store until it is launched,
  // and a game's own mission keeps them inside the game archive, so neither has
  // anything a copy could take with it. Offering Duplicate would make a copy
  // whose dialogue has quietly lost its portraits.
  it("offers neither Edit, Duplicate nor Delete, but still shares", () => {
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

/**
 * The header's four buttons became two and a menu (issue #2184). Rescan and
 * Reclaim clips are housekeeping on the store behind the list, and they were
 * drawn at the same weight as the two actions the page is for.
 */
describe("the Scenario Builder header", () => {
  /** Open the header menu the way a keyboard does, and hand back its items. */
  function openHeaderMenu() {
    const trigger = screen.getByRole("button", {
      name: "More scenario actions",
    });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });
    return trigger;
  }

  it("keeps Import and New scenario as buttons of their own", () => {
    show([local]);

    expect(screen.getByRole("button", { name: /Import/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /New scenario/ })).toBeTruthy();
  });

  it("takes Rescan and Reclaim clips out of the header itself", () => {
    show([local]);

    expect(screen.queryByRole("button", { name: /Rescan/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reclaim clips/ })).toBeNull();
  });

  it("offers both of them in the menu, reached from the keyboard alone", () => {
    show([local]);

    openHeaderMenu();

    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      expect.stringContaining("Rescan"),
      expect.stringContaining("Reclaim clips"),
    ]);
  });

  // The list is re-read in place, so nothing on screen would otherwise change.
  // The menu has also closed by then, which is why the spinner the button used
  // to show is a toast now.
  it("rescans from the menu and says that it did", async () => {
    const refresh = vi.fn(async () => {});
    show([local], refresh);
    openHeaderMenu();

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Rescan/ }), {
      key: "Enter",
    });

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(toasted.successes).toEqual([
        "Rescanned. The scenario list is up to date.",
      ]),
    );
  });

  // A dry run in a drawer, not a delete. The menu is gone by the time the
  // preview is on screen, which is why it is not the popover it used to be.
  it("opens the reclaim preview from the menu", () => {
    show([local]);
    openHeaderMenu();

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Reclaim clips/ }), {
      key: "Enter",
    });

    expect(opened.map((o) => o.title)).toEqual(["Reclaim dialogue clips"]);
  });

  // Issue #2203, applied to a header. A row menu at least has a row to hover.
  // This one has nothing, so it has to be there before anything is pointed at,
  // and it has to say what it is rather than being three dots on their own.
  it("shows a named trigger at rest rather than one that fades in", () => {
    show([local]);

    // Nothing hovered, nothing focused, nothing opened.
    const trigger = screen.getByRole("button", {
      name: "More scenario actions",
    });

    expect(trigger.textContent).toContain("More");
    expect(trigger.className).not.toMatch(/(^|\s|:)opacity-0(\s|$)/);
    expect(trigger.className).not.toMatch(/group-hover:/);
  });
});
