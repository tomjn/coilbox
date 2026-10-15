// @vitest-environment happy-dom

/**
 * The Chat logs page with no lobby connection (issue #4082) and with readable
 * names (issue #4083): accounts read "NAME on Server name", battle chat says
 * it is battle chat, and no folder name or `__battle__` prefix reaches the
 * screen.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

const wire = vi.hoisted(() => ({
  connections: {} as Record<string, unknown>,
  accounts: [] as unknown[],
}));

vi.mock("../bindings", () => ({
  mpChatLogs: async () => ({ accounts: wire.accounts }),
  mpChatLogOpen: async () => ({ messages: [] }),
}));

vi.mock("../chat/FormattedText", () => ({
  FormattedText: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock("../store", () => ({
  useMultiplayer: () => ({ connections: wire.connections }),
  useProtocolServers: () => [],
  serverNameFor: (serverKey: string) => {
    const address = serverKey.split("@")[1];
    return address === "lobby.recoilengine.org:8200"
      ? "Recoil Official"
      : address;
  },
}));

import ChatLogPage from "./ChatLogPage";

const ACCOUNT = "NAME_lobby.recoilengine.org_8200";

function thread(kind: "dm" | "channel", name: string) {
  return { kind, name, messageCount: 3, lastAt: 1 };
}

afterEach(() => {
  cleanup();
  wire.connections = {};
  wire.accounts = [];
});

describe("ChatLogPage", () => {
  it("renders its saved conversations with no connection at all", async () => {
    wire.accounts = [{ account: ACCOUNT, threads: [thread("dm", "friend")] }];
    render(<ChatLogPage />);

    expect(screen.getByRole("heading", { name: "Chat logs" })).toBeTruthy();
    expect(await screen.findByText("friend")).toBeTruthy();
  });

  it("names the account and the server, not the folder", async () => {
    wire.accounts = [
      { account: ACCOUNT, threads: [thread("channel", "main")] },
    ];
    render(<ChatLogPage />);

    expect(await screen.findByText("NAME on Recoil Official")).toBeTruthy();
    expect(screen.queryByText(ACCOUNT)).toBeNull();
  });

  it("says battle chat is battle chat when the battle is no longer known", async () => {
    wire.accounts = [
      { account: ACCOUNT, threads: [thread("channel", "__battle__13")] },
    ];
    const { container } = render(<ChatLogPage />);

    expect(await screen.findByText("Battle chat 13")).toBeTruthy();
    expect(container.textContent).not.toContain("__battle__");
    expect(container.textContent).not.toContain("NAME_lobby");
  });

  it("names battle chat after the battle title while that connection lists it", async () => {
    wire.accounts = [
      { account: ACCOUNT, threads: [thread("channel", "__battle__13")] },
    ];
    wire.connections = {
      "NAME@lobby.recoilengine.org:8200": {
        mirror: { state: { battles: { "13": { id: 13, title: "Big FFA" } } } },
      },
    };
    const { container } = render(<ChatLogPage />);

    await waitFor(() =>
      expect(screen.getByText("Big FFA (battle chat)")).toBeTruthy(),
    );
    expect(container.textContent).not.toContain("__battle__");
  });
});
