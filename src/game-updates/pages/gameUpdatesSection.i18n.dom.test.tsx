// @vitest-environment happy-dom

/**
 * Issue #4601: the game-updates settings section's words come out of the Lingui
 * catalog. The catalog here is a fixture that renames two strings, so a
 * translated word can be told from the English source.
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../GameUpdatesProvider", () => ({
  useGameUpdates: () => ({
    repo: "example/game",
    release: { tag: "v2", name: "Release 2", body: "", assets: [] },
    checking: false,
    error: null,
    updateAvailable: false,
    installing: false,
    installed: false,
    profileUpdated: false,
    currentFile: null,
    download: null,
    runCheck: async () => {},
    install: async () => {},
    restart: async () => {},
  }),
}));
vi.mock("../../downloads/config", () => ({
  useWriteRoot: () => ({ path: "/games", loading: false }),
}));

import GameUpdatesSection from "./GameUpdatesSection";

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

function draw() {
  render(
    <I18nProvider i18n={i18n}>
      <GameUpdatesSection />
    </I18nProvider>,
  );
}

describe("the game-updates section's text", () => {
  it("shows the fixture catalog's translations", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: {
        [msg`Update source`.id]: "Source des mises a jour",
        [msg`Check for updates`.id]: "Verifier les mises a jour",
      },
    });
    draw();
    expect(screen.getByText("Source des mises a jour")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Verifier les mises a jour" }),
    ).toBeTruthy();
    expect(screen.queryByText("Update source")).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    draw();
    expect(screen.getByText("Update source")).toBeTruthy();
  });
});
