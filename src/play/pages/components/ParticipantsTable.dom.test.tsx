// @vitest-environment happy-dom

/**
 * The skirmish participants table lets you give each AI a resource bonus, and
 * every AI the same one at once. The human row has no such control.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BonusSuggestions } from "../../aiBonusSuggestion";
import type { Participant } from "../../config";
import { bumpAiHandicap } from "../../debrief";
import { ParticipantsTable } from "./ParticipantsTable";

// The real Radix popover only draws its content once open, which needs
// positioning APIs happy-dom does not implement. Always-open stand-in, as in
// BattleMembersTable.dom.test.tsx.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div data-popover>{children}</div>
  ),
}));

// Radix's slider needs layout APIs happy-dom lacks, so a range input stands in.
vi.mock("@/components/ui/slider", () => ({
  Slider: ({
    value,
    onValueChange,
    ...rest
  }: {
    value: number[];
    onValueChange: (v: number[]) => void;
    "aria-label": string;
  }) => (
    <input
      type="range"
      aria-label={rest["aria-label"]}
      value={value[0]}
      onChange={(e) => onValueChange([Number(e.target.value)])}
    />
  ),
}));

afterEach(cleanup);

const you: Participant = {
  id: "you",
  kind: "you",
  name: "You",
  side: "",
  color: [0.9, 0.24, 0.2],
  allyTeam: 0,
  spectator: false,
};

const bot = (
  id: string,
  overrides: Partial<Participant> = {},
): Participant => ({
  id,
  kind: "ai",
  name: id,
  ai: { kind: "native", shortName: "BARb", name: "BARb" },
  side: "",
  color: [0.31, 0.55, 1],
  allyTeam: 1,
  spectator: false,
  ...overrides,
});

function renderTable(
  participants: Participant[],
  props: {
    disabled?: boolean;
    onSetAiBonus?: (id: string, percent: number) => void;
    onSetAllAiBonus?: (percent: number) => void;
    bonusSuggestions?: BonusSuggestions;
  } = {},
) {
  const onSetAiBonus = props.onSetAiBonus ?? vi.fn();
  const onSetAllAiBonus = props.onSetAllAiBonus ?? vi.fn();
  render(
    <MemoryRouter>
      <ParticipantsTable
        participants={participants}
        sides={[]}
        ais={[]}
        disabled={props.disabled}
        startPosType={1}
        onUpdate={vi.fn()}
        onSetTeam={vi.fn()}
        onRemove={vi.fn()}
        onAddAi={vi.fn()}
        onSetAiBonus={onSetAiBonus}
        onSetAllAiBonus={onSetAllAiBonus}
        bonusSuggestions={props.bonusSuggestions}
      />
    </MemoryRouter>,
  );
  return { onSetAiBonus, onSetAllAiBonus };
}

/** Move a bonus slider to `to` and press its confirm button. */
function send(sliderLabel: string, to: number, action: string) {
  const slider = screen.getByLabelText(sliderLabel);
  fireEvent.change(slider, { target: { value: String(to) } });
  const popover = slider.closest("[data-popover]") as HTMLElement;
  fireEvent.click(within(popover).getByRole("button", { name: action }));
}

describe("bonus control on an AI row", () => {
  it("is offered for each AI and never for the human", () => {
    renderTable([you, bot("Bot A"), bot("Bot B")]);
    expect(
      screen.getByRole("button", { name: "Set a resource bonus for Bot A" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Set a resource bonus for Bot B" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/resource bonus for You/)).toBeNull();
  });

  it("shows the bonus an AI already has", () => {
    renderTable([you, bot("Bot A", { handicap: 30 })]);
    expect(
      screen.getByRole("button", {
        name: "Edit resource bonus for Bot A, currently 30%",
      }),
    ).toBeTruthy();
  });

  it("shows what Rematch with a tweak just set", () => {
    renderTable(bumpAiHandicap([you, bot("Bot A")], 25));
    expect(
      screen.getByRole("button", {
        name: "Edit resource bonus for Bot A, currently 25%",
      }),
    ).toBeTruthy();
  });

  it("reports the chosen percentage for that AI only", () => {
    const { onSetAiBonus, onSetAllAiBonus } = renderTable([
      you,
      bot("Bot A"),
      bot("Bot B"),
    ]);
    send("Resource bonus for Bot B", 45, "Set");
    expect(onSetAiBonus).toHaveBeenCalledWith("Bot B", 45);
    expect(onSetAllAiBonus).not.toHaveBeenCalled();
  });

  it("is left off an AI that shares the human's team, since the team takes its bonus from its first member", () => {
    renderTable([{ ...you, team: 0 }, bot("Bot A", { team: 0 })]);
    expect(screen.queryByLabelText(/resource bonus for Bot A/i)).toBeNull();
  });

  it("is disabled while a game is running", () => {
    renderTable([you, bot("Bot A")], { disabled: true });
    const trigger = screen.getByRole("button", {
      name: "Set a resource bonus for Bot A",
    }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});

describe("bonus for every AI", () => {
  it("applies one percentage to all AIs at once", () => {
    const { onSetAllAiBonus, onSetAiBonus } = renderTable([
      you,
      bot("Bot A"),
      bot("Bot B"),
    ]);
    send("Resource bonus for every AI", 60, "Set all");
    expect(onSetAllAiBonus).toHaveBeenCalledWith(60);
    expect(onSetAiBonus).not.toHaveBeenCalled();
  });

  it("shows the shared value when every AI has the same bonus", () => {
    renderTable([
      you,
      bot("Bot A", { handicap: 25 }),
      bot("Bot B", { handicap: 25 }),
    ]);
    expect(
      screen.getByRole("button", {
        name: "Edit resource bonus for every AI, currently 25%",
      }),
    ).toBeTruthy();
  });

  it("shows no value when the AIs differ", () => {
    renderTable([
      you,
      bot("Bot A", { handicap: 25 }),
      bot("Bot B", { handicap: 50 }),
    ]);
    expect(
      screen.getByRole("button", {
        name: "Set a resource bonus for every AI",
      }),
    ).toBeTruthy();
  });

  it("is not offered with a single AI, whose own control does the job", () => {
    renderTable([you, bot("Bot A")]);
    expect(screen.queryByLabelText(/for every AI/)).toBeNull();
  });
});

describe("suggested bonus", () => {
  const suggestion = {
    percent: 20,
    from: 10,
    result: "win" as const,
    filename: "a game.sdfz",
  };

  it("shows where it came from, links the replay and applies on click", () => {
    const { onSetAiBonus } = renderTable([you, bot("Bot A")], {
      bonusSuggestions: { rows: { "Bot A": suggestion }, all: null },
    });
    expect(
      screen.getByText(
        "You won your last game against BARb at +10%. Try +20%?",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "See that game" }).getAttribute("href"),
    ).toBe("/play/replays/a%20game.sdfz");

    // Showing it changes nothing. Only the button does.
    expect(onSetAiBonus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use +20%" }));
    expect(onSetAiBonus).toHaveBeenCalledWith("Bot A", 20);
  });

  it("words a loss and a suggestion of no bonus", () => {
    renderTable([you, bot("Bot A")], {
      bonusSuggestions: {
        rows: {
          "Bot A": { ...suggestion, result: "loss", from: 10, percent: 0 },
        },
        all: null,
      },
    });
    expect(
      screen.getByText(
        "You lost your last game against BARb at +10%. Try no bonus?",
      ),
    ).toBeTruthy();
  });

  it("shows the footer suggestion once and applies it to every AI", () => {
    const { onSetAllAiBonus, onSetAiBonus } = renderTable(
      [you, bot("Bot A"), bot("Bot B", { team: 5 })],
      { bonusSuggestions: { rows: {}, all: suggestion } },
    );
    expect(screen.getAllByText(/Try \+20%\?/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Use +20%" }));
    expect(onSetAllAiBonus).toHaveBeenCalledWith(20);
    expect(onSetAiBonus).not.toHaveBeenCalled();
  });

  it("shows nothing when there is no suggestion", () => {
    renderTable([you, bot("Bot A")], {
      bonusSuggestions: { rows: {}, all: null },
    });
    expect(screen.queryByText(/your last game/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
  });

  it("is disabled while a game is running", () => {
    renderTable([you, bot("Bot A")], {
      disabled: true,
      bonusSuggestions: { rows: { "Bot A": suggestion }, all: null },
    });
    const apply = screen.getByRole("button", {
      name: "Use +20%",
    }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });
});
