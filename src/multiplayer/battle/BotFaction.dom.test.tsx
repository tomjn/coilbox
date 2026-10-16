// @vitest-environment happy-dom

/**
 * A bot's faction is the host's to choose (#4217): on the Add AI row before the
 * bot joins, and on the bot's own row afterwards. Only TASServer carries a
 * bot's side, so a server-assigned room keeps it read-only.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BattleMembersTable } from "./BattleMembersTable";
import type { MemberRow as Row } from "./config";

vi.mock("../store", () => ({
  useConnection: () => null,
}));

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, initial: unknown) => [initial, () => {}],
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// The Radix select needs pointer APIs happy-dom lacks, so a native select
// stands in and lets the test choose an option.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    disabled,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel ?? options.map((o) => o.label).join("/")}
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const sides = [{ name: "Armada" }, { name: "Cortex" }];

function row(overrides: Partial<Row> & { name: string }): Row {
  return {
    kind: "human",
    self: false,
    host: false,
    boss: false,
    ready: true,
    sync: 1,
    spectator: false,
    teamId: 0,
    ally: 0,
    side: 0,
    colorHex: "#336699",
    handicap: 0,
    ...overrides,
  };
}

function setup(opts: { serverAssignsSeat: boolean }) {
  const updateBot = vi.fn();
  const onAddBot = vi.fn();
  render(
    <BattleMembersTable
      serverKey={null}
      rows={[
        row({ name: "Me", self: true, host: true }),
        row({ name: "Bot1", kind: "bot", owner: "Me", teamId: 1, ally: 1 }),
      ]}
      sides={sides as never}
      maxSlots={8}
      selfHost
      serverAssignsSeat={opts.serverAssignsSeat}
      canKick
      canBoss
      canAddBot
      canSetBotAlly
      hostControls={{
        forceTeam: vi.fn(),
        forceAlly: vi.fn(),
        forceColor: vi.fn(),
        forceSpectator: vi.fn(),
        kick: vi.fn(),
        ring: vi.fn(),
        appointBoss: vi.fn(),
        unboss: vi.fn(),
        removeBot: vi.fn(),
        updateBot,
        changeBotAi: vi.fn(),
      }}
      addableAis={[{ shortName: "BARb", kind: "native" }]}
      addableAisReady
      onAddBot={onAddBot}
      onSide={vi.fn()}
      onTeam={vi.fn()}
      onAlly={vi.fn()}
      onColor={vi.fn()}
    />,
  );
  return { updateBot, onAddBot };
}

const factionSelects = () =>
  screen
    .queryAllByRole("combobox")
    .filter((el) => el.getAttribute("aria-label") === "Armada/Cortex");

// The bot's own row has an AI picker with the same options, so the Add AI one
// is the one outside a table row.
const addAiSelect = () => {
  const found = screen
    .getAllByLabelText("BARb")
    .find((el) => !el.closest("tr"));
  if (!found) throw new Error("no Add AI select");
  return found;
};

afterEach(cleanup);

describe("a bot's faction (#4217)", () => {
  it("lets the host set it on a bot row, sending the side to updateBot", () => {
    const { updateBot } = setup({ serverAssignsSeat: false });
    const botRow = screen.getByText("Bot1").closest("tr");
    if (!botRow) throw new Error("no Bot1 row");
    const select = within(botRow)
      .getAllByRole("combobox")
      .find((el) => el.getAttribute("aria-label") === "Armada/Cortex");
    if (!select) throw new Error("no faction select on the bot row");
    fireEvent.change(select, { target: { value: "1" } });
    expect(updateBot).toHaveBeenCalledWith("Bot1", { side: 1 });
  });

  it("adds an AI on the faction picked beside the AI type", () => {
    const { onAddBot } = setup({ serverAssignsSeat: false });
    fireEvent.change(screen.getByLabelText("Faction for the new AI"), {
      target: { value: "1" },
    });
    fireEvent.change(addAiSelect(), {
      target: { value: "BARb" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAddBot).toHaveBeenCalledWith("BARb", 1);
  });

  it("adds an AI on the first faction when none is picked", () => {
    const { onAddBot } = setup({ serverAssignsSeat: false });
    fireEvent.change(addAiSelect(), {
      target: { value: "BARb" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAddBot).toHaveBeenCalledWith("BARb", 0);
  });

  it("stays read-only where the server assigns the seat", () => {
    setup({ serverAssignsSeat: true });
    expect(factionSelects()).toHaveLength(0);
    expect(screen.queryByLabelText("Faction for the new AI")).toBeNull();
    expect(screen.getAllByText("Armada").length).toBeGreaterThan(0);
  });
});
