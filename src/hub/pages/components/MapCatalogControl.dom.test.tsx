// @vitest-environment happy-dom

/**
 * Issue #3147: the button used to sit at zero with no bar for as long as the
 * sweep's first pass took, then jump straight to "all done". This checks that
 * a progress sample reaching the control while the sweep is still running is
 * shown as a real bar and a phase-worded count, not just at the end.
 *
 * The sweep itself is stubbed. `../../maps/catalogSweep.test.ts` covers what it
 * does. This covers what the control shows while it is doing it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SweepProgress, SweepReport } from "../../maps/catalogSweep";

const sweep = vi.hoisted(() =>
  vi.fn<
    (
      target: unknown,
      onProgress: (progress: SweepProgress) => void,
    ) => Promise<SweepReport>
  >(),
);
vi.mock("../../maps/catalogSweep", async (real) => ({
  ...(await real<Record<string, unknown>>()),
  sweepMapCatalog: sweep,
}));

/** An engine, since the button is disabled without one. */
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engines/105", dataDir: "/data" },
  }),
}));

import { MapCatalogControl } from "./MapCatalogControl";

const REPORT: SweepReport = {
  read: 134,
  asked: 134,
  wanted: 134,
  sent: 134,
  refused: 0,
  problems: [],
  skipped: [],
  errors: [],
};

beforeEach(() => {
  sweep.mockReset();
});

afterEach(cleanup);

it("offers nothing until sending has been agreed to", () => {
  render(<MapCatalogControl hubUrl="https://hub.example" agreed={false} />);
  expect(screen.queryByRole("button")).toBeNull();
});

/**
 * The whole point of the fix: a sample that arrives mid-run, well before the
 * sweep resolves, has to reach the screen as a moving bar rather than nothing
 * appearing until the promise settles.
 */
it("shows a real bar and count while the sweep is still running", async () => {
  let reportProgress: (progress: SweepProgress) => void = () => {};
  sweep.mockImplementation(
    (_target, onProgress) =>
      new Promise((resolve) => {
        reportProgress = onProgress;
        // Never resolves in this test: the point is what is on screen mid-run.
        void resolve;
      }),
  );
  render(<MapCatalogControl hubUrl="https://hub.example" agreed />);

  fireEvent.click(
    screen.getByRole("button", { name: /send what your maps say/i }),
  );
  await vi.waitFor(() => expect(sweep).toHaveBeenCalled());

  reportProgress({ phase: "reading", done: 67, total: 134 });

  await screen.findByText("Read 67 of 134");
  const bar = screen.getByRole("progressbar", {
    name: "Reading and sending your maps",
  });
  // `components/ui/progress.tsx` positions the indicator itself rather than
  // through Radix's own `aria-valuenow`, so the fill's width is what a real
  // sample moved.
  const indicator = bar.querySelector('[data-slot="progress-indicator"]');
  expect(indicator?.getAttribute("style")).toContain("translateX(-50%)");
});

it("clears the bar once the sweep finishes", async () => {
  sweep.mockResolvedValue(REPORT);
  render(<MapCatalogControl hubUrl="https://hub.example" agreed />);

  fireEvent.click(
    screen.getByRole("button", { name: /send what your maps say/i }),
  );
  await screen.findByText(/Sent facts for 134 maps/);

  expect(screen.queryByRole("progressbar")).toBeNull();
});
