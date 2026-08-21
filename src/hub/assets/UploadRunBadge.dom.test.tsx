// @vitest-environment happy-dom

/**
 * What somebody sees while a backfill is going, and what pressing the button
 * does (issue #1686).
 *
 * `./runningUploads.test.ts` covers the store and `./blueprintBackfill.test.ts`
 * proves a stop stops the work. This is the half in between: the real component,
 * driven by the real store, so the words on screen and the reach of the button
 * are asserted rather than assumed.
 *
 * happy-dom does no layout, so nothing here can say the pill is legible or that
 * it fits the topbar. That is what the screenshot on the pull request is for.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What `hub_upload_cancel` was handed, so the button can be shown to reach the
 *  plugin rather than only the store. */
const cancelled: unknown[] = [];
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      if (command === "hub_upload_cancel") cancelled.push(args);
      return {};
    },
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((sample: unknown) => void) | null = null;
  },
}));

import {
  forgetRunningUploads,
  hideUploadRun,
  showUploadRun,
  updateUploadRun,
} from "./runningUploads";
import UploadRunBadge from "./UploadRunBadge";

beforeEach(() => {
  forgetRunningUploads();
  cancelled.length = 0;
});

afterEach(() => {
  cleanup();
});

/** Open the pill, which is where the detail and the button live. */
function open() {
  fireEvent.click(screen.getByRole("button", { name: /pictures/i }));
}

describe("the topbar while a backfill is going", () => {
  /** The ordinary case takes no room at all. */
  it("is not there when nothing is running", () => {
    const { container } = render(<UploadRunBadge />);
    expect(container.innerHTML).toBe("");
  });

  it("appears when a run puts itself on screen", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    expect(screen.getByText("Making pictures")).toBeTruthy();
  });

  it("goes when the run ends", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    act(() => hideUploadRun("op-1"));
    expect(screen.queryByText("Making pictures")).toBeNull();
  });

  it("says which half of the run is going", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    act(() => updateUploadRun("op-1", { phase: "sending", total: 24 }));
    expect(screen.getByText("Sending pictures")).toBeTruthy();
  });

  /** A run with nothing to draw arrives in the sending half rather than passing
   *  through the drawing one, so it must not read as making anything (issue
   *  #1768). */
  it("appears in the sending half for a run that had nothing to draw", () => {
    render(<UploadRunBadge />);
    act(() =>
      showUploadRun({ opId: "op-1", game: "bar", phase: "sending", total: 12 }),
    );
    expect(screen.getByText("Sending pictures")).toBeTruthy();
    expect(screen.queryByText("Making pictures")).toBeNull();
  });
});

describe("what the pill says when it is opened", () => {
  it("names the game and says nothing has gone yet while it is drawing", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    open();

    expect(
      screen.getByText(
        "Coilbox is making pictures of bar's units. Nothing has been sent yet.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("0 of 12 made")).toBeTruthy();
  });

  it("counts what has gone once it is sending", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    act(() =>
      updateUploadRun("op-1", {
        phase: "sending",
        done: 5,
        total: 24,
        sent: 4,
      }),
    );
    open();

    expect(
      screen.getByText("Coilbox is sending bar's pictures to the hub."),
    ).toBeTruthy();
    expect(screen.getByText("5 of 24 sent")).toBeTruthy();
  });

  /**
   * Said before the button is pressed rather than after it. Somebody deciding
   * whether to stop is the person who needs to know a stop is not an undo.
   */
  it("warns that what has gone stays on the hub, before the button is pressed", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    act(() => updateUploadRun("op-1", { phase: "sending", sent: 3 }));
    open();

    expect(
      screen.getByText(
        "3 pictures have already gone, and they stay on the hub.",
      ),
    ).toBeTruthy();
  });

  it("says it in the singular for one picture", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    act(() => updateUploadRun("op-1", { phase: "sending", sent: 1 }));
    open();

    expect(
      screen.getByText(
        "One picture has already gone, and it stays on the hub.",
      ),
    ).toBeTruthy();
  });

  it("says nothing about the hub keeping anything until something has gone", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    open();

    expect(screen.queryByText(/stays on the hub/)).toBeNull();
  });

  /** Two blueprints opened one after the other. Each keeps its own button. */
  it("gives every run its own button", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    act(() => showUploadRun({ opId: "op-2", game: "sf", total: 3 }));
    open();

    expect(
      screen.getAllByRole("button", { name: "Stop sending pictures" }),
    ).toHaveLength(2);
  });
});

describe("the stop button", () => {
  it("says what pressing it will do", () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    open();

    expect(
      screen.getByRole("button", { name: "Stop sending pictures" }),
    ).toBeTruthy();
  });

  it("reaches the plugin with the run's own id", async () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    open();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Stop sending pictures" }),
      );
    });

    expect(cancelled).toEqual([{ opId: "op-1" }]);
  });

  /** The run reads the flag between pictures, so there is a moment where it has
   *  been asked and has not stopped. Saying so beats a button that looks unpressed. */
  it("says it is stopping, and will not take a second press", async () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    open();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Stop sending pictures" }),
      );
    });

    const button = screen.getByRole("button", { name: "Stopping…" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("stops the run it belongs to and no other", async () => {
    render(<UploadRunBadge />);
    act(() => showUploadRun({ opId: "op-1", game: "bar", total: 12 }));
    act(() => showUploadRun({ opId: "op-2", game: "sf", total: 3 }));
    open();
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Stop sending pictures" })[1],
      );
    });

    expect(cancelled).toEqual([{ opId: "op-2" }]);
    expect(
      screen.getAllByRole("button", { name: "Stop sending pictures" }),
    ).toHaveLength(1);
  });
});
