// @vitest-environment happy-dom

/**
 * What a person can find out about a background upload that failed (issue #1703).
 *
 * `./uploadOutcomes.test.ts` covers the wording and the aggregation with the
 * notification path mocked out. This drives the other half: a backfill nobody
 * asked for, through the real `recordQuietly()`, into the real history store and
 * the real notifications bell, and then reads the hub's words off the screen.
 * Nothing between the refused picture and the rendered sentence is stubbed,
 * because every part of that path is what the issue says is missing.
 *
 * The toast host is mounted alongside, so the same run proves the other half of
 * the split: it is readable in the bell and it is nowhere on screen until
 * somebody opens the bell.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { clearHistory, readHistory } from "@/notify/history";
import NotificationsBell from "@/notify/NotificationsBell";
import { type AssetOutcome, reportAssetUploadOutcomes } from "./uploadOutcomes";

/** The hub's own words for a refusal, as its `checkAssetImage` produced them. */
function notSquare(unit: string): AssetOutcome {
  return {
    result: "refused",
    status: 400,
    said: `The hub at coilbox.example refused bar's ${unit} buildpic: A "buildpic" must be square, and that one is 256x128.`,
    verdict: "terminal",
  };
}

beforeEach(() => {
  clearHistory();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The bell and the toast host, mounted the way the app mounts them. */
function mountApp() {
  render(
    <PersistentStoreProvider storage={memoryStorage()}>
      <ThemeProvider>
        <MemoryRouter>
          <NotificationsBell />
          <Toaster />
        </MemoryRouter>
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
}

function openTheBell() {
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
}

describe("a backfill nobody asked for that the hub refused", () => {
  it("is readable in the bell, in the hub's own words", () => {
    mountApp();
    reportAssetUploadOutcomes([notSquare("armsolar")], "coilbox");

    openTheBell();

    expect(screen.getByText("The hub would not take a picture")).toBeTruthy();
    expect(
      screen.getByText(
        'The hub at coilbox.example refused bar\'s armsolar buildpic: A "buildpic" must be square, and that one is 256x128. Coilbox will not send it again: the same bytes get the same answer.',
      ),
    ).toBeTruthy();
  });

  /** The half #1690 settled: nobody asked for the run, so nothing is put in
   *  front of anybody while it is going on. */
  it("puts nothing on screen until somebody opens the bell", () => {
    mountApp();
    reportAssetUploadOutcomes([notSquare("armsolar")], "coilbox");

    expect(screen.queryByText("The hub would not take a picture")).toBeNull();

    openTheBell();

    expect(screen.getByText("The hub would not take a picture")).toBeTruthy();
  });

  /** A badge is a call to look now, which is the interruption in a quieter
   *  form. The entry waits instead. */
  it("does not light the unread badge", () => {
    mountApp();
    reportAssetUploadOutcomes([notSquare("armsolar")], "coilbox");

    expect(readHistory().unread).toBe(0);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /unread/ })).toBeNull();
  });

  /** Three hundred rejections are one problem, and the bell holds fifty
   *  entries. A run that narrated itself would push everything else out. */
  it("leaves one entry for a run of forty rejections", () => {
    mountApp();
    reportAssetUploadOutcomes(
      Array.from({ length: 40 }, (_, n) => notSquare(`u${n}`)),
      "coilbox",
    );

    openTheBell();

    expect(readHistory().entries).toHaveLength(1);
    expect(screen.getByText("The hub would not take 40 pictures")).toBeTruthy();
  });

  /**
   * The bell clipped every body to one line, which is fine for "Download
   * finished" and loses everything after about the fortieth character of a
   * sentence naming a picture and what was wrong with it.
   *
   * Asserted on the class rather than on what is visible, because happy-dom
   * does no layout and clipped text is present in the DOM either way. This is
   * the one part of the issue no test can see, so it is also the part the
   * screenshot in the pull request is for.
   */
  it("does not clip the hub's sentence to one line", () => {
    mountApp();
    reportAssetUploadOutcomes([notSquare("armsolar")], "coilbox");

    openTheBell();

    const body = screen.getByText(/must be square/);
    expect(body.className).not.toContain("truncate");
    expect(body.className).toContain("break-words");
  });

  /** A run somebody started keeps the toast it had, and is not filed twice. */
  it("still shows a run a person started", async () => {
    mountApp();
    reportAssetUploadOutcomes([notSquare("armsolar")], "user");

    expect(
      await screen.findByText("The hub would not take a picture"),
    ).toBeTruthy();
    expect(readHistory().entries).toHaveLength(1);
    expect(readHistory().unread).toBe(1);
  });
});
