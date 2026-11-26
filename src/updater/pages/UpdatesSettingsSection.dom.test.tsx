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

import { I18nProvider } from "@lingui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueueProvider } from "../../downloads/DownloadQueueProvider";
import { i18n, loadLocale } from "../../i18n";
import { messages as enMessages } from "../../locales/en/messages.po";
import { UpdaterProvider } from "../UpdaterProvider";
import UpdatesSettingsSection from "./UpdatesSettingsSection";

function fakeUpdate() {
  return { version: "1.2.3", body: "", download: vi.fn(), install: vi.fn() };
}

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.2.2" }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: async () => {} }));
const { check, notify } = vi.hoisted(() => ({
  check: vi.fn(),
  notify: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("../../notify/notify", () => ({ notify }));
vi.mock("../../profile/profile", () => ({ isUpdaterEnabled: () => true }));

// `inertReason` in the component under test hides every control in a dev
// build, which vitest itself is, so it is overridden the same way the
// component would see it running as a real release build.
import.meta.env.DEV = false;

function renderSection() {
  return render(
    <I18nProvider i18n={i18n}>
      <DownloadQueueProvider>
        <UpdaterProvider>
          <UpdatesSettingsSection />
        </UpdaterProvider>
      </DownloadQueueProvider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  check.mockImplementation(async () => fakeUpdate());
  await loadLocale("en");
});

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
    const card = heading.closest("section");
    expect(card?.className).toContain("border-primary");
    expect(card?.className).toContain("bg-primary/5");

    const checkButton = screen.getByText("Check now").closest("button");
    expect(checkButton?.className).not.toContain("bg-primary");

    const installButton = screen
      .getByText("Download & install")
      .closest("button");
    expect(installButton?.className).toContain("bg-primary");
  });

  // Issue #4590: the section's strings come from the active catalog.
  it("shows the English source text under the en catalog", async () => {
    await act(async () => {
      renderSection();
    });

    expect(await screen.findByText("Check for updates")).toBeTruthy();
    expect(screen.getByText("Version")).toBeTruthy();
  });

  it("shows a translated string from a fixture catalog", async () => {
    // The en catalog with one message translated. Message IDs are hashes of
    // the English text, so the ID is looked up rather than written out. A
    // compiled message with no placeholders is a one-element array.
    const checkId = Object.keys(enMessages).find(
      (id) => enMessages[id]?.[0] === "Check for updates",
    );
    if (!checkId) throw new Error("en catalog has no 'Check for updates'");
    i18n.loadAndActivate({
      locale: "fr",
      messages: { ...enMessages, [checkId]: ["Rechercher des mises à jour"] },
    });

    await act(async () => {
      renderSection();
    });

    expect(await screen.findByText("Rechercher des mises à jour")).toBeTruthy();
    expect(screen.queryByText("Check for updates")).toBeNull();
    // Untranslated messages still show their English source.
    expect(screen.getByText("Version")).toBeTruthy();
  });

  it("does not say up to date when a later check fails", async () => {
    check.mockResolvedValueOnce(null);
    await act(async () => {
      renderSection();
    });
    expect(await screen.findByText(/^Up to date\./)).toBeTruthy();

    check.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      fireEvent.click(screen.getByText("Check now"));
    });

    expect(screen.getByRole("alert").textContent).toContain("network down");
    expect(screen.queryByText(/^Up to date\./)).toBeNull();
  });

  it("notifies about a version once, however often the player checks", async () => {
    await act(async () => {
      renderSection();
    });
    await screen.findByText("Version 1.2.3 available");
    await act(async () => {
      fireEvent.click(screen.getByText("Check now"));
    });

    expect(check).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
