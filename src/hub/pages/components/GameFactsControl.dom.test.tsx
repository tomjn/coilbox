// @vitest-environment happy-dom

/**
 * What the control tells somebody after a run (issue #1875).
 *
 * `../../games/factsSweep.test.ts` covers what a sweep does. This covers the
 * half that sent somebody looking in the wrong place: a game that did not land
 * was counted and never named, so the one thing that says why - the hub's own
 * words, or the local check that stopped it - reached the report and no further.
 *
 * The sweep itself is stubbed. What is real here is the component and what it
 * puts on the screen.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type {
  GameSweepProgress,
  GameSweepReport,
} from "../../games/factsSweep";

const sweep = vi.hoisted(() =>
  vi.fn<
    (
      target: unknown,
      onProgress: (progress: GameSweepProgress) => void,
    ) => Promise<GameSweepReport>
  >(),
);
vi.mock("../../games/factsSweep", async (real) => ({
  ...(await real<Record<string, unknown>>()),
  sweepGameFacts: sweep,
}));

/** An engine, since the button is disabled without one. */
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engines/105", dataDir: "/data" },
  }),
}));

import { GameFactsControl } from "./GameFactsControl";

const REPORT: GameSweepReport = {
  found: 3,
  sent: 2,
  skipped: [],
  failed: [],
  refused: [],
  errors: [],
};

beforeEach(() => {
  sweep.mockReset();
  sweep.mockResolvedValue(REPORT);
});

afterEach(cleanup);

const press = async () => {
  fireEvent.click(
    screen.getByRole("button", { name: /send what your games say|reading/i }),
  );
  // The click starts a promise, so let it settle before reading the screen.
  await vi.waitFor(() => expect(sweep).toHaveBeenCalled());
};

it("offers nothing until sending has been agreed to", () => {
  render(<GameFactsControl hubUrl="https://hub.example" agreed={false} />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("runs the sweep against the hub it was given", async () => {
  render(<GameFactsControl hubUrl="https://hub.example" agreed />);
  await press();

  expect(sweep.mock.calls[0][0]).toMatchObject({
    hubUrl: "https://hub.example",
    enginePath: "/engines/105",
  });
});

/**
 * The count alone is what sent somebody hunting through their library for a
 * game the summary would not name.
 */
it("names a game that did not land, and quotes what turned it away", async () => {
  sweep.mockResolvedValue({
    ...REPORT,
    sent: 1,
    failed: [
      { game: "Journeywar 148.0", said: "Sign in again and try once more." },
      { game: "XTA 9.65", said: "armcom's stats come to 9001 bytes." },
    ],
  });
  render(<GameFactsControl hubUrl="https://hub.example" agreed />);
  await press();

  await screen.findByText(/Journeywar 148\.0: Sign in again/);
  expect(document.body.textContent).toContain(
    "XTA 9.65: armcom's stats come to 9001 bytes.",
  );
});

/** A run where everything landed says so and adds no empty list. */
it("names nothing when every game landed", async () => {
  render(<GameFactsControl hubUrl="https://hub.example" agreed />);
  await press();

  await screen.findByText(/Sent what 2 games say/);
  expect(screen.queryByRole("list")).toBeNull();
});
