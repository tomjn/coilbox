// @vitest-environment happy-dom

/**
 * Issue #4601: the downloads table's words come out of the Lingui catalog. The
 * catalog here is a fixture that renames three strings, so a translated word can
 * be told from the English source.
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityRows } from "../activityRows";
import { DOWNLOADING, FAILED, HISTORY, QUEUED } from "../fixtures/activity";
import { DownloadsActivity } from "./ActivityPage";

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: vi.fn(), close: () => {}, isOpen: false }),
}));
vi.mock("../bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
}));
vi.mock("../warmEngineCache", () => ({ installEngine: vi.fn() }));
vi.mock("../downloadGame", () => ({ downloadGameAnySource: vi.fn() }));
vi.mock("../downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../../content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
vi.mock("../../content/config", () => ({
  forgetScans: vi.fn(),
  invalidateScans: vi.fn(),
  rescanMounted: vi.fn(),
}));
vi.mock("../../content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));

const rows = activityRows({
  items: [QUEUED, DOWNLOADING],
  settled: [FAILED],
  history: HISTORY,
});

function draw() {
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <DownloadsActivity
          rows={rows}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
          onLog={vi.fn()}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the downloads table's text", () => {
  it("shows the fixture catalog's translations", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: {
        [msg`Remove from queue`.id]: "Retirer de la file",
        [msg`Try next mirror`.id]: "Essayer le miroir suivant",
        [msg`Progress`.id]: "Avancement",
      },
    });
    draw();
    const queued = screen.getByText("Isis").closest("tr");
    if (!queued) throw new Error("no row for Isis");
    expect(
      within(queued).getByRole("button", { name: "Retirer de la file" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Essayer le miroir suivant" }),
    ).toBeTruthy();
    expect(screen.getByText("Avancement")).toBeTruthy();
    expect(screen.queryByText("Remove from queue")).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    draw();
    expect(screen.getByText("Progress")).toBeTruthy();
  });
});
