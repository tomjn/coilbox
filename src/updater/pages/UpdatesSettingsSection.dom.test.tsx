// @vitest-environment happy-dom

/**
 * Issue #3144: an update available is the action worth taking, so its card
 * should read as the primary call to action, with "Check for updates" as a
 * plain secondary button beside it.
 *
 * `import.meta.env.DEV` hides this page's controls entirely in a dev build
 * (see `inertReason` in the component under test), so there is no way to
 * drive this on screen under `bun tauri dev`. This test is the verification
 * for that reason.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadQueueProvider } from "../../downloads/DownloadQueueProvider";
import { UpdaterProvider } from "../UpdaterProvider";
import UpdatesSettingsSection from "./UpdatesSettingsSection";

function fakeUpdate() {
  return { version: "1.2.3", body: "", download: vi.fn(), install: vi.fn() };
}

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.2.2" }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: async () => {} }));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: async () => fakeUpdate(),
}));
vi.mock("../../notify/notify", () => ({ notify: async () => {} }));
vi.mock("../../profile/profile", () => ({ isUpdaterEnabled: () => true }));

// `inertReason` in the component under test hides every control in a dev
// build, which vitest itself is, so it is overridden the same way the
// component would see it running as a real release build.
import.meta.env.DEV = false;

function renderSection() {
  return render(
    <DownloadQueueProvider>
      <UpdaterProvider>
        <UpdatesSettingsSection />
      </UpdaterProvider>
    </DownloadQueueProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UpdatesSettingsSection", () => {
  it("gives the update card the primary style and the check button a secondary one", async () => {
    // A release build checks for an update on mount (`UpdaterProvider`), so
    // the update is already found by the time this renders.
    await act(async () => {
      renderSection();
    });

    const heading = await screen.findByText("Version 1.2.3 available");
    const card = heading.closest("div.rounded-lg");
    expect(card?.className).toContain("border-primary");
    expect(card?.className).toContain("bg-primary/5");

    const checkButton = screen.getByText("Check for updates").closest("button");
    expect(checkButton?.className).not.toContain("bg-primary");

    const installButton = screen
      .getByText("Download & install")
      .closest("button");
    expect(installButton?.className).toContain("bg-primary");
  });
});
