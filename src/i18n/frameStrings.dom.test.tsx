// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The frame listens for the OS mouse-nav buttons over Tauri's event bridge, which
// is not there under vitest.
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

const { LocalisedAppFrame } = await import("./LocalisedAppFrame");

// Issue #4606: the words picoframe draws itself come out of the Lingui catalog.
// The catalog here is a fixture, not a real translation: it renames three
// strings so the test can tell a translated word from the English default.
const plugin: FramePlugin = { id: "test", version: "0.0.0", routes: [] };

function fixtureCatalog() {
  return {
    [msg`Appearance`.id]: "Aspect",
    [msg`Settings`.id]: "Reglages",
    [msg`Home`.id]: "Accueil",
  };
}

async function openSettings() {
  window.location.hash = "#/settings/frame.appearance";
  render(
    <I18nProvider i18n={i18n}>
      <LocalisedAppFrame plugins={[plugin]} title="Test" />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

beforeEach(() => {
  localStorage.clear();
});

describe("the frame's own text", () => {
  it("shows the fixture catalog's Appearance title on the Settings page", async () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    await openSettings();
    expect(await screen.findAllByText("Aspect")).not.toHaveLength(0);
    expect(screen.queryByText("Appearance")).toBeNull();
  });

  it("stays in English when the catalog has no translation", async () => {
    await openSettings();
    expect(await screen.findAllByText("Appearance")).not.toHaveLength(0);
  });

  it("follows a language change while mounted", async () => {
    await openSettings();
    await screen.findAllByText("Appearance");
    await act(async () => {
      i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    });
    expect(await screen.findAllByText("Aspect")).not.toHaveLength(0);
  });
});
