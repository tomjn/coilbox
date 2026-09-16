// @vitest-environment happy-dom

/**
 * The battle chat's chat-recognised `!map <name>` line (issue #2795), and the
 * `!balance`/`!lock`/`!unlock` host suggestions that read the same way in a
 * direct room (issue #2871): a coilbox player's line produces an ordinary
 * chat message nobody acts on unless the founder's own client recognises it
 * and offers a way to apply it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Battle, ChatMsg } from "../bindings";
import { BattleChatCard } from "./BattleChatCard";
import type { MemberRow } from "./config";
import { hexToI32 } from "./config";

const markSeen = vi.fn();

vi.mock("../store", () => ({
  useMultiplayer: () => ({
    mirror: { state: { myUsername: "Host", users: {} } },
    markSeen,
  }),
}));

let messages: ChatMsg[] = [];
const send = vi.fn();

vi.mock("../chat/useConversation", () => ({
  useConversation: () => ({
    title: "Battle chat",
    messages,
    total: messages.length,
    members: [],
    send,
    maxChars: null,
  }),
}));

// A "ready" checksum, immediately, for whichever map name is asked for - this
// test is about the Accept wiring, not the worker's own async round trip
// (`useMapChangeQueue` already shares BattleMapCard's untouched effect).
vi.mock("@/content/config", () => ({
  useUnitsyncMapInfo: (
    _enginePath: string | undefined,
    _dataDir: string | undefined,
    mapName: string | undefined,
  ) => ({
    info: mapName ? { checksum: "1a2b3c4d" } : null,
    status: mapName ? "ready" : "idle",
  }),
}));

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  useSetting: () => [false, vi.fn()],
}));

afterEach(() => {
  cleanup();
  messages = [];
  send.mockClear();
});

const battle = (): Battle =>
  ({
    id: 9,
    channel: "battle_9",
    members: {},
  }) as unknown as Battle;

const chatLine = (text: string): ChatMsg => ({
  channel: "battle_9",
  from: "Scary le poo",
  text,
  kind: "said",
  at: 1000,
  id: null,
});

function row(name: string, over: Partial<MemberRow> = {}): MemberRow {
  return {
    name,
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
    colorHex: "#ffffff",
    handicap: 0,
    ...over,
  };
}

function renderCard(
  canChangeMap: boolean,
  onChangeMap = vi.fn(),
  overrides: {
    selfHost?: boolean;
    directRoom?: boolean;
    rows?: MemberRow[];
  } = {},
) {
  const forceAlly = vi.fn();
  const forceTeam = vi.fn();
  const onSetBattleStatusBatch = vi.fn();
  const onSetLocked = vi.fn();
  render(
    <BattleChatCard
      battle={battle()}
      enginePath="/engine"
      dataDir="/data"
      maps={[
        { name: "DeltaSiegeDry", archives: [], info: {} },
        { name: "Comet Catcher Remake", archives: [], info: {} },
        { name: "Comet Catcher Redux", archives: [], info: {} },
      ]}
      canChangeMap={canChangeMap}
      onChangeMap={onChangeMap}
      selfHost={overrides.selfHost ?? false}
      directRoom={overrides.directRoom ?? false}
      rows={overrides.rows ?? []}
      hostControls={{ forceAlly, forceTeam }}
      onSetBattleStatusBatch={onSetBattleStatusBatch}
      onSetLocked={onSetLocked}
    />,
  );
  return {
    onChangeMap,
    forceAlly,
    forceTeam,
    onSetBattleStatusBatch,
    onSetLocked,
  };
}

describe("BattleChatCard: !map suggestions", () => {
  it("offers the host an Accept button on an unambiguous suggestion, which applies the map with its checksum", () => {
    messages = [chatLine("!map deltasiege")];
    const { onChangeMap } = renderCard(true);

    const button = screen.getByRole("button", {
      name: /Accept: DeltaSiegeDry/,
    });
    fireEvent.click(button);

    expect(onChangeMap).toHaveBeenCalledWith(
      "DeltaSiegeDry",
      hexToI32("1a2b3c4d"),
    );
  });

  it("lists every match instead of guessing when the name is ambiguous", () => {
    messages = [chatLine("!map comet")];
    renderCard(true);

    expect(
      screen.getByText("Matches: Comet Catcher Remake, Comet Catcher Redux"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  });

  it("says no installed map matches, with no button, when nothing does", () => {
    messages = [chatLine("!map nonexistentmap")];
    renderCard(true);

    expect(
      screen.getByText("No installed map matches “nonexistentmap”."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  });

  it("shows a non-host the plain chat line, with no action at all", () => {
    messages = [chatLine("!map deltasiege")];
    renderCard(false);

    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(screen.queryByText(/DeltaSiegeDry/)).toBeNull();
  });

  it("leaves an ordinary chat line untouched, host or not", () => {
    messages = [chatLine("anyone got a good 1v1 map?")];
    renderCard(true);

    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  });
});

describe("BattleChatCard: !balance/!lock host suggestions", () => {
  // The command line is the baseline that works everywhere, including a
  // real SPADS room and any other lobby client reading the same room. The
  // founder's Accept/Reject is an enhancement coilbox draws on top of it,
  // not instead of it. Concretely: a player learns `!balance` by reading it
  // in chat, so selecting or copying this line, alone or as part of a drag
  // across several lines, has to yield the literal command text, not the
  // caption or the button labels. Checked by asserting the raw text is
  // still an exact, separate node from the caption once the founder's
  // Accept/Reject renders alongside it.
  it("keeps the raw command as its own selectable text even once the founder's Accept/Reject renders alongside it", () => {
    messages = [chatLine("!balance")];
    renderCard(false, vi.fn(), { directRoom: true, selfHost: true });

    const commandNode = screen.getByText("!balance");
    expect(commandNode).toBeTruthy();
    expect(commandNode.closest("button")).toBeNull();
    expect(screen.getByText("Asked to balance the teams.")).toBeTruthy();
  });

  it("leaves the raw command as-is outside a direct room, for a real autohost to read", () => {
    messages = [chatLine("!balance")];
    renderCard(false, vi.fn(), { directRoom: false });

    expect(screen.getByText("!balance")).toBeTruthy();
  });

  it("hides Accept/Reject from a joiner in a direct room, while still showing the plain command", () => {
    messages = [chatLine("!balance")];
    renderCard(false, vi.fn(), { directRoom: true, selfHost: false });

    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reject/ })).toBeNull();
    expect(screen.getByText("!balance")).toBeTruthy();
  });

  it("offers the founder of a direct room Accept/Reject", () => {
    messages = [chatLine("!balance")];
    renderCard(false, vi.fn(), { directRoom: true, selfHost: true });

    expect(
      screen.getByRole("button", { name: /Accept: balance the teams/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeTruthy();
  });

  it("does not offer Accept/Reject outside a direct room, even to the founder", () => {
    messages = [chatLine("!balance")];
    renderCard(false, vi.fn(), { directRoom: false, selfHost: true });

    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  });

  it("accepting a balance suggestion seats the founder locally and everyone else through force calls", () => {
    messages = [chatLine("!balance")];
    const { forceAlly, forceTeam, onSetBattleStatusBatch } = renderCard(
      false,
      vi.fn(),
      {
        directRoom: true,
        selfHost: true,
        rows: [row("Host"), row("Scary le poo")],
      },
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Accept: balance the teams/ }),
    );

    expect(onSetBattleStatusBatch).toHaveBeenCalledWith({
      ally: 0,
      teamId: 0,
    });
    expect(forceAlly).toHaveBeenCalledWith("Scary le poo", 1);
    expect(forceTeam).toHaveBeenCalledWith("Scary le poo", 1);
  });

  it("accepting a lock suggestion locks the room directly", () => {
    messages = [chatLine("!lock")];
    const { onSetLocked } = renderCard(false, vi.fn(), {
      directRoom: true,
      selfHost: true,
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Accept: lock the room/ }),
    );

    expect(onSetLocked).toHaveBeenCalledWith(true);
  });

  it("accepting an unlock suggestion unlocks the room directly", () => {
    messages = [chatLine("!unlock")];
    const { onSetLocked } = renderCard(false, vi.fn(), {
      directRoom: true,
      selfHost: true,
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Accept: unlock the room/ }),
    );

    expect(onSetLocked).toHaveBeenCalledWith(false);
  });

  it("rejecting posts a chat message, which is how the joiner sees they were answered", () => {
    messages = [chatLine("!balance")];
    renderCard(false, vi.fn(), { directRoom: true, selfHost: true });

    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));

    expect(send).toHaveBeenCalledWith("Declined: balance the teams");
  });

  it("offers no suggestion for !fixcolors or !ring, which have no founder-direct equivalent", () => {
    messages = [chatLine("!fixcolors")];
    renderCard(false, vi.fn(), { directRoom: true, selfHost: true });

    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(screen.getByText("!fixcolors")).toBeTruthy();
  });
});
