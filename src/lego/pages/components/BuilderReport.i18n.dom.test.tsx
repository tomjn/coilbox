// @vitest-environment happy-dom
/**
 * Issue #4603: the builder report's sentence and link come out of the Lingui
 * catalog. The catalog here is a fixture, not a real translation. It renames
 * two strings so a translated one can be told from the English source.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newProject } from "../../model";
import { BuilderReport } from "./BuilderReport";

vi.mock("./useTestGame", () => ({
  useTestGame: () => ({
    target: { enginePath: "/e", dataDir: "/d" },
    scan: { data: { games: [] } },
  }),
}));
vi.mock("../../../workshop/config", () => ({
  useUnitDefs: () => ({
    defs: null,
    defsFor: null,
    status: "idle",
    error: null,
  }),
}));
vi.mock("../../../workshop/project", () => ({
  useModProjects: () => ({ projects: [] }),
}));

function fixtureCatalog() {
  const reason = "";
  return {
    [msg`Static builder, because ${reason}.`.id]: "Fixture static: {reason}",
  };
}

function renderReport() {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <BuilderReport
          project={{
            ...base,
            pieces: [{ ...base.pieces[0], role: "buildarm.arm" }],
          }}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the builder report's text", () => {
  it("shows the fixture catalog's sentence with the reason filled in", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    renderReport();
    expect(
      screen.getByText("Fixture static: it has no movement class"),
    ).toBeTruthy();
  });

  it("shows the English source under en", () => {
    renderReport();
    expect(
      screen.getByText("Static builder, because it has no movement class."),
    ).toBeTruthy();
  });
});
