// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyText } from "./pluginText";

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

const { LocalisedAppFrame } = await import("./LocalisedAppFrame");

// Issue #4600: a plugin's nav labels and settings titles are recorded with
// `lazyText` when its module loads and translated when the frame renders. The
// catalog is a fixture that renames two strings so a translated label can be
// told from the English source.
let mounts = 0;
function CountingProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    mounts++;
  }, []);
  return children;
}

const plugin: FramePlugin = {
  id: "test",
  version: "0.0.0",
  routes: [{ path: "maps", lazy: async () => ({ default: () => null }) }],
  nav: [
    {
      id: "test",
      items: [{ id: "test.maps", label: lazyText(msg`Maps`), to: "/maps" }],
    },
  ],
  settings: [{ id: "test.section", title: lazyText(msg`Map sources`) }],
  Provider: CountingProvider,
};

const fixtureCatalog = () => ({
  [msg`Maps`.id]: "Cartes",
  [msg`Map sources`.id]: "Sources des cartes",
});

function renderFrame() {
  window.location.hash = "#/settings/test.section";
  render(
    <I18nProvider i18n={i18n}>
      <LocalisedAppFrame plugins={[plugin]} title="Test" />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  mounts = 0;
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("plugin nav labels and settings titles", () => {
  it("are English in the module, so code reading them sees the source", () => {
    expect(plugin.nav?.[0].items[0].label).toBe("Maps");
  });

  it("show the fixture catalog's translation in the sidebar", async () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    renderFrame();
    expect(await screen.findByRole("link", { name: "Cartes" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Maps" })).toBeNull();
    expect(await screen.findAllByText("Sources des cartes")).not.toHaveLength(
      0,
    );
  });

  it("follow a language change without remounting a plugin's provider", async () => {
    renderFrame();
    await screen.findByRole("link", { name: "Maps" });
    await act(async () => {
      i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    });
    expect(await screen.findByRole("link", { name: "Cartes" })).toBeTruthy();
    expect(mounts).toBe(1);
  });
});
