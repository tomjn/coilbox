// @vitest-environment happy-dom
/**
 * Issue #4602: the hub share menu's labels come out of the Lingui catalog. The
 * catalog here is a fixture, not a real translation. It renames three strings
 * so a translated one can be told from the English source, and hub content
 * (the hub address) stays as given.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { DrawerHost, DrawerProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../../profile/hidden", () => ({
  isProfileHidden: vi.fn(() => false),
}));

vi.mock("./ShareAssetsPanel", () => ({
  ShareAssetsPanel: ({ hubUrl }: { hubUrl: string }) => (
    <p>Sharing panel for {hubUrl}</p>
  ),
}));

import { ShareMenu } from "./ShareMenu";

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

it("shows the fixture catalog's labels and a drawer title beside the verbatim hub address", async () => {
  i18n.loadAndActivate({
    locale: "fr",
    messages: {
      [msg`Share`.id]: "Fixture share",
      [msg`Share a pack`.id]: "Fixture share a pack",
      [msg`Share your maps and games`.id]: "Fixture share maps and games",
    },
  });
  render(
    <I18nProvider i18n={i18n}>
      <DrawerProvider>
        <ShareMenu hubUrl="https://hub.example" />
        <DrawerHost />
      </DrawerProvider>
    </I18nProvider>,
  );

  fireEvent.pointerDown(screen.getByRole("button", { name: "Fixture share" }), {
    button: 0,
  });
  expect(
    screen.getByRole("menuitem", { name: "Fixture share a pack" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Fixture share maps and games" }),
  );
  expect(
    await screen.findByText("Sharing panel for https://hub.example"),
  ).toBeTruthy();
});
