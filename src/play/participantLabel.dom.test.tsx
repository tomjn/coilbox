// @vitest-environment happy-dom

/**
 * Issue #5042: the setup's default names are stored as "You" and "AI 1" in
 * every language, because the name goes into the start script and is matched
 * against replay results. Only what is drawn follows the app language.
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantsTable } from "./pages/components/ParticipantsTable";
import { participantLabel } from "./participantLabel";
import { initialParticipants, makeAiParticipant } from "./participants";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div data-popover>{children}</div>
  ),
}));

vi.mock("@/components/ui/slider", () => ({
  Slider: ({ ...rest }: { "aria-label": string }) => (
    <input type="range" aria-label={rest["aria-label"]} />
  ),
}));

// A fixture catalog, not a real translation.
const fixture = {
  [msg`You`.id]: "Voce",
  [msg`AI`.id]: "IA",
  [msg`{playerName} ally`.id]: "{playerName} aliado",
  [msg`Remove {playerName}`.id]: "Remover {playerName}",
};

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("participantLabel", () => {
  const words = { you: "Voce", ai: "IA" };

  it("calls the you row by the translated word, whatever its stored name", () => {
    expect(participantLabel({ kind: "you", name: "You" }, words)).toBe("Voce");
    expect(participantLabel({ kind: "you", name: "Tom" }, words)).toBe("Voce");
  });

  it("translates the word AI in the setup's own numbering", () => {
    expect(participantLabel({ kind: "ai", name: "AI 1" }, words)).toBe("IA 1");
    expect(participantLabel({ kind: "ai", name: "AI 12" }, words)).toBe(
      "IA 12",
    );
  });

  it("leaves any other AI name as stored", () => {
    expect(participantLabel({ kind: "ai", name: "BARb" }, words)).toBe("BARb");
    expect(participantLabel({ kind: "ai", name: "AI one" }, words)).toBe(
      "AI one",
    );
  });
});

describe("the default participants", () => {
  it("are stored under their English names, in any language", () => {
    i18n.loadAndActivate({ locale: "pt-BR", messages: fixture });
    const [you, ai] = initialParticipants();
    expect(you.name).toBe("You");
    expect(ai.name).toBe("AI 1");
    expect(makeAiParticipant([you, ai]).name).toBe("AI 2");
  });

  it("are labelled in the app language by the participants table", () => {
    i18n.loadAndActivate({ locale: "pt-BR", messages: fixture });
    const participants = initialParticipants();
    render(
      <I18nProvider i18n={i18n}>
        <MemoryRouter>
          <ParticipantsTable
            participants={participants}
            sides={[]}
            ais={[]}
            startPosType={1}
            onUpdate={vi.fn()}
            onSetTeam={vi.fn()}
            onRemove={vi.fn()}
            onAddAi={vi.fn()}
            onClearAis={vi.fn()}
            onSetAiBonus={vi.fn()}
            onSetAllAiBonus={vi.fn()}
          />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByLabelText("Voce aliado")).toBeTruthy();
    expect(screen.getByLabelText("IA 1 aliado")).toBeTruthy();
    expect(screen.getByLabelText("Remover IA 1")).toBeTruthy();
    expect(screen.queryByLabelText("You ally")).toBeNull();
    expect(screen.queryByLabelText("AI 1 ally")).toBeNull();
  });
});
