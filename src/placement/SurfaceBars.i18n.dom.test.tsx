// @vitest-environment happy-dom
/**
 * Issue #4603: the surface's undo and redo buttons and the build order bar
 * come out of the Lingui catalog. The catalog here is a fixture, not a real
 * translation. It renames a few strings so a translated one can be told from
 * the English source.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryControls, PlaybackBar } from "./SurfaceBars";

function fixtureCatalog() {
  return {
    [msg`Undo`.id]: "Fixture undo",
    [msg`Redo`.id]: "Fixture redo",
    [msg`Back a step`.id]: "Fixture back",
    [msg`Done`.id]: "Fixture done",
  };
}

function renderBars() {
  render(
    <I18nProvider i18n={i18n}>
      <HistoryControls
        canUndo={false}
        canRedo={false}
        undo={vi.fn()}
        redo={vi.fn()}
      />
      <PlaybackBar
        step={1}
        total={3}
        def="armsolar"
        playing={false}
        onStep={vi.fn()}
        onPlaying={vi.fn()}
        onDone={vi.fn()}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the surface bars' text", () => {
  it("shows the fixture catalog's labels", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    renderBars();
    expect(screen.getByRole("button", { name: "Fixture undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fixture redo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fixture back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fixture done" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    renderBars();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("follows a language change while mounted", async () => {
    renderBars();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
    await act(async () => {
      i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    });
    expect(screen.getByRole("button", { name: "Fixture redo" })).toBeTruthy();
  });
});
