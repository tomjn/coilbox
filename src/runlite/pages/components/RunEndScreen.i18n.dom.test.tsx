// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { generateRun } from "../../generate";
import { RunEndScreen } from "./RunEndScreen";

// The catalog here is a fixture, not a real translation. It renames two
// strings so the test can tell a translated string from the English default.
const fixtureCatalog = {
  [msg`Hull remaining`.id]: "Fixture hull remaining",
  [msg`Warpath complete`.id]: "Fixture warpath complete",
};

const run = generateRun({
  seed: 777,
  length: "standard",
  difficulty: 3,
  ascension: 1,
  game: { shortname: "ba" },
  factionId: "player",
  side: "ARM",
  skin: "galaxy",
  maps: [
    { name: "Small", size: 64 },
    { name: "Medium", size: 256 },
  ],
  now: "2026-07-18T00:00:00.000Z",
});

function renderEnd() {
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <RunEndScreen
          run={{
            ...run,
            progress: { ...run.progress, status: "won", hull: 63 },
          }}
          onClear={() => {}}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the warpath end screen under a fixture catalog", () => {
  it("shows the fixture text for the heading and a stat label", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog });
    renderEnd();
    expect(screen.getByText("Fixture warpath complete")).toBeTruthy();
    expect(
      screen.getByText("Fixture hull remaining").nextSibling?.textContent,
    ).toBe("63");
    expect(screen.queryByText("Hull remaining")).toBeNull();
  });

  it("stays in English with no translation", () => {
    renderEnd();
    expect(screen.getByText("Warpath complete")).toBeTruthy();
  });
});
