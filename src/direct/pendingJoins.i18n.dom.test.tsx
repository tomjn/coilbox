// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PendingJoinsPanel } from "./PendingJoins";

// The catalog here is a fixture, not a real translation. It renames two
// strings so the test can tell a translated string from the English default.
const name = "bob";
const fixtureCatalog = {
  [msg`Approve ${name}`.id]: "Fixture approve {name}",
  [msg`Reject ${name}`.id]: "Fixture reject {name}",
};

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

function renderPanel() {
  render(
    <I18nProvider i18n={i18n}>
      <PendingJoinsPanel pending={[name]} onAnswer={() => {}} />
    </I18nProvider>,
  );
}

describe("the pending joins panel under a fixture catalog", () => {
  it("shows the fixture text for the buttons, with the name filled in", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog });
    renderPanel();
    expect(screen.getByText("Fixture approve bob")).toBeTruthy();
    expect(screen.getByText("Fixture reject bob")).toBeTruthy();
    expect(screen.queryByText("Approve bob")).toBeNull();
  });

  it("stays in English with no translation", () => {
    renderPanel();
    expect(screen.getByText("Approve bob")).toBeTruthy();
  });
});
