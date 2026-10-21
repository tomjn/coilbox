// @vitest-environment happy-dom

/**
 * Issue #4601: the export form's words come out of the Lingui catalog. The
 * catalog here is a fixture that renames two strings, so a translated word can
 * be told from the English source.
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: { games: [], maps: [] },
    error: null,
    loading: false,
  }),
}));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({ target: {} }),
}));
vi.mock("../../../play/presets", () => ({
  useSkirmishPresets: () => ({ presets: [] }),
}));
vi.mock("../../../blueprint/store", () => ({
  useBlueprintLibrary: () => ({ records: [] }),
}));

import { ExportPackForm } from "./ExportPackForm";

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

function draw() {
  render(
    <I18nProvider i18n={i18n}>
      <ExportPackForm />
    </I18nProvider>,
  );
}

describe("the export form's text", () => {
  it("shows the fixture catalog's translations", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: {
        [msg`Create pack code`.id]: "Creer le code du pack",
        [msg`No games installed for this engine.`.id]:
          "Aucun jeu installe pour ce moteur.",
      },
    });
    draw();
    expect(
      screen.getByRole("button", { name: "Creer le code du pack" }),
    ).toBeTruthy();
    expect(screen.getByText("Aucun jeu installe pour ce moteur.")).toBeTruthy();
    expect(
      screen.queryByText("No games installed for this engine."),
    ).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    draw();
    expect(
      screen.getByText("No games installed for this engine."),
    ).toBeTruthy();
  });
});
