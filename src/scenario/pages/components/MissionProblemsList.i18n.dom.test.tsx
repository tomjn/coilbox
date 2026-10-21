// @vitest-environment happy-dom
/**
 * Issue #4604: the scenario problems drawer reads its sentences from the Lingui
 * catalog. The catalog is a fixture, not a real translation. It renames the
 * empty-state sentence and the "nothing plays" heading so a translated string
 * can be told from the English source.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { starterScenario } from "../../create";
import type { Scenario } from "../../model";
import { MissionProblemsList } from "./MissionProblemsList";
import { missionProblemsIn } from "./useMissionProblems";

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

function show(scenario: Scenario) {
  render(
    <I18nProvider i18n={i18n}>
      <MissionProblemsList
        problems={missionProblemsIn(scenario)}
        scenario={scenario}
        onActivate={() => {}}
      />
    </I18nProvider>,
  );
}

describe("the scenario problems drawer's text", () => {
  it("shows the fixture catalog's empty-state sentence", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: {
        [msg`Every reference in this mission resolves, and there is nothing in it a player would read as a bug.`
          .id]: "Fixture tout se resout",
      },
    });
    show(starterScenario("Demo"));
    expect(screen.getByText("Fixture tout se resout")).toBeTruthy();
  });

  it("translates a problem's sentence and keeps the author's trigger name", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: { [msg`dialogue line`.id]: "fixture replique" },
    });
    show({ ...starterScenario("Demo"), dialogue: [] });
    const row = screen.getByText(/Command calls in/);
    expect(row.textContent).toContain("fixture replique");
    expect(row.textContent).not.toContain("dialogue line");
  });

  it("stays in English when the catalog has no translation", () => {
    show({ ...starterScenario("Demo"), dialogue: [] });
    expect(
      screen.getByText(
        'Trigger "Command calls in" (briefing), action 1, line: no dialogue line called "briefing"',
      ),
    ).toBeTruthy();
  });
});
