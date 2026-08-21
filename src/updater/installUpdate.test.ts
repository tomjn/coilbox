import { beforeEach, describe, expect, it, vi } from "vitest";

/** Everything the install did, in the order it did it. */
const steps: string[] = [];
/** Set to make the `prepare_for_update` command refuse. */
const refuses: { reason: string | null } = { reason: null };

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: async () => "1.2.3",
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    steps.push(command);
    if (refuses.reason) throw new Error(refuses.reason);
  },
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: async () => {},
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: async () => null,
}));

import type { Update } from "@tauri-apps/plugin-updater";
import { type DownloadPhase, installUpdate } from "./updater";

/** An update that records its calls and reports one 40 byte chunk. */
function update(): Update {
  return {
    download: async (onEvent?: (progress: unknown) => void) => {
      steps.push("download");
      onEvent?.({ event: "Started", data: { contentLength: 40 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      onEvent?.({ event: "Finished" });
    },
    install: async () => {
      steps.push("install");
    },
  } as unknown as Update;
}

describe("installing a downloaded update", () => {
  beforeEach(() => {
    steps.length = 0;
    refuses.reason = null;
  });

  it("frees the installer from the job object between download and install", async () => {
    await installUpdate(update(), () => {});

    expect(steps).toEqual(["download", "prepare_for_update", "install"]);
  });

  it("hands the installer nothing to do when the job object will not let go", async () => {
    refuses.reason = "could not let the installer leave the job object: nope";

    await expect(installUpdate(update(), () => {})).rejects.toThrow(
      /leave the job object/,
    );
    expect(steps).not.toContain("install");
  });

  it("still counts the bytes as they arrive", async () => {
    const seen: DownloadPhase[] = [];

    await installUpdate(update(), (phase) => seen.push(phase));

    expect(seen).toEqual([
      { status: "downloading", downloaded: 0, total: 40 },
      { status: "downloading", downloaded: 40, total: 40 },
      { status: "installing" },
    ]);
  });
});
