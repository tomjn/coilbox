// @vitest-environment happy-dom
/**
 * Issue #4604: a scenario document goes through the editor under a fixture
 * catalog and the author's words come out unchanged. The catalog is a fixture,
 * not a real translation. It renames the editor's own labels, and it also
 * translates two strings that are identical to author text in the document, so
 * a line the editor ran through `t` by mistake would change.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { starterScenario } from "../../create";
import { parseScenarioJson, type Scenario } from "../../model";
import { DialoguePanel } from "./DialoguePanel";
import { ObjectivePanel } from "./ObjectivePanel";

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

// Each of these is also an English message the editor shows, so the catalog
// below has a translation for it.
const SPEAKER = "Dialogue";
const OBJECTIVE_TEXT = "Delete";
const LINE_TEXT = "  Contact!\tRaiders – café “inbound”.\n  ";

function document(): Scenario {
  const base = starterScenario("Demo");
  return {
    ...base,
    dialogue: [{ id: "opening", speaker: SPEAKER, text: "Move out." }],
    objectives: [
      { id: "hold", kind: "primary", text: OBJECTIVE_TEXT, hidden: false },
    ],
  };
}

function Editor({ onDocument }: { onDocument: (s: Scenario) => void }) {
  const [scenario, setScenario] = useState(document);
  const change = (next: Scenario) => {
    setScenario(next);
    onDocument(next);
  };
  return (
    <I18nProvider i18n={i18n}>
      <DialoguePanel
        scenario={scenario}
        onChange={change}
        onUndo={() => {}}
        issues={[]}
      />
      <ObjectivePanel
        scenario={scenario}
        onChange={change}
        onUndo={() => {}}
        focus={null}
        issues={[]}
      />
    </I18nProvider>
  );
}

describe("a scenario document edited under a fixture catalog", () => {
  it("keeps the author's text byte for byte while the labels translate", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: {
        [msg`Dialogue`.id]: "Fixture dialogue",
        [msg`Objectives`.id]: "Fixture objectifs",
        [msg`Delete`.id]: "Fixture supprimer",
        [msg`What is said`.id]: "Fixture parole",
        [msg`Objective text`.id]: "Fixture texte",
      },
    });
    let latest = document();
    render(<Editor onDocument={(s) => (latest = s)} />);

    fireEvent.click(screen.getByRole("button", { name: /^Fixture dialogue/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Fixture objectifs/ }));
    const words = screen.getByLabelText("Fixture parole");
    expect(screen.getByLabelText("Fixture texte")).toBeTruthy();

    // The editor wrote what was typed, whitespace and all.
    fireEvent.change(words, { target: { value: LINE_TEXT } });
    fireEvent.blur(words);
    expect(latest.dialogue[0].text).toBe(LINE_TEXT);

    // Editing one thing leaves the author's other words as they were, even
    // where they equal an English message the catalog translates.
    const objectiveText = screen.getByLabelText("Fixture texte");
    fireEvent.change(objectiveText, { target: { value: OBJECTIVE_TEXT } });
    fireEvent.blur(objectiveText);
    expect(latest.dialogue[0].speaker).toBe(SPEAKER);
    expect(latest.objectives[0].text).toBe(OBJECTIVE_TEXT);

    // The speaker field shows the author's word, not the catalog's.
    const dialoguePanel = screen.getByRole("button", {
      name: /^Fixture dialogue/,
    }).parentElement;
    expect(
      within(dialoguePanel as HTMLElement).getAllByDisplayValue(SPEAKER).length,
    ).toBeGreaterThan(0);

    // And the document survives being saved and loaded again.
    const again = parseScenarioJson(JSON.stringify(latest));
    expect(again?.dialogue[0].text).toBe(LINE_TEXT);
    expect(again?.dialogue[0].speaker).toBe(SPEAKER);
    expect(again?.objectives[0].text).toBe(OBJECTIVE_TEXT);
  });
});
