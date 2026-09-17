// @vitest-environment happy-dom

/**
 * The channel tools of the Server admin page (issue #2782): ChanServ's
 * `:register`, `:unregister`, `:history`, `:antispam`, `:listbans` and
 * `:listmutes`. The queue and reply parsing are Rust's and tested there
 * (`admin_reply.rs`, `admin_command.rs`), including a ChanServ message that is
 * not an answer still reaching chat. This covers what the section sends and
 * what it shows for each outcome.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminOutcome, AdminReply } from "../bindings";

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
  useSetting: () => [{}, () => {}],
}));

const mpAdminCommand = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<AdminOutcome>>(),
);
vi.mock("../bindings", () => ({ mpAdminCommand }));

const SERVER_KEY = "mod@uber.example:8200";

vi.mock("../channels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../channels")>()),
  useJoinedChannels: () => [
    {
      [SERVER_KEY]: ["autojoined", { name: "keyed", key: "secret" }],
      "other@elsewhere:8200": ["notours"],
    },
    () => {},
  ],
}));

vi.mock("../store", () => ({
  useConnection: () => ({
    mirror: {
      state: {
        channels: { main: {}, autojoined: {}, __battle__12: {} },
      },
    },
  }),
}));

import { ChannelsSection, knownChannels } from "./ChannelsSection";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
});

function draw() {
  render(<ChannelsSection serverKey={SERVER_KEY} />);
}

function answered(reply: AdminReply): AdminOutcome {
  return { outcome: "answered", reply };
}

function typeChannel(name: string) {
  fireEvent.change(screen.getByLabelText("Channel"), {
    target: { value: name },
  });
}

function sentWith(command: string, args: string[], shape: string) {
  expect(mpAdminCommand).toHaveBeenCalledWith({
    serverKey: SERVER_KEY,
    command,
    args,
    shape,
  });
}

describe("knownChannels", () => {
  it("merges the autojoin list with joined channels, without battle rooms", () => {
    expect(
      knownChannels(
        ["zeta", { name: "main", key: "k" }],
        ["main", "__battle__3", "alpha"],
      ),
    ).toEqual(["alpha", "main", "zeta"]);
  });
});

describe("choosing a channel", () => {
  it("offers this server's channels, and a pick fills the field", () => {
    draw();
    expect(screen.getByRole("button", { name: "#autojoined" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "#keyed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "#main" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /battle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "#notours" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "#main" }));
    expect((screen.getByLabelText("Channel") as HTMLInputElement).value).toBe(
      "main",
    );
  });

  it("disables every action until a channel is named", () => {
    draw();
    for (const name of [
      "Register",
      "Unregister",
      "History on",
      "History off",
      "Antispam on",
      "Antispam off",
      "Show bans",
      "Show mutes",
    ]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
        name,
      ).toBe(true);
    }
  });
});

describe("registering", () => {
  it("sends :register without the # and says who the founder is", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({ shape: "registerChannel", channel: "main", founder: "mod" }),
    );
    draw();
    typeChannel("#main");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    sentWith("register", ["main"], "registerChannel");
    expect(await screen.findByText("#main is registered to mod.")).toBeTruthy();
  });

  it("names a founder when one is given", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({ shape: "registerChannel", channel: "main", founder: "Alice" }),
    );
    draw();
    typeChannel("main");
    fireEvent.change(screen.getByLabelText("Founder"), {
      target: { value: " Alice " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    sentWith("register", ["main", "Alice"], "registerChannel");
    expect(
      await screen.findByText("#main is registered to Alice."),
    ).toBeTruthy();
  });

  it("shows ChanServ's refusal as an alert", async () => {
    const reason = "Channel main does not exist";
    mpAdminCommand.mockResolvedValue({ outcome: "refused", reason });
    draw();
    typeChannel("main");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText("The server refused")).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it("unregisters", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({ shape: "unregisterChannel", channel: "main" }),
    );
    draw();
    typeChannel("main");
    fireEvent.click(screen.getByRole("button", { name: "Unregister" }));
    sentWith("unregister", ["main"], "unregisterChannel");
    expect(
      await screen.findByText("#main is no longer registered."),
    ).toBeTruthy();
  });
});

describe("settings", () => {
  it.each([
    [
      "History on",
      "history",
      "on",
      "channelHistory",
      "History is on for #main.",
    ],
    [
      "History off",
      "history",
      "off",
      "channelHistory",
      "History is off for #main.",
    ],
    [
      "Antispam on",
      "antispam",
      "on",
      "channelAntispam",
      "Antispam is on for #main.",
    ],
    [
      "Antispam off",
      "antispam",
      "off",
      "channelAntispam",
      "Antispam is off for #main.",
    ],
  ] as const)("%s sends :%s %s", async (button, command, value, shape, shown) => {
    mpAdminCommand.mockResolvedValue(
      answered({ shape, channel: "main", on: value === "on" }),
    );
    draw();
    typeChannel("main");
    fireEvent.click(screen.getByRole("button", { name: button }));
    sentWith(command, ["main", value], shape);
    expect(await screen.findByText(shown)).toBeTruthy();
  });
});

describe("bans and mutes", () => {
  it("lists the channel's bans", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "channelBanList",
        entries: [
          {
            username: "cbplayer2",
            ip: "127.0.0.1",
            reason: "probe ban",
            ends: "2026-09-19 11:19:16",
            issuer: "cbmod",
          },
          {
            username: "Relay:discord",
            ip: null,
            reason: "spam",
            ends: "9999-12-31 23:59:59",
            issuer: "unknown",
          },
        ],
      }),
    );
    draw();
    typeChannel("main");
    fireEvent.click(screen.getByRole("button", { name: "Show bans" }));
    sentWith("listbans", ["main"], "channelBanList");
    expect(await screen.findByText("cbplayer2")).toBeTruthy();
    expect(screen.getByText("probe ban")).toBeTruthy();
    expect(screen.getByText("Relay:discord")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("lists the channel's mutes", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "channelMuteList",
        entries: [
          {
            username: "cbuser",
            reason: "probe mute",
            ends: "2026-09-17 12:19:15",
            issuer: "cbmod",
          },
        ],
      }),
    );
    draw();
    typeChannel("main");
    fireEvent.click(screen.getByRole("button", { name: "Show mutes" }));
    sentWith("listmutes", ["main"], "channelMuteList");
    expect(await screen.findByText("cbuser")).toBeTruthy();
    expect(screen.getByText("probe mute")).toBeTruthy();
  });

  it("says when a list is empty", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({ shape: "channelMuteList", entries: [] }),
    );
    draw();
    typeChannel("main");
    fireEvent.click(screen.getByRole("button", { name: "Show mutes" }));
    expect(await screen.findByText("No one is muted in #main.")).toBeTruthy();
  });
});
