// @vitest-environment happy-dom

/**
 * Issue #4601: the start-position card's words come out of the Lingui catalog.
 * The catalog here is a fixture that renames two strings, so a translated word
 * can be told from the English source.
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StartPosCard } from "./StartPosCard";

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

function draw() {
  render(
    <I18nProvider i18n={i18n}>
      <StartPosCard value={1} />
    </I18nProvider>,
  );
}

describe("the start-position card's text", () => {
  it("shows the fixture catalog's translations", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: {
        [msg`Start positions`.id]: "Positions de depart",
        [msg`Random`.id]: "Aleatoire",
      },
    });
    draw();
    expect(screen.getByText("Positions de depart")).toBeTruthy();
    expect(screen.getByText("Aleatoire")).toBeTruthy();
    expect(screen.queryByText("Start positions")).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    draw();
    expect(screen.getByText("Start positions")).toBeTruthy();
    expect(screen.getByText("Random")).toBeTruthy();
  });
});
