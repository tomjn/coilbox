// @vitest-environment happy-dom

/**
 * The control a person actually presses (issue #2379).
 *
 * `../../maps/pictureSweep.test.ts` covers what a sweep does. This covers the
 * half the issue is really about: that there is a button at all, that it is not
 * offered until sending pictures has been agreed to, and that pressing it starts
 * a run rather than looking like it did.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  LAST_MAP_SWEPT_KEY,
  type MapPictureSweepProgress,
  type MapPictureSweepReport,
} from "../../maps/pictureSweep";

const sweep = vi.hoisted(() =>
  vi.fn<
    (
      target: unknown,
      onProgress: (progress: MapPictureSweepProgress) => void,
    ) => Promise<MapPictureSweepReport>
  >(),
);
vi.mock("../../maps/pictureSweep", async (real) => ({
  ...(await real<Record<string, unknown>>()),
  sweepMapPictures: sweep,
}));

/** An engine, since the button is disabled without one. */
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engines/105", dataDir: "/data" },
  }),
}));

import { MapPicturesControl } from "./MapPicturesControl";

const REPORT: MapPictureSweepReport = {
  read: 103,
  wanted: 90,
  sent: 80,
  left: 10,
  skipped: [],
  errors: [],
};

beforeEach(() => {
  sweep.mockReset();
  sweep.mockResolvedValue(REPORT);
  localStorage.clear();
});

afterEach(cleanup);

const press = async () => {
  fireEvent.click(screen.getByRole("button"));
  // The click starts a promise, so let it settle before reading the screen.
  await vi.waitFor(() => expect(sweep).toHaveBeenCalled());
};

/**
 * The consent gate. This uploads somebody's content to a shared server, so the
 * button is not there at all until the switch above it is on. The Rust side
 * checks the same thing off disk and would refuse either way.
 */
it("offers nothing until sending pictures has been agreed to", () => {
  render(<MapPicturesControl hubUrl="https://hub.example" agreed={false} />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("offers a button once it has", () => {
  render(<MapPicturesControl hubUrl="https://hub.example" agreed />);
  expect(
    screen.getByRole("button", { name: /send pictures of your maps/i }),
  ).toBeTruthy();
});

/**
 * The two things somebody would otherwise find out by waiting: that a big
 * collection takes several goes, and that pressing it again carries on rather
 * than starting over.
 */
it("says a collection takes several goes and that pressing again carries on", () => {
  render(<MapPicturesControl hubUrl="https://hub.example" agreed />);
  const words = document.body.textContent ?? "";
  expect(words).toContain("several goes");
  expect(words).toContain("picks up where it stopped");
});

it("runs the sweep against the hub it was given", async () => {
  render(<MapPicturesControl hubUrl="https://hub.example" agreed />);
  await press();

  expect(sweep.mock.calls[0][0]).toMatchObject({
    hubUrl: "https://hub.example",
    enginePath: "/engines/105",
  });
});

it("says how many maps are still waiting, so pressing again has a reason", async () => {
  render(<MapPicturesControl hubUrl="https://hub.example" agreed />);
  await press();

  await screen.findByText(/10 more maps are still waiting/);
});

it("says how far along it is while it runs", async () => {
  const reporters: ((progress: MapPictureSweepProgress) => void)[] = [];
  sweep.mockImplementation(
    (_target, onProgress) =>
      new Promise(() => {
        reporters.push(onProgress);
      }),
  );
  render(<MapPicturesControl hubUrl="https://hub.example" agreed />);
  fireEvent.click(screen.getByRole("button"));

  await vi.waitFor(() => expect(reporters).toHaveLength(1));
  reporters[0]({ phase: "sending", done: 4, total: 12 });

  await screen.findByText("Sending 4 of 12");
  // And the button says it is going, so nobody presses it twice.
  expect(screen.getByRole("button").textContent).toContain("Reading your maps");
});

/** Whether this has ever happened. Somebody who agreed months ago and saw
 *  nothing since has no way to tell a feature that never ran from one that ran
 *  and found nothing. */
it("says when it last ran", () => {
  localStorage.setItem(
    LAST_MAP_SWEPT_KEY,
    String(Date.UTC(2026, 7, 23, 9, 30)),
  );
  render(<MapPicturesControl hubUrl="https://hub.example" agreed />);

  expect(document.body.textContent).toContain("Last run");
});

it("says nothing about a last run on a machine that has never had one", () => {
  render(<MapPicturesControl hubUrl="https://hub.example" agreed />);
  expect(document.body.textContent).not.toContain("Last run");
});

it("says so when the sweep falls over rather than looking finished", async () => {
  sweep.mockRejectedValue(new Error("the hub is asleep"));
  render(<MapPicturesControl hubUrl="https://hub.example" agreed />);
  await press();

  await screen.findByText("the hub is asleep");
});
