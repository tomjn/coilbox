import { describe, expect, it } from "vitest";
import {
  type AutoDownloadInputs,
  shouldAutoStartDownload,
} from "./autoDownload";

/** All guards satisfied — the one state in which auto-download should fire. */
const ready = (over: Partial<AutoDownloadInputs> = {}): AutoDownloadInputs => ({
  enabled: true,
  contentMissing: true,
  writeRootReady: true,
  queueIdle: true,
  inFlight: false,
  alreadyAttempted: false,
  ...over,
});

describe("shouldAutoStartDownload", () => {
  it("fires when every guard holds", () => {
    expect(shouldAutoStartDownload(ready())).toBe(true);
  });

  it("does not fire when the opt-out toggle is off", () => {
    expect(shouldAutoStartDownload(ready({ enabled: false }))).toBe(false);
  });

  it("does not fire when the content is already present", () => {
    expect(shouldAutoStartDownload(ready({ contentMissing: false }))).toBe(
      false,
    );
  });

  it("does not fire without a write root", () => {
    expect(shouldAutoStartDownload(ready({ writeRootReady: false }))).toBe(
      false,
    );
  });

  it("does not fire while the download queue is busy", () => {
    expect(shouldAutoStartDownload(ready({ queueIdle: false }))).toBe(false);
  });

  it("does not fire while a download for this content is in flight", () => {
    expect(shouldAutoStartDownload(ready({ inFlight: true }))).toBe(false);
  });

  it("does not fire again once already auto-started (no duplicate)", () => {
    expect(shouldAutoStartDownload(ready({ alreadyAttempted: true }))).toBe(
      false,
    );
  });
});
