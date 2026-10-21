// @vitest-environment happy-dom

/**
 * Issue #4602: the battle room's chat shows the translated labels beside
 * server text that stays as the server sent it. The catalog is a fixture, not
 * a real translation. It renames three strings so a translated one can be
 * told from the English source.
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Battle, ChatMsg } from "../bindings";
import { BattleChatCard } from "./BattleChatCard";

const markSeen = vi.fn();

vi.mock("../store", () => ({
  initialMirror: { state: null },
  useMultiplayer: () => ({ markSeen }),
  useConnection: () => ({
    mirror: { state: { myUsername: "Host", users: {} } },
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
  useTheme: () => ({ resolved: "dark" }),
}));

afterEach(() => {
  cleanup();
  messages = [];
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

const SERVER_TEXT = "Server restarting in 5 minutes. Nobody is to blame.";

function fixtureCatalog() {
  return {
    [msg`Message`.id]: "Fixture message",
    [msg`Send`.id]: "Fixture send",
    [msg`Host commands`.id]: "Fixture host commands",
    // A server line is never run through the catalog, even if a message
    // happens to share its text.
    [SERVER_TEXT]: "Fixture should never appear",
  };
}

function renderCard() {
  messages = [
    {
      channel: "battle_9",
      from: "Server",
      text: SERVER_TEXT,
      kind: "system",
      at: 1000,
      id: null,
    } satisfies ChatMsg,
  ];
  render(
    <I18nProvider i18n={i18n}>
      <BattleChatCard
        battle={
          { id: 9, channel: "battle_9", members: {} } as unknown as Battle
        }
        enginePath="/engine"
        dataDir="/data"
        maps={[]}
        canChangeMap={false}
        onChangeMap={vi.fn()}
        selfHost={false}
        directRoom={false}
        rows={[]}
        hostControls={{ forceAlly: vi.fn(), forceTeam: vi.fn() }}
        onSetBattleStatusBatch={vi.fn()}
        onSetLocked={vi.fn()}
        serverKey="Host@server:8200"
      />
    </I18nProvider>,
  );
}

describe("the battle room's chat under a fixture catalog", () => {
  it("shows translated labels beside an untranslated server message", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    renderCard();
    expect(screen.getByLabelText("Fixture message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fixture send" })).toBeTruthy();
    expect(screen.getByText(SERVER_TEXT)).toBeTruthy();
    expect(screen.queryByText("Fixture should never appear")).toBeNull();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    renderCard();
    expect(screen.getByLabelText("Message")).toBeTruthy();
    expect(screen.getByText(SERVER_TEXT)).toBeTruthy();
  });

  it("follows a language change while mounted", async () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    await act(async () => {
      i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    });
    expect(screen.getByRole("button", { name: "Fixture send" })).toBeTruthy();
    expect(screen.getByText(SERVER_TEXT)).toBeTruthy();
  });
});
