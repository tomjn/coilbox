// @vitest-environment happy-dom

/**
 * The control a person actually presses (issue #1952).
 *
 * `../../assets/pictureSweep.test.ts` covers what a sweep does. This covers the
 * half the issue is really about: that there is a button at all, that it says
 * what the hub is missing, and that pressing it starts a run rather than looking
 * like it did.
 *
 * The sweep itself is stubbed. What is real here is the component, its words and
 * its wiring, which is what was missing from the settings page.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  LAST_SWEPT_KEY,
  type PictureSweepProgress,
  type PictureSweepReport,
} from "../../assets/pictureSweep";

const sweep = vi.hoisted(() =>
  vi.fn<
    (
      target: unknown,
      onProgress: (progress: PictureSweepProgress) => void,
    ) => Promise<PictureSweepReport>
  >(),
);
vi.mock("../../assets/pictureSweep", async (real) => ({
  ...(await real<Record<string, unknown>>()),
  sweepGamePictures: sweep,
}));

/** An engine, since the button is disabled without one. */
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engines/105", dataDir: "/data" },
  }),
}));

import { GamePicturesControl } from "./GamePicturesControl";

const REPORT: PictureSweepReport = {
  found: 2,
  games: [
    {
      game: "Balanced Annihilation",
      shortname: "ba",
      units: 379,
      wanted: 300,
      covered: 16,
      written: 80,
    },
    {
      game: "Evolution RTS",
      shortname: "ee",
      units: 200,
      wanted: 0,
      covered: 0,
      written: 0,
    },
  ],
  skipped: [],
  failed: [],
  errors: [],
};

beforeEach(() => {
  sweep.mockReset();
  sweep.mockResolvedValue(REPORT);
});

afterEach(cleanup);

const press = async () => {
  fireEvent.click(screen.getByRole("button"));
  // The click starts a promise, so let it settle before reading the screen.
  await vi.waitFor(() => expect(sweep).toHaveBeenCalled());
};

it("offers nothing until sending pictures has been agreed to", () => {
  render(<GamePicturesControl hubUrl="https://hub.example" agreed={false} />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("offers a button once it has", () => {
  render(<GamePicturesControl hubUrl="https://hub.example" agreed />);
  expect(
    screen.getByRole("button", { name: /send pictures of your games/i }),
  ).toBeTruthy();
});

/**
 * The two things somebody would otherwise find out by waiting: that a big game
 * takes several goes, and that pressing it again carries on rather than starting
 * over.
 */
it("says a game takes several goes and that pressing again carries on", () => {
  render(<GamePicturesControl hubUrl="https://hub.example" agreed />);
  const words = document.body.textContent ?? "";
  expect(words).toContain("several goes");
  expect(words).toContain("picks up where it stopped");
});

it("runs the sweep against the hub it was given", async () => {
  render(<GamePicturesControl hubUrl="https://hub.example" agreed />);
  await press();

  expect(sweep.mock.calls[0][0]).toMatchObject({
    hubUrl: "https://hub.example",
    enginePath: "/engines/105",
  });
});

/**
 * The count per game, which is the thing the issue asks for. Somebody looking at
 * this page could not previously find out that the hub had nothing at all for a
 * game they had installed.
 */
it("says what the hub is still missing, per game", async () => {
  render(<GamePicturesControl hubUrl="https://hub.example" agreed />);
  await press();

  await screen.findByText(/Balanced Annihilation: sent 16 of them/);
  expect(document.body.textContent).toContain("284 units still waiting");
  // And a game with nothing left says so rather than being left off.
  expect(document.body.textContent).toContain(
    "Evolution RTS: the hub has all 200 units",
  );
});

it("says how far along it is while it runs", async () => {
  const reporters: ((progress: PictureSweepProgress) => void)[] = [];
  sweep.mockImplementation(
    (_target, onProgress) =>
      new Promise(() => {
        reporters.push(onProgress);
      }),
  );
  render(<GamePicturesControl hubUrl="https://hub.example" agreed />);
  fireEvent.click(screen.getByRole("button"));

  await vi.waitFor(() => expect(reporters).toHaveLength(1));
  reporters[0]({ phase: "filling", done: 1, total: 3, game: "Evolution RTS" });

  await screen.findByText("Drawing 2 of 3: Evolution RTS");
  // And the button says it is going, so nobody presses it twice.
  expect(screen.getByRole("button").textContent).toContain(
    "Drawing your units",
  );
});

/**
 * Whether this has ever happened, which is the other half of the invisibility
 * the issue is about. Somebody who agreed months ago and saw nothing since has
 * no way to tell a feature that never ran from one that ran and found nothing.
 */
it("says when it last ran", async () => {
  localStorage.setItem(LAST_SWEPT_KEY, String(Date.UTC(2026, 7, 23, 9, 30)));
  render(<GamePicturesControl hubUrl="https://hub.example" agreed />);

  expect(document.body.textContent).toContain("Last run");
});

it("says nothing about a last run on a machine that has never had one", () => {
  localStorage.removeItem(LAST_SWEPT_KEY);
  render(<GamePicturesControl hubUrl="https://hub.example" agreed />);

  expect(document.body.textContent).not.toContain("Last run");
});

it("says so when the sweep falls over rather than looking finished", async () => {
  sweep.mockRejectedValue(new Error("the hub is asleep"));
  render(<GamePicturesControl hubUrl="https://hub.example" agreed />);
  await press();

  await screen.findByText("the hub is asleep");
});
