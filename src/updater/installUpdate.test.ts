import { beforeEach, describe, expect, it, vi } from "vitest";

/** Everything the install did, in the order it did it. */
const steps: string[] = [];
/** Set to make the `prepare_for_update` command refuse. */
const refuses: { reason: string | null } = { reason: null };
/** Whether the Rust side reports this as a portable Windows install. */
const portable = { yes: false };
/** Progress listeners the portable download registered. */
const listeners: ((event: { payload: unknown }) => void)[] = [];
/** How many of those were torn down again. */
const stopped = { count: 0 };

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: async () => "1.2.3",
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    _name: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    listeners.push(handler);
    return () => {
      stopped.count += 1;
    };
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    // Not a step: this only asks which path to take, and recording it would put
    // a probe in the middle of every ordering assertion below.
    if (command === "portable_update_supported") return portable.yes;

    steps.push(command);
    if (refuses.reason) throw new Error(refuses.reason);
    if (command === "portable_update_stage") {
      for (const handler of listeners) {
        handler({ payload: { downloaded: 0, total: 40 } });
        handler({ payload: { downloaded: 40, total: 40 } });
      }
    }
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
function update(rawJson: Record<string, unknown> = {}): Update {
  return {
    version: "1.2.4",
    rawJson,
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

/** A manifest carrying the portable zip, as the release workflow writes it. */
function manifestWithZip(): Record<string, unknown> {
  return {
    platforms: {
      "windows-x86_64": {
        url: "https://example.test/setup.exe",
        signature: "aaa",
      },
      "windows-x86_64-portable": {
        url: "https://example.test/portable.zip",
        signature: "bbb",
      },
    },
  };
}

beforeEach(() => {
  steps.length = 0;
  listeners.length = 0;
  stopped.count = 0;
  refuses.reason = null;
  portable.yes = false;
});

describe("installing a downloaded update", () => {
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

describe("installing over a portable Windows copy", () => {
  beforeEach(() => {
    portable.yes = true;
  });

  /** The NSIS installer is the whole bug: it would update the machine's other
   *  Coilbox instead of this one. */
  it("never runs the installer", async () => {
    await installUpdate(update(manifestWithZip()), () => {});

    expect(steps).not.toContain("install");
    expect(steps).not.toContain("download");
    expect(steps).not.toContain("prepare_for_update");
  });

  it("stages the signed zip and then hands over", async () => {
    await installUpdate(update(manifestWithZip()), () => {});

    expect(steps).toEqual(["portable_update_stage", "portable_update_finish"]);
  });

  it("reports the same progress the topbar draws for any other download", async () => {
    const seen: DownloadPhase[] = [];

    await installUpdate(update(manifestWithZip()), (phase) => seen.push(phase));

    expect(seen).toEqual([
      { status: "downloading", downloaded: 0, total: 40 },
      { status: "downloading", downloaded: 40, total: 40 },
      { status: "installing" },
    ]);
    expect(stopped.count).toBe(1);
  });

  /** A release built before the workflow produced the zip. Falling back to the
   *  installer here is what would overwrite the machine's ordinary install. */
  it("refuses a release with no portable zip rather than running the installer", async () => {
    const manifest = {
      platforms: { "windows-x86_64": { url: "u", signature: "s" } },
    };

    await expect(installUpdate(update(manifest), () => {})).rejects.toThrow(
      /no portable download/,
    );
    expect(steps).toEqual([]);
  });
});
