// @vitest-environment happy-dom
/**
 * The Mission runtime section starts collapsed on the game page (it can run to
 * a full install summary, capability breakdown and written-missions list), and
 * opens on a click of its own heading. Everything scenarioRuntimeStatus and
 * useScenarios would otherwise reach for is stubbed, since this is about the
 * collapse behaviour rather than any install flow.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameItem } from "../../bindings";

vi.mock("@/scenario/bindings", () => ({
  scenarioListMissions: () => Promise.resolve({ missions: [] }),
  scenarioRuntimeStatus: () =>
    Promise.resolve({
      installed: null,
      installedError: null,
      available: null,
      extensions: null,
      duplicates: [],
    }),
  scenarioRuntimeInstall: () => Promise.reject(new Error("not used")),
  scenarioRuntimeConsolidate: () => Promise.reject(new Error("not used")),
}));

vi.mock("@/scenario/scenarios", () => ({
  useScenarios: () => ({ scenarios: [], loading: false, error: null }),
}));

const { MissionRuntimeSection } = await import("./MissionRuntimeSection");

afterEach(cleanup);

const GAME: GameItem = {
  name: "Test Game",
  primaryArchive: { name: "testgame.sdd", path: "/data/games/testgame.sdd" },
  dependencyArchives: [],
  info: {},
};

// This build of coilbox ships no runtime in the test environment, so
// scenarioRuntimeStatus resolves `available: null`, and that is the sentence
// `summary()` gives back for it - a stable string to assert on regardless of
// install state.
const BODY_TEXT = "This build of coilbox has no mission runtime to install.";

describe("MissionRuntimeSection", () => {
  it("starts closed and opens the body on a click of its heading", async () => {
    render(<MissionRuntimeSection game={GAME} />);

    const trigger = await screen.findByRole("button", {
      name: /Mission runtime/,
    });
    expect(screen.queryByText(BODY_TEXT)).toBeNull();

    fireEvent.click(trigger);

    expect(await screen.findByText(BODY_TEXT)).toBeTruthy();
  });
});
