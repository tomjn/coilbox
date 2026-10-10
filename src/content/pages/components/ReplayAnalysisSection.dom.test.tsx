// @vitest-environment happy-dom

/**
 * What the replay page says about analysis in each state, and what its buttons
 * reach (#1157, #1158).
 *
 * The real section and the real frontend store, with the plugin commands
 * replaced. happy-dom does no layout, so nothing here says how it looks.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EMPTY_QUEUE = {
  running: null,
  queued: [],
  waitingForGame: false,
  failures: [],
  stored: 0,
};

/** What each command was handed, in order. */
const called: { command: string; args: unknown }[] = [];
/** What `content_analysis_check` answers. */
let CHECK: {
  cannot: string | null;
  gameId: string | null;
  matchSeconds: number;
  headless: string[];
};
/** The engines in the one content folder `content_state_load` answers with. */
let ENGINES: { path: string; version: string; syncVersion?: string }[] = [];

vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      called.push({ command, args });
      switch (command) {
        case "content_analysis_check":
          return CHECK;
        case "content_state_load":
          return { state: { roots: [{ path: "/data", engines: ENGINES }] } };
        case "content_analysis_enqueue":
          return { outcome: "queued", queue: EMPTY_QUEUE };
        case "content_replay_analyses":
          return { analyses: [] };
        case "content_metric_registry":
          return {
            metrics: [{ key: "unitsTeleported", label: "Units beamed in" }],
            ratios: [],
          };
        default:
          return {};
      }
    },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

let HIDE: string[] = [];
vi.mock("../../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));

import type {
  DemoInfo,
  GameItem,
  ReplayAnalysisRunningJob,
  StoredReplayAnalysis,
} from "../../bindings";
import { resetContentState } from "../../contentState";
import {
  resetReplayAnalysisForTests,
  seedReplayAnalysisForTests,
} from "../../replayAnalysis";
import { ReplayAnalysisSection } from "./ReplayAnalysisSection";

const ID = "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
const PATH = "/replays/match.sdfz";
const TARGET = { enginePath: "/engines/2026", dataDir: "/data" };

const INFO = {
  engineVersion: "2026.07.01",
  gameId: ID,
  startTimeMs: 0,
  durationSec: 769,
  wallclockSec: 800,
  mapName: "Some Map",
  gameType: "Some Game 1.0",
  winningAllyTeams: [0],
  winnersKnown: true,
  numAllyTeams: 2,
  allyTeams: [],
  players: [],
  ais: [],
  modOptions: {},
  mapOptions: {},
} as unknown as DemoInfo;

function stored(
  over: Partial<StoredReplayAnalysis> = {},
): StoredReplayAnalysis {
  return {
    state: "current",
    sizeBytes: 2526,
    kind: "analysis",
    storeFormat: 1,
    outcome: "reproduced",
    gameId: ID,
    loggerFormat: 1,
    loggerVersion: 1,
    engine: "2026.07.01 (Headless)",
    game: "Some Game 1.0",
    map: "Some Map",
    analysedAtMs: 1_700_000_000_000,
    matchSeconds: 769,
    wallSeconds: 24.5,
    counts: {
      header: 1,
      gameStart: 1,
      unitCreated: 57,
      unitFinished: 54,
      unitDestroyed: 22,
      unitGiven: 0,
      startUnitPosition: 0,
      gameOver: 1,
      unknown: 0,
    },
    disagreements: [],
    ...over,
  };
}

function job(
  over: Partial<ReplayAnalysisRunningJob> = {},
): ReplayAnalysisRunningJob {
  return {
    id: 7,
    gameId: ID,
    name: "match.sdfz",
    replayPath: PATH,
    matchSeconds: 769,
    startedAtMs: 0,
    phase: "playing",
    frame: 11535,
    lastFrame: 23070,
    cancelling: false,
    ...over,
  };
}

function show(
  props: Partial<Parameters<typeof ReplayAnalysisSection>[0]> = {},
) {
  return render(
    <ReplayAnalysisSection
      replayPath={PATH}
      info={INFO}
      target={TARGET}
      missingGame={false}
      missingMap={false}
      dependencyBlock={null}
      {...props}
    />,
  );
}

/** The section's help entry, opened. Why and how long are said there. */
const help = () => {
  fireEvent.click(screen.getByRole("button", { name: "About the analysis" }));
  return screen.getByRole("dialog").textContent ?? "";
};
const commands = () => called.map((c) => c.command);
const analyseButton = () =>
  screen.getByRole("button", { name: "Analyse this replay" });

beforeEach(() => {
  called.length = 0;
  HIDE = [];
  CHECK = { cannot: null, gameId: ID, matchSeconds: 769, headless: [] };
  ENGINES = [];
  resetContentState();
  resetReplayAnalysisForTests();
  seedReplayAnalysisForTests({});
});

afterEach(() => {
  cleanup();
});

describe("a replay that has not been analysed", () => {
  it("says what pressing the button will do before it is pressed", async () => {
    show();

    const text = screen.getByRole("region", { name: "Analysis" }).textContent;
    expect(text).toContain(
      "plays this match back in the game's engine on this computer",
    );
    // The consent is short and says what is kept.
    expect(text).toContain(
      "The result is kept only if the playback matches the recorded match",
    );
    // The rest is in the help and not in the section.
    expect(text).not.toContain("The match is 12:49 long");
    expect(text).not.toContain("playback runs faster than the match did");
    const said = help();
    expect(said).toContain("The match is 12:49 long");
    expect(said).toContain("playback runs faster than the match did");
    expect(said).toContain(
      "The engine and the game the replay used must be installed",
    );
    expect(said).toContain("The result is kept, so this happens once");
    await waitFor(() =>
      expect(analyseButton()).toHaveProperty("disabled", false),
    );
  });

  it("promises no duration until this computer has finished a run", () => {
    show();
    expect(
      screen.getByRole("region", { name: "Analysis" }).textContent,
    ).not.toMatch(/expect about/);
  });

  it("estimates from this computer's own runs once there are some, and says how many", () => {
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          gameId: "b".repeat(32),
          matchSeconds: 769,
          wallSeconds: 24.5,
        }),
      ],
    });
    show();
    expect(
      screen.getByRole("region", { name: "Analysis" }).textContent,
    ).toContain("Expect about 25 seconds.");
    expect(help()).toContain(
      "The estimate goes by the 1 analysis this computer has finished.",
    );
  });

  it("starts nothing by being shown", async () => {
    show();
    await waitFor(() =>
      expect(analyseButton()).toHaveProperty("disabled", false),
    );
    expect(commands()).not.toContain("content_analysis_enqueue");
  });

  it("asks for a run with the engine and folder a replay launch would use", async () => {
    show();
    await waitFor(() =>
      expect(analyseButton()).toHaveProperty("disabled", false),
    );

    fireEvent.click(analyseButton());

    await waitFor(() =>
      expect(commands()).toContain("content_analysis_enqueue"),
    );
    expect(
      called.find((c) => c.command === "content_analysis_enqueue")?.args,
    ).toEqual({
      replayPath: PATH,
      enginePath: "/engines/2026",
      dataDir: "/data",
      force: false,
    });
  });
});

describe("a replay that cannot be analysed", () => {
  it("says a match that was quit cannot be, beside a disabled button", async () => {
    CHECK = {
      cannot: "noGameOver",
      gameId: null,
      matchSeconds: 0,
      headless: [],
    };
    show();

    await screen.findByText(/never recorded a game over/);
    expect(analyseButton()).toHaveProperty("disabled", true);
    fireEvent.click(analyseButton());
    expect(commands()).not.toContain("content_analysis_enqueue");
  });

  it("names the engine, the game and the map that are not installed", async () => {
    show({ target: null, missingGame: true, missingMap: true });

    await screen.findByText(/Engine 2026.07.01 is not installed/);
    expect(screen.getByText("The game is not installed.")).toBeTruthy();
    expect(screen.getByText("The map is not installed.")).toBeTruthy();
    expect(analyseButton()).toHaveProperty("disabled", true);
  });

  it("gives a remix no analysis, even its original's", async () => {
    CHECK = {
      cannot: "remix",
      gameId: null,
      matchSeconds: 0,
      headless: [],
    };
    seedReplayAnalysisForTests({ analyses: [stored()] });
    show({ info: { ...INFO, remixed: true } as DemoInfo });

    await screen.findByText(/This is a remix/);
    expect(screen.queryByText(/^Analysed\./)).toBeNull();
    expect(analyseButton()).toHaveProperty("disabled", true);
  });
});

describe("a replay with something stored", () => {
  it("shows when it was analysed, with what, and the counts, and offers no second run", () => {
    seedReplayAnalysisForTests({ analyses: [stored()] });
    show();

    const text = screen.getByRole("region", { name: "Analysis" }).textContent;
    expect(text).toContain("Analysed. 57 units made, 54 finished and 22 lost.");
    expect(text).toContain(
      "with Some Game 1.0 on engine 2026.07.01 (Headless)",
    );
    expect(text).toContain("in 25 seconds");
    expect(screen.queryByRole("button", { name: /Analyse/ })).toBeNull();
  });

  it("deletes the analysis by its game id and leaves the replay alone", async () => {
    seedReplayAnalysisForTests({ analyses: [stored()] });
    show();

    fireEvent.click(screen.getByRole("button", { name: "Delete analysis" }));
    const confirm = await screen.findAllByRole("button", {
      name: "Delete analysis",
    });
    fireEvent.click(confirm[confirm.length - 1]);

    await waitFor(() =>
      expect(commands()).toContain("content_replay_analysis_delete"),
    );
    expect(
      called.find((c) => c.command === "content_replay_analysis_delete")?.args,
    ).toEqual({ gameId: ID });
    expect(commands()).not.toContain("content_delete_replay");
    // The list is read again, and it is empty, so the page is back to the offer.
    await waitFor(() => expect(analyseButton()).toBeTruthy());
  });

  it("offers a new run for an analysis from an earlier logger, and asks for it by force", async () => {
    seedReplayAnalysisForTests({ analyses: [stored({ state: "outdated" })] });
    show();

    expect(
      screen.getByText(/made by an earlier version of coilbox/),
    ).toBeTruthy();
    const again = screen.getByRole("button", { name: "Analyse again" });
    await waitFor(() => expect(again).toHaveProperty("disabled", false));
    fireEvent.click(again);

    await waitFor(() =>
      expect(commands()).toContain("content_analysis_enqueue"),
    );
    expect(
      called.find((c) => c.command === "content_analysis_enqueue")?.args,
    ).toMatchObject({ force: true });
  });

  it("says a diverged playback did not reproduce the match, names the figures and the usual reason", async () => {
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          disagreements: [
            { figure: "winners", recorded: "0", observed: "1" },
            {
              figure: "unitsTeleported",
              team: 0,
              recorded: "1500",
              observed: "1750",
              difference: 250,
            },
          ],
        }),
      ],
    });
    show();

    // The statistic's name arrives with the metric registry.
    await screen.findByText(/Units beamed in for team 0/);
    const text = screen.getByRole("region", { name: "Analysis" }).textContent;
    expect(text).toContain("did not reproduce the recorded match");
    expect(text).not.toContain(
      "is not exactly the one the match was played on",
    );
    expect(help()).toContain(
      "the installed game or engine is not exactly the one the match was played on",
    );
    expect(text).toContain(
      "Who won: the replay recorded 0, the playback gave 1.",
    );
    expect(text).not.toContain("units made");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("a replay in the queue", () => {
  it("shows the frame it has reached and cancels by job id", async () => {
    seedReplayAnalysisForTests({ queue: { running: job() } });
    show();

    expect(screen.getByText(/Frame 11,535 of 23,070/)).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "Playback progress" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(commands()).toContain("content_analysis_cancel"),
    );
    expect(
      called.find((c) => c.command === "content_analysis_cancel")?.args,
    ).toEqual({ id: 7 });
  });

  it("draws no bar while the engine is still starting", () => {
    seedReplayAnalysisForTests({
      queue: { running: job({ phase: "starting", frame: 0 }) },
    });
    show();

    expect(screen.getByText(/Starting the engine/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("says how many are ahead of a queued one", () => {
    const other = {
      id: 3,
      gameId: "b".repeat(32),
      name: "b.sdfz",
      replayPath: "/b",
    };
    const mine = { id: 4, gameId: ID, name: "match.sdfz", replayPath: PATH };
    seedReplayAnalysisForTests({
      queue: {
        running: job({ gameId: "c".repeat(32) }),
        queued: [other, mine],
      },
    });
    show();

    expect(
      screen.getByText("Queued, with 1 analysis ahead of it."),
    ).toBeTruthy();
  });

  it("says it is waiting for the game when one is running", () => {
    const mine = { id: 4, gameId: ID, name: "match.sdfz", replayPath: PATH };
    seedReplayAnalysisForTests({
      queue: { queued: [mine], waitingForGame: true },
    });
    show();

    expect(
      screen.getByText("Queued. It starts when the game you are playing ends."),
    ).toBeTruthy();
  });
});

describe("a run that failed", () => {
  it("says a run that took too long was not a divergence, and stored nothing", () => {
    seedReplayAnalysisForTests({
      queue: {
        failures: [
          {
            gameId: ID,
            name: "match.sdfz",
            reason: "tookTooLong",
            message: "the playback did not finish in the time allowed",
            limitSeconds: 1069,
            logExcerpt: [],
          },
        ],
      },
    });
    show();

    const text = screen.getByRole("alert").textContent;
    expect(text).toContain("The playback took too long and was stopped.");
    expect(text).toContain("It was allowed 18 minutes");
    expect(text).toContain("Nothing was stored.");
    expect(text).not.toMatch(/did not reproduce/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the engine's last lines behind a disclosure", () => {
    seedReplayAnalysisForTests({
      queue: {
        failures: [
          {
            gameId: ID,
            name: "match.sdfz",
            reason: "engineFailed",
            message:
              "the engine exited with status 3 before the replay logger loaded",
            logExcerpt: ["GAME-section missing"],
          },
        ],
      },
    });
    show();

    expect(screen.queryByText("GAME-section missing")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "What the engine said" }),
    );
    expect(screen.getByText("GAME-section missing")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "The engine exited with status 3 before the replay logger loaded.",
    );
  });
});

describe("a distribution that hides analytics.run", () => {
  beforeEach(() => {
    HIDE = ["analytics.run"];
  });

  it("shows nothing at all for a replay with nothing stored", () => {
    const { container } = show();
    expect(container.textContent).toBe("");
    expect(commands()).toEqual([]);
  });

  it("still shows a stored analysis, with no way to run another", () => {
    seedReplayAnalysisForTests({ analyses: [stored({ state: "outdated" })] });
    show();

    expect(screen.getByText(/^Analysed\./)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Analyse|Try again/ }),
    ).toBeNull();
    expect(commands()).not.toContain("content_analysis_check");
  });

  it("shows no running job and no cancel", () => {
    seedReplayAnalysisForTests({
      queue: { running: job() },
      analyses: [stored()],
    });
    show();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText(/^Analysed\./)).toBeTruthy();
  });
});

describe("a replay whose engine is not installed (#3869)", () => {
  const OLD = { path: "/engines/2025.06.19", version: "2025.06.19" };
  const NEW = {
    path: "/engines/2026.07.04-46-g04f42e2 macos_integration",
    version: "2026.07.04-46-g04f42e2 macos_integration",
  };
  const NO_HEADLESS = { path: "/engines/2027.01.01", version: "2027.01.01" };

  function withEngines(headless: { path: string }[] = [OLD, NEW]) {
    ENGINES = [OLD, NEW, NO_HEADLESS];
    CHECK = { ...CHECK, headless: headless.map((e) => e.path) };
  }

  const region = () =>
    screen.getByRole("region", { name: "Analysis" }).textContent ?? "";
  const enqueued = () =>
    called.find((c) => c.command === "content_analysis_enqueue")?.args;

  it("says which engine recorded it, which will be used, and when the result is kept", async () => {
    withEngines();
    show({ target: null });

    await screen.findByRole("button", {
      name: "Analyse with 2026.07.04-46-g04f42e2 macos_integration",
    });
    expect(region()).toContain(
      "This replay was recorded on engine 2026.07.01, which is not installed.",
    );
    expect(region()).toContain(
      "The analysis will use engine 2026.07.04-46-g04f42e2 macos_integration instead.",
    );
    expect(region()).toContain(
      "The result is kept only if the playback matches the recorded match",
    );
    expect(region()).not.toContain("often computes a different match");
    expect(help()).toContain("often computes a different match");
    expect(screen.getByRole("dialog").textContent).toContain(
      "who won, how long it lasted and every team's final totals",
    );
    // No odds are quoted.
    expect(region()).not.toMatch(/usually|likely to work|%/);
  });

  it("offers only engines that can run headless, newest first", async () => {
    withEngines();
    show({ target: null });
    await screen.findByRole("button", { name: /^Analyse with/ });

    fireEvent.click(screen.getByRole("combobox", { name: "Engine to use" }));
    const options = (await screen.findAllByRole("option")).map(
      (o) => o.textContent,
    );
    expect(options).toEqual([NEW.version, OLD.version]);
  });

  it("runs nothing until the button is pressed, then asks for the chosen engine and its folder", async () => {
    withEngines();
    show({ target: null });
    const button = await screen.findByRole("button", { name: /^Analyse with/ });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    expect(enqueued()).toBeUndefined();

    fireEvent.click(button);

    await waitFor(() => expect(enqueued()).toBeDefined());
    expect(enqueued()).toEqual({
      replayPath: PATH,
      enginePath: NEW.path,
      dataDir: "/data",
      game: undefined,
      force: false,
    });
  });

  it("says so when engines are installed and none can run headless", async () => {
    withEngines([]);
    show({ target: null });

    await screen.findByText(/none of the engines that are installed can run/);
    expect(analyseButton()).toHaveProperty("disabled", true);
  });

  it("offers the download for a missing map in its own place, and no run", async () => {
    withEngines();
    show({
      missingMap: true,
      downloads: <button type="button">Download map</button>,
    });

    await screen.findByText("The map is not installed.");
    expect(screen.getByRole("button", { name: "Download map" })).toBeTruthy();
    expect(analyseButton()).toHaveProperty("disabled", true);
    expect(commands()).not.toContain("content_analysis_enqueue");
  });

  it("shows no download offer when nothing is in the way", async () => {
    show({ downloads: <button type="button">Download map</button> });
    await waitFor(() =>
      expect(analyseButton()).toHaveProperty("disabled", false),
    );
    expect(screen.queryByRole("button", { name: "Download map" })).toBeNull();
  });

  it("depends on another installed version of the game, and says so", async () => {
    withEngines();
    const games = [
      { name: "Some Game 0.9" },
      { name: "Some Game 1.2" },
    ] as unknown as GameItem[];
    show({
      info: { ...INFO, gameType: "Some Game 1.0" } as DemoInfo,
      target: null,
      missingGame: true,
      installedGames: games,
    });

    const button = await screen.findByRole("button", { name: /^Analyse with/ });
    expect(region()).toContain(
      "The game this replay was recorded on, Some Game 1.0, is not installed. The analysis will use Some Game 1.2, another version of it.",
    );
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    await waitFor(() => expect(enqueued()).toBeDefined());
    expect(enqueued()).toMatchObject({ game: "Some Game 1.2" });
  });

  it("does not offer an engine again that did not reproduce the match, until it is asked for", async () => {
    withEngines();
    const attempt = (engine: string) => ({
      engine,
      game: "Some Game 1.0",
      analysedAtMs: 1,
      disagreements: [],
    });
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          engine: NEW.version,
          attempts: [attempt(NEW.version)],
        }),
      ],
    });
    show({ target: null });

    // The untried engine is the one picked.
    await screen.findByRole("button", {
      name: "Try with 2025.06.19",
    });
    expect(region()).toContain(
      `Already tried, and did not reproduce the match: ${NEW.version}.`,
    );
  });

  it("leaves the choice to the person when every engine has been tried", async () => {
    withEngines();
    const attempt = (engine: string) => ({
      engine,
      game: "Some Game 1.0",
      analysedAtMs: 1,
      disagreements: [],
    });
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          attempts: [attempt(NEW.version), attempt(OLD.version)],
        }),
      ],
    });
    show({ target: null });

    await screen.findByText(/Every installed engine has been tried/);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("offers nothing new when the recorded engine is installed", async () => {
    withEngines();
    show();
    await waitFor(() =>
      expect(analyseButton()).toHaveProperty("disabled", false),
    );
    expect(region()).not.toContain("which is not installed");
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("a stored analysis made with another engine (#3869)", () => {
  const region = () =>
    screen.getByRole("region", { name: "Analysis" }).textContent ?? "";

  it("says a different engine was used, and that the events are kept because the match matched", () => {
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          engine: "2026.07.04-46-g04f42e2",
          recordedEngine: "2025.06.21",
          engineDiffers: true,
          gameDiffers: false,
        }),
      ],
    });
    show();

    expect(region()).toContain(
      "It used engine 2026.07.04-46-g04f42e2, and the replay was recorded on engine 2025.06.21.",
    );
    expect(region()).toContain(
      "The playback still matched the recorded match exactly, so the events are kept.",
    );
  });

  it("names a different engine as the likely reason a run did not reproduce", () => {
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          engine: "2026.07.04-46-g04f42e2",
          recordedEngine: "2025.06.21",
          engineDiffers: true,
          disagreements: [
            {
              figure: "winners",
              recorded: "0",
              observed: "1",
            },
          ],
        }),
      ],
    });
    show({ target: null });

    expect(region()).toContain("A different engine is the likely reason.");
    expect(region()).toContain("the replay recorded 0, the playback gave 1.");
  });

  it("says nothing about a different engine for a file written before it was recorded", () => {
    seedReplayAnalysisForTests({
      analyses: [stored({ engineDiffers: null, gameDiffers: null })],
    });
    show();

    expect(region()).not.toMatch(/It used engine|different engine|same engine/);
  });

  it("lists every engine a match has been tried on", () => {
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          attempts: [
            {
              engine: "2026.07.01",
              game: "G 1",
              analysedAtMs: 1,
              disagreements: [],
            },
            {
              engine: "2026.07.04",
              game: "G 1",
              analysedAtMs: 2,
              disagreements: [],
            },
          ],
        }),
      ],
    });
    show({ target: null });

    expect(region()).toContain(
      "Tried so far, and none reproduced the match: engine 2026.07.01 with G 1, engine 2026.07.04 with G 1.",
    );
  });
});

describe("a distribution that hides analytics.run (#3869)", () => {
  it("offers no other engine and does not ask which engines there are", () => {
    HIDE = ["analytics.run"];
    ENGINES = [{ path: "/engines/2025.06.19", version: "2025.06.19" }];
    seedReplayAnalysisForTests({ analyses: [stored()] });
    show({ target: null });

    expect(commands()).not.toContain("content_state_load");
    expect(commands()).not.toContain("content_analysis_check");
    expect(screen.queryByRole("button", { name: /Analyse/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
