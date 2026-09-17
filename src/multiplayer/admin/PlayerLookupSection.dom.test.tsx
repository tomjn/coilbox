// @vitest-environment happy-dom

/**
 * The player lookup section of the Server admin page (issue #2777): the
 * `GETUSERINFO` fields for each account kind, following `FINDIP` from a
 * looked-up account's last IP and from a result row, and kicking the
 * account in view. The queue and the reply parsing are Rust's and tested
 * there (`admin_reply.rs`). This covers what the section does with each
 * outcome.
 *
 * Also covers the Ban action (issue #2778): it hands the account's name to
 * the bans section through `?ban=` rather than banning directly, so this
 * only checks that the param is set, not any `BAN` request (that belongs
 * to `BansSection.dom.test.tsx`).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useSearchParams } from "react-router";
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
}));

const mpAdminCommand = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<AdminOutcome>>(),
);
vi.mock("../bindings", () => ({ mpAdminCommand }));

import { PlayerLookupSection } from "./PlayerLookupSection";

const SERVER_KEY = "mod@uber.example:8200";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
});

/** Renders the current URL search params as text, so a test can see what a
 * component wrote to them without a real browser location. */
function SearchParamsProbe() {
  const [params] = useSearchParams();
  return <span data-testid="search-params">{params.toString()}</span>;
}

function draw(initialPath = "/admin") {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PlayerLookupSection serverKey={SERVER_KEY} />
      <SearchParamsProbe />
    </MemoryRouter>,
  );
}

function lookUp(name: string) {
  fireEvent.change(screen.getByLabelText("Player name"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Look up" }));
}

/** `mpAdminCommand`'s resolved value for one call: an answered outcome
 * carrying `reply`. */
function answered(reply: AdminReply): AdminOutcome {
  return { outcome: "answered", reply };
}

describe("looking up each account kind", () => {
  it("shows a missing account", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "userInfo",
        info: { kind: "missing", username: "Nobody" },
      }),
    );
    draw();
    lookUp("Nobody");
    expect(await screen.findByText(/No account named "Nobody"/)).toBeTruthy();
  });

  it("shows a missing bridged account", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "userInfo",
        info: { kind: "bridgedMissing", username: "Nobody:discord" },
      }),
    );
    draw();
    lookUp("Nobody:discord");
    expect(
      await screen.findByText(/No bridged account named "Nobody:discord"/),
    ).toBeTruthy();
  });

  it("shows a static account", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "userInfo",
        info: { kind: "static", username: "ChanServ" },
      }),
    );
    draw();
    lookUp("ChanServ");
    expect(await screen.findByText(/is a static account/)).toBeTruthy();
  });

  it("shows a bridged account's fields", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "userInfo",
        info: {
          kind: "bridged",
          username: "Carol:discord",
          bridged: true,
          bridgedId: "5",
          bridgeUserId: "9",
          lastBridged: "Sep 16, 2026",
          externalId: "123",
          location: "discord",
          externalUsername: "Carol",
        },
      }),
    );
    draw();
    lookUp("Carol:discord");
    expect(await screen.findByText("Carol:discord")).toBeTruthy();
    expect(screen.getByText(/Bridged in now via 9/)).toBeTruthy();
    expect(screen.getByText("discord")).toBeTruthy();
  });

  it("shows a normal account's fields, including the hardware IDs", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "userInfo",
        info: {
          kind: "account",
          username: "Alice",
          online: true,
          userId: "42",
          sessionId: "7",
          agent: "Coilbox 0.9",
          registered: "Jan 02, 2020",
          lastLogin: "Sep 16, 2026, 18:04:05",
          access: "mod",
          bot: false,
          ingameHours: "12",
          email: "alice@example.com",
          lastIp: "203.0.113.7",
          lastSysId: "1234",
          lastMacId: "abcd",
        },
      }),
    );
    draw();
    lookUp("Alice");
    expect(await screen.findByText("alice@example.com")).toBeTruthy();
    expect(screen.getByText("203.0.113.7")).toBeTruthy();
    expect(screen.getByText("1234")).toBeTruthy();
    expect(screen.getByText("abcd")).toBeTruthy();
    expect(screen.getByText(/Online \(session 7\)/)).toBeTruthy();
  });
});

describe("following an account's IP with FINDIP", () => {
  function accountReply() {
    return answered({
      shape: "userInfo" as const,
      info: {
        kind: "account" as const,
        username: "Alice",
        online: true,
        userId: "42",
        sessionId: "7",
        agent: null,
        registered: "Jan 02, 2020",
        lastLogin: "Sep 16, 2026",
        access: "mod",
        bot: false,
        ingameHours: "12",
        email: null,
        lastIp: "203.0.113.7",
        lastSysId: null,
        lastMacId: null,
      },
    });
  }

  it("runs FINDIP on the account's last IP in one click, and opens the lookup for a result", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply());
    draw();
    lookUp("Alice");
    await screen.findByText("203.0.113.7");

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "ipSearch",
        bindings: [
          {
            username: "Alice",
            address: "203.0.113.7",
            online: true,
            lastSeen: null,
          },
          {
            username: "Bob",
            address: "203.0.113.7",
            online: false,
            lastSeen: "2026-09-01 10:00:00",
          },
        ],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Find other accounts on this IP" }),
    );
    expect(mpAdminCommand).toHaveBeenLastCalledWith({
      serverKey: SERVER_KEY,
      command: "FINDIP",
      args: ["203.0.113.7"],
      shape: "ipSearch",
    });
    await screen.findByText("Bob");

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "userInfo",
        info: {
          kind: "account",
          username: "Bob",
          online: false,
          userId: "43",
          sessionId: null,
          agent: null,
          registered: "unknown",
          lastLogin: "unknown",
          access: "user",
          bot: false,
          ingameHours: "0",
          email: null,
          lastIp: "203.0.113.7",
          lastSysId: null,
          lastMacId: null,
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Bob" }));
    expect(mpAdminCommand).toHaveBeenLastCalledWith({
      serverKey: SERVER_KEY,
      command: "GETUSERINFO",
      args: ["Bob"],
      shape: "userInfo",
    });
    await screen.findByText(/Offline/);
    expect(screen.getByLabelText("Player name")).toHaveProperty("value", "Bob");
  });
});

describe("kicking the account in view", () => {
  it("sends KICK with the typed reason and shows the reply", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "userInfo",
        info: {
          kind: "account",
          username: "Alice",
          online: true,
          userId: "42",
          sessionId: "7",
          agent: null,
          registered: "Jan 02, 2020",
          lastLogin: "Sep 16, 2026",
          access: "mod",
          bot: false,
          ingameHours: "12",
          email: null,
          lastIp: null,
          lastSysId: null,
          lastMacId: null,
        },
      }),
    );
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);

    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "kick", username: "Alice", kicked: true }),
    );
    fireEvent.change(screen.getByLabelText("Kick reason"), {
      target: { value: "flooding" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kick" }));
    expect(mpAdminCommand).toHaveBeenLastCalledWith({
      serverKey: SERVER_KEY,
      command: "KICK",
      args: ["Alice", "flooding"],
      shape: "kick",
    });
    expect(
      await screen.findByText("Kicked Alice from the server."),
    ).toBeTruthy();
  });

  it("shows the player was not online without treating it as an error", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "userInfo",
        info: {
          kind: "account",
          username: "Bob",
          online: false,
          userId: "43",
          sessionId: null,
          agent: null,
          registered: "unknown",
          lastLogin: "unknown",
          access: "user",
          bot: false,
          ingameHours: "0",
          email: null,
          lastIp: null,
          lastSysId: null,
          lastMacId: null,
        },
      }),
    );
    draw();
    lookUp("Bob");
    await screen.findByText(/Offline/);

    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "kick", username: "Bob", kicked: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Kick" }));
    expect(await screen.findByText("Bob was not online.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the Ban action", () => {
  it("hands the account's name to the bans form through ?ban=", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "userInfo",
        info: {
          kind: "account",
          username: "Alice",
          online: true,
          userId: "42",
          sessionId: "7",
          agent: null,
          registered: "Jan 02, 2020",
          lastLogin: "Sep 16, 2026",
          access: "mod",
          bot: false,
          ingameHours: "12",
          email: null,
          lastIp: null,
          lastSysId: null,
          lastMacId: null,
        },
      }),
    );
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);

    fireEvent.click(screen.getByRole("button", { name: "Ban…" }));
    expect(screen.getByTestId("search-params").textContent).toContain(
      "ban=Alice",
    );
  });
});

describe("the name in the URL", () => {
  it("prefills the name from ?player=", () => {
    draw("/admin?player=Alice");
    expect(screen.getByLabelText("Player name")).toHaveProperty(
      "value",
      "Alice",
    );
  });

  it("writes the looked-up name back to ?player=", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "userInfo",
        info: { kind: "missing", username: "Carol" },
      }),
    );
    draw();
    lookUp("Carol");
    await screen.findByText(/No account named "Carol"/);
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "GETUSERINFO",
      args: ["Carol"],
      shape: "userInfo",
    });
  });
});
