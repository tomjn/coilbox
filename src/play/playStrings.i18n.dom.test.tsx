// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SkirmishDraft } from "./drafts";
import { PresetPartsPicker } from "./PresetPartsPicker";
import type { Participant } from "./participants";
import { ALL_PARTS } from "./presetParts";

// Issue #4601: the text on the play pages comes out of the Lingui catalog. The
// catalog here is a fixture, not a real translation. It renames a row label and
// a row summary so a translated string can be told from the English source.
const you: Participant = {
  id: "p0",
  kind: "you",
  name: "You",
  side: "arm",
  color: [0.5, 0.5, 0.5],
  allyTeam: 0,
  spectator: false,
};

const preset: SkirmishDraft = {
  participants: [you],
  gameName: "Preset Game",
  mapName: "Preset Map",
  startPosType: 0,
  startRects: {},
  modOptionValues: {},
  restrictions: undefined,
};

function fixtureCatalog() {
  return {
    [msg`Unit tweaks`.id]: "Fixture tweaks",
    [msg`Fixed map positions`.id]: "Fixture fixed positions",
  };
}

function renderPicker() {
  render(
    <I18nProvider i18n={i18n}>
      <PresetPartsPicker
        preset={preset}
        selection={ALL_PARTS}
        onChange={() => {}}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the play pages' text", () => {
  it("shows the fixture catalog's row label and summary", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    renderPicker();
    expect(screen.getByText("Fixture tweaks")).toBeTruthy();
    expect(screen.getByText("Fixture fixed positions")).toBeTruthy();
    expect(screen.queryByText("Unit tweaks")).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    renderPicker();
    expect(screen.getByText("Unit tweaks")).toBeTruthy();
    expect(screen.getByText("Fixed map positions")).toBeTruthy();
  });

  it("follows a language change while mounted", async () => {
    renderPicker();
    expect(screen.getByText("Unit tweaks")).toBeTruthy();
    await act(async () => {
      i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    });
    expect(screen.getByText("Fixture tweaks")).toBeTruthy();
  });
});
