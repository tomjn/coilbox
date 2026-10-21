// @vitest-environment happy-dom
/**
 * Issue #4601: the engine row's buttons and badge come out of the Lingui
 * catalog. The catalog here is a fixture, not a real translation. It renames
 * three strings so a translated one can be told from the English source.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "../bindings";
import { EngineRow } from "./components/EngineRow";

const ENGINE = {
  id: "e1",
  version: "2025.04.0",
  platform: "linux64",
  syncVersion: null,
  executable: "/engines/2025.04.0/spring",
  path: "/engines/2025.04.0",
} as unknown as Engine;

function fixtureCatalog() {
  return {
    [msg`Set preferred`.id]: "Fixture set preferred",
    [msg`Verify`.id]: "Fixture verify",
    [msg`Open`.id]: "Fixture open",
  };
}

function renderRow() {
  render(
    <I18nProvider i18n={i18n}>
      <ul>
        <EngineRow
          engine={ENGINE}
          verifying={false}
          isPreferred={false}
          onVerify={vi.fn()}
          onSetPreferred={vi.fn()}
          onOpen={vi.fn()}
        />
      </ul>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the engine row's text", () => {
  it("shows the fixture catalog's button labels", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    renderRow();
    expect(
      screen.getByRole("button", { name: "Fixture set preferred" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fixture verify" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fixture open" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    renderRow();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });

  it("follows a language change while mounted", async () => {
    renderRow();
    expect(screen.getByRole("button", { name: "Verify" })).toBeTruthy();
    await act(async () => {
      i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    });
    expect(screen.getByRole("button", { name: "Fixture verify" })).toBeTruthy();
  });
});
