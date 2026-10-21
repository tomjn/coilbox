// @vitest-environment happy-dom
/**
 * Issue #4604: the conquest setup's text comes out of the Lingui catalog. The
 * catalog here is a fixture, not a real translation. It renames a few strings
 * so a translated one can be told from the English source.
 */
import { i18n } from "@lingui/core";
import { msg, select } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sizeOptions } from "../../unlocks";
import { ThreatLevelSelect } from "./ThreatLevelSelect";

const n = 0;
const many = "systems";

function fixtureCatalog() {
  return {
    [msg`Threat level`.id]: "Fixture threat level",
    [msg`Level ${n}`.id]: "Fixture level {n}",
    // The id of a select message, built the way `sizeOptions` builds it.
    [msg`${select(many, {
      systems: "Small (12 systems)",
      locations: "Small (12 locations)",
      cities: "Small (12 cities)",
      provinces: "Small (12 provinces)",
      other: `Small (12 ${many})`,
    })}`.id]:
      "{many, select, provinces {Fixture 12 provinces} other {Fixture 12 {many}}}",
  };
}

function renderSelect() {
  render(
    <I18nProvider i18n={i18n}>
      <ThreatLevelSelect value={0} ceiling={0} onChange={() => {}} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the conquest setup's text", () => {
  it("shows the fixture catalog's threat level control", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    renderSelect();
    expect(screen.getByText("Fixture threat level")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Fixture level 0/ })).toBeTruthy();
    expect(screen.queryByText("Threat level")).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    renderSelect();
    expect(screen.getByText("Threat level")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Level 0/ })).toBeTruthy();
  });

  it("follows a language change while mounted", async () => {
    renderSelect();
    expect(screen.getByText("Threat level")).toBeTruthy();
    await act(async () => {
      i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    });
    expect(screen.getByText("Fixture threat level")).toBeTruthy();
  });

  it("words a size by the map style's own noun", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    expect(sizeOptions(0, "provinces")[0].label).toBe("Fixture 12 provinces");
    expect(sizeOptions(0, "cities")[0].label).toBe("Fixture 12 cities");
  });
});
