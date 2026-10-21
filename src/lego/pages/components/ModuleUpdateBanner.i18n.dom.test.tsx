// @vitest-environment happy-dom

/**
 * Issue #4603: the module update banner's text comes out of the Lingui
 * catalog. The catalog here is a fixture, not a real translation. It renames
 * one button and gives the part count its own plural forms, so a translated
 * string can be told from the English source and the right form shows for one
 * part and for three.
 */

import { i18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModuleUpdate } from "../../moduleUpdates";
import { ModuleUpdateBanner } from "./ModuleUpdateBanner";

function update(name: string): ModuleUpdate {
  return {
    instance: name,
    moduleId: "wheel",
    moduleName: "Wheel",
    stamp: "s",
    name,
    rootPieceId: name,
    edited: 0,
  };
}

function fixtureCatalog() {
  const count = 0;
  return {
    [msg`Dismiss`.id]: "Fixture dismiss",
    [msg`${plural(count, {
      one: "# part of this unit uses an older module.",
      other: "# parts of this unit use an older module.",
    })}`.id]:
      "{count, plural, one {Fixture: # part is old.} other {Fixture: # parts are old.}}",
  };
}

function renderBanner(updates: ModuleUpdate[]) {
  render(
    <I18nProvider i18n={i18n}>
      <ModuleUpdateBanner
        updates={updates}
        onUpdate={vi.fn()}
        onDismiss={vi.fn()}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the module update banner's text", () => {
  it("shows the fixture catalog's plural form for one part and for three", () => {
    i18n.loadAndActivate({ locale: "en", messages: fixtureCatalog() });
    renderBanner([update("front")]);
    expect(screen.getByText("Fixture: 1 part is old.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Fixture dismiss" }),
    ).toBeTruthy();
    cleanup();
    renderBanner([update("front"), update("back"), update("left")]);
    expect(screen.getByText("Fixture: 3 parts are old.")).toBeTruthy();
  });

  it("stays in English when the catalog has no translation", () => {
    renderBanner([update("front"), update("back"), update("left")]);
    expect(
      screen.getByText("3 parts of this unit use an older module."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("follows a language change while mounted", async () => {
    renderBanner([update("front")]);
    expect(
      screen.getByText("1 part of this unit uses an older module."),
    ).toBeTruthy();
    await act(async () => {
      i18n.loadAndActivate({ locale: "en", messages: fixtureCatalog() });
    });
    expect(screen.getByText("Fixture: 1 part is old.")).toBeTruthy();
  });
});
