// @vitest-environment happy-dom

/**
 * The battle chat's chat-recognised `!map <name>` line (issue #2795). A
 * coilbox player suggesting a map produces an ordinary chat line nobody acts
 * on unless the host's own client matches it against installed maps and
 * offers a way to apply it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Battle, ChatMsg } from "../bindings";
import { BattleChatCard } from "./BattleChatCard";
import { hexToI32 } from "./config";

const markSeen = vi.fn();

vi.mock("../store", () => ({
  useMultiplayer: () => ({
    mirror: { state: { myUsername: "Host", users: {} } },
    markSeen,
  }),
}));

let messages: ChatMsg[] = [];

vi.mock("../chat/useConversation", () => ({
  useConversation: () => ({
    title: "Battle chat",
    messages,
    total: messages.length,
    members: [],
    send: vi.fn(),
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

function renderCard(canChangeMap: boolean, onChangeMap = vi.fn()) {
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
    />,
  );
  return { onChangeMap };
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
