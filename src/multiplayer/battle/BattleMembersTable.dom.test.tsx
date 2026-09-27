// @vitest-environment happy-dom

/**
 * The battle room player table's Windows Feedback fixes (milestone 60):
 * the host crown moved after the country flag (#3192), the "Player"
 * subtitle dropped for ordinary rows (#3196), zebra striping on alternating
 * rows (#3191), rank/note/bonus moved into their own columns (#3190), and
 * spectators pulled out of the table into a compact list (#3194).
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BattleMembersTable } from "./BattleMembersTable";
import type { MemberRow as Row } from "./config";

vi.mock("../store", () => ({
  useConnection: () => null,
}));

// The real Radix popover only draws its content once open, which needs
// positioning APIs happy-dom does not implement. Always-open stand-in,
// matching StaffSection.dom.test.tsx.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

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

const noopHostControls = {
  forceTeam: vi.fn(),
  forceAlly: vi.fn(),
  forceColor: vi.fn(),
  forceSpectator: vi.fn(),
  kick: vi.fn(),
  appointBoss: vi.fn(),
  unboss: vi.fn(),
  removeBot: vi.fn(),
  updateBot: vi.fn(),
  changeBotAi: vi.fn(),
};

function renderTable(
  rows: Row[],
  overrides?: {
    noteFor?: (row: Row) => string;
    onSetNote?: (row: Row, text: string) => void;
    statsSummaryFor?: (row: Row) => string | null;
  },
) {
  return render(
    <BattleMembersTable
      serverKey={null}
      rows={rows}
      sides={[]}
      maxSlots={8}
      selfHost
      serverAssignsSeat={false}
      canKick
      canBoss
      canAddBot={false}
      canSetBotAlly={false}
      hostControls={noopHostControls}
      addableAis={[]}
      addableAisReady
      onAddBot={vi.fn()}
      onSide={vi.fn()}
      onTeam={vi.fn()}
      onAlly={vi.fn()}
      onColor={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("subtitle (#3196)", () => {
  it("drops the subtitle for an ordinary player", () => {
    renderTable([
      row({ name: "Me", self: true, host: true }),
      row({ name: "Bob" }),
    ]);
    // The "Player" column header text is the only surviving occurrence. The
    // per-row subtitle that used to say it for every ordinary row is gone.
    expect(screen.getAllByText("Player")).toHaveLength(1);
  });

  it("still shows the host subtitle", () => {
    renderTable([
      row({ name: "Me", self: true, host: true }),
      row({ name: "Bob" }),
    ]);
    expect(screen.getByText("Host")).toBeTruthy();
  });
});

describe("crown after flag (#3192)", () => {
  it("draws the crown after the country flag in the name cell", () => {
    renderTable([
      row({ name: "Me", self: true, host: true, country: "gb" }),
      row({ name: "Bob" }),
    ]);
    const flag = screen.getByRole("img", { name: /Country: GB/i });
    const crown = document.querySelector("svg.lucide-crown");
    expect(crown).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING (4): flag comes before crown in the DOM.
    // biome-ignore lint/style/noNonNullAssertion: asserted not-null above
    expect(flag.compareDocumentPosition(crown!) & 4).toBe(4);
  });
});

describe("zebra striping (#3191)", () => {
  it("tints every other player row", () => {
    renderTable([
      row({ name: "Me", self: true, host: true }),
      row({ name: "Bob" }),
      row({ name: "Carol" }),
    ]);
    const rows = screen
      .getAllByRole("row")
      .filter((r) => within(r).queryByText(/^(Me|Bob|Carol)$/) != null);
    expect(rows).toHaveLength(3);
    expect(rows[0].className).not.toContain("bg-muted/30");
    expect(rows[1].className).toContain("bg-muted/30");
    expect(rows[2].className).not.toContain("bg-muted/30");
  });
});

describe("rank/note/bonus columns (#3190)", () => {
  it("gives the rank column its own header and cell", () => {
    renderTable([
      row({ name: "Me", self: true, host: true }),
      row({ name: "Bob", rank: 3 }),
    ]);
    // Header: icon-only with an accessible name via sr-only text.
    expect(screen.getByText("Rank")).toBeTruthy();
    // Cell: the rank badge's accessible name.
    expect(screen.getByRole("img", { name: "Rank 3 of 7" })).toBeTruthy();
  });

  it("leaves the rank cell empty when a row has no rank", () => {
    renderTable([
      row({ name: "Me", self: true, host: true }),
      row({ name: "Bob" }),
    ]);
    expect(screen.queryByRole("img", { name: /Rank \d of 7/ })).toBeNull();
  });
});

describe("spectators in a compact list (#3194)", () => {
  it("keeps a spectator out of the player table's rows", () => {
    renderTable([
      row({ name: "Me", self: true, host: true }),
      row({ name: "Bob" }),
      row({ name: "Carol", spectator: true }),
    ]);
    const tableRows = screen
      .getAllByRole("row")
      .filter((r) => within(r).queryByText("Carol") != null);
    expect(tableRows).toHaveLength(0);
  });

  it("lists the spectator by name below the table", () => {
    renderTable([
      row({ name: "Me", self: true, host: true }),
      row({ name: "Carol", spectator: true, rank: 5 }),
    ]);
    expect(screen.getByText("Spectating")).toBeTruthy();
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Rank 5 of 7" })).toBeTruthy();
  });

  it("still offers the host row menu on a spectator", () => {
    renderTable([
      row({ name: "Me", self: true, host: true }),
      row({ name: "Carol", spectator: true }),
    ]);
    expect(
      screen.getByRole("button", { name: "Actions for Carol" }),
    ).toBeTruthy();
  });

  it("still offers the private note button on a spectator", () => {
    renderTable(
      [
        row({ name: "Me", self: true, host: true }),
        row({ name: "Carol", spectator: true }),
      ],
      { noteFor: () => "", onSetNote: vi.fn() },
    );
    expect(
      screen.getByRole("button", { name: "Add note for Carol" }),
    ).toBeTruthy();
  });
});
