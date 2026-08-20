import { beforeEach, describe, expect, it, vi } from "vitest";

/** What `hub_upload_cancel` was handed, so a stop can be shown to have reached
 *  the plugin rather than only the button. */
const cancelled: unknown[] = [];
const cancelThrows = { value: null as string | null };

vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      if (command === "hub_upload_cancel") {
        cancelled.push(args);
        if (cancelThrows.value) throw new Error(cancelThrows.value);
      }
      return {};
    },
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((sample: unknown) => void) | null = null;
  },
}));

vi.mock("@/notify/notify", () => ({
  notify: async () => {},
  recordQuietly: () => {},
}));

import {
  forgetRunningUploads,
  hideUploadRun,
  readRunningUploads,
  showUploadRun,
  stopUploadRun,
  updateUploadRun,
  uploadRunSent,
  uploadRunStopping,
} from "./runningUploads";

beforeEach(() => {
  forgetRunningUploads();
  cancelled.length = 0;
  cancelThrows.value = null;
});

describe("what is on screen", () => {
  it("starts with nothing", () => {
    expect(readRunningUploads()).toEqual([]);
  });

  it("shows a run by its game, at nothing done", () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    expect(readRunningUploads()).toEqual([
      {
        opId: "op-1",
        game: "bar",
        phase: "drawing",
        done: 0,
        total: 12,
        sent: 0,
        stopping: false,
      },
    ]);
  });

  it("takes a run off screen when it ends", () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    hideUploadRun("op-1");
    expect(readRunningUploads()).toEqual([]);
  });

  /** Two blueprints opened one after the other, the first still drawing. Each
   *  keeps its own stop button rather than the second hiding the first. */
  it("holds more than one run at a time", () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    showUploadRun({ opId: "op-2", game: "sf", total: 3 });
    expect(readRunningUploads().map((run) => run.game)).toEqual(["bar", "sf"]);
  });

  it("shows one run once, however many times it announces itself", () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    expect(readRunningUploads()).toHaveLength(1);
  });

  it("moves a run on without disturbing the others", () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    showUploadRun({ opId: "op-2", game: "sf", total: 3 });
    updateUploadRun("op-1", { done: 5 });
    expect(readRunningUploads().map((run) => run.done)).toEqual([5, 0]);
  });

  /**
   * The threshold, from the store's side. A run that never announced itself
   * still reports its progress, and every one of those calls has to go nowhere:
   * a run below the threshold appearing halfway through is the noise the
   * threshold exists to avoid.
   */
  it("says nothing about a run that was never shown", () => {
    updateUploadRun("never-shown", { phase: "sending", done: 4 });
    expect(readRunningUploads()).toEqual([]);
  });

  it("gives the same snapshot back until something changes", () => {
    const first = readRunningUploads();
    expect(readRunningUploads()).toBe(first);
    showUploadRun({ opId: "op-1", game: "bar", total: 2 });
    expect(readRunningUploads()).not.toBe(first);
  });
});

describe("stopping a run", () => {
  it("asks the plugin to stop the upload, by the id the run was started with", async () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    await stopUploadRun("op-1");
    expect(cancelled).toEqual([{ opId: "op-1" }]);
  });

  /** The drawing half is where most of the minute goes, and the plugin has no
   *  run to cancel yet. The flag is what the render loop reads. */
  it("raises a flag the run itself can read", async () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    expect(uploadRunStopping("op-1")).toBe(false);
    await stopUploadRun("op-1");
    expect(uploadRunStopping("op-1")).toBe(true);
  });

  /** Both halves, so the button does not have to know which one it is in. */
  it("still stops the run when the plugin will not take the call", async () => {
    cancelThrows.value = "no such command";
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    await stopUploadRun("op-1");
    expect(uploadRunStopping("op-1")).toBe(true);
  });

  it("stops the run it was asked about and no other", async () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    showUploadRun({ opId: "op-2", game: "sf", total: 3 });
    await stopUploadRun("op-2");
    expect(uploadRunStopping("op-1")).toBe(false);
    expect(uploadRunStopping("op-2")).toBe(true);
  });

  it("reads as not stopping once the run has gone", async () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    await stopUploadRun("op-1");
    hideUploadRun("op-1");
    expect(uploadRunStopping("op-1")).toBe(false);
  });
});

describe("what has already gone", () => {
  it("is nothing until the hub has taken one", () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    expect(uploadRunSent("op-1")).toBe(0);
  });

  it("is what the run has got onto the hub", () => {
    showUploadRun({ opId: "op-1", game: "bar", total: 12 });
    updateUploadRun("op-1", { phase: "sending", sent: 3 });
    expect(uploadRunSent("op-1")).toBe(3);
  });
});
