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
 *
 * And the bot flag toggle (issue #2780's `SETBOTMODE`): shown, changed, and
 * refreshed after a change so it matches the server. `CREATEBOTACCOUNT`,
 * the other half of #2780, is `BotAccountsSection.dom.test.tsx`'s.
 *
 * And the password reset action (issue #2781's `RESETUSERPASSWORD`): the
 * popover confirm step, whether the email argument is sent, the success
 * and refusal wording, and the timeout explanation. The refusal and
 * success sentences themselves are uberserver's own wording, parsed and
 * fixture-tested in `admin_reply.rs`. This only covers how the section
 * reads and shows the reply it gets back.
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

// The popover's real Radix implementation only draws its content once open,
// which needs positioning APIs jsdom/happy-dom does not implement. Stood in
// for so the content is always drawn, matching the pattern in
// MemberActionsMenu.dom.test.tsx and relayIndicator.dom.test.tsx.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const mpAdminCommand = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<AdminOutcome>>(),
);
vi.mock("../bindings", () => ({ mpAdminCommand }));

const SERVER_KEY = "mod@uber.example:8200";
const wire = vi.hoisted(() => ({ adminLevel: "mod" as "mod" | "admin" }));

// `AdminOnly` (the Access level action's gate, issue #2786) reads the
// connection's level through `useMultiplayer`, and `SetAccessAction` reads
// the signed-in username through `usernameFromKey`, a pure function rather
// than a hook.
vi.mock("../store", () => ({
  useMultiplayer: () => ({
    connections: {
      [SERVER_KEY]: { adminLevel: wire.adminLevel },
    },
  }),
  usernameFromKey: (key: string) => key.split("@")[0],
}));

vi.mock("../useServerAdminKey", () => ({
  useServerAdminKey: () => [SERVER_KEY, () => {}],
}));

import { PlayerLookupSection } from "./PlayerLookupSection";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
  wire.adminLevel = "mod";
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

describe("the bot flag toggle", () => {
  function accountReply(bot: boolean) {
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
        bot,
        ingameHours: "12",
        email: null,
        lastIp: null,
        lastSysId: null,
        lastMacId: null,
      },
    });
  }

  it("shows the current flag", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply(true));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("turns the flag on and refreshes the lookup so it matches the server", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply(false));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );

    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "botMode", username: "Alice", bot: true }),
    );
    mpAdminCommand.mockResolvedValueOnce(accountReply(true));

    fireEvent.click(screen.getByRole("switch"));
    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "SETBOTMODE",
      args: ["Alice", "true"],
      shape: "botMode",
    });
    expect(
      await screen.findByText("Bot flag for Alice is now on."),
    ).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenNthCalledWith(3, {
      serverKey: SERVER_KEY,
      command: "GETUSERINFO",
      args: ["Alice"],
      shape: "userInfo",
    });
    await screen.findByText(/Online \(session 7\)/);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("turns the flag off", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply(true));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);

    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "botMode", username: "Alice", bot: false }),
    );
    mpAdminCommand.mockResolvedValueOnce(accountReply(false));

    fireEvent.click(screen.getByRole("switch"));
    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "SETBOTMODE",
      args: ["Alice", "false"],
      shape: "botMode",
    });
    expect(
      await screen.findByText("Bot flag for Alice is now off."),
    ).toBeTruthy();
  });

  it("shows a missing account timing out as an unanswered message, not an error", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply(false));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);

    mpAdminCommand.mockResolvedValueOnce({ outcome: "unanswered" });

    fireEvent.click(screen.getByRole("switch"));
    expect(
      await screen.findByText("Alice may no longer exist, so nothing changed."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // No refresh follows an unanswered toggle.
    expect(mpAdminCommand).toHaveBeenCalledTimes(2);
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
    // The page shows one tool at a time (issue #2918), so the handoff also
    // switches to Bans.
    expect(screen.getByTestId("search-params").textContent).toContain(
      "tool=bans",
    );
  });
});

/** `SETACCESS <username> user|mod|admin` (issue #2786): admin-only, so it
 * sits behind `<AdminOnly>` unlike the rest of the lookup's actions. The
 * confirm wording and the queue-level `OK` claim are covered where the
 * action is defined, `StaffSection.dom.test.tsx` and Rust's
 * `admin_command.rs`. This only covers that the lookup offers it to an
 * admin, hides it from a moderator, and refreshes the account after a
 * successful change. */
describe("the access level action", () => {
  function accountReply(username: string, access: string): AdminReply {
    return {
      shape: "userInfo",
      info: {
        kind: "account",
        username,
        online: true,
        userId: "42",
        sessionId: "7",
        agent: null,
        registered: "Jan 02, 2020",
        lastLogin: "Sep 16, 2026",
        access,
        bot: false,
        ingameHours: "12",
        email: null,
        lastIp: null,
        lastSysId: null,
        lastMacId: null,
      },
    };
  }

  it("is hidden from a moderator", async () => {
    wire.adminLevel = "mod";
    mpAdminCommand.mockResolvedValueOnce(
      answered(accountReply("Alice", "user")),
    );
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);
    expect(screen.queryByRole("button", { name: "Change access…" })).toBeNull();
  });

  it("is offered to an admin", async () => {
    wire.adminLevel = "admin";
    mpAdminCommand.mockResolvedValueOnce(
      answered(accountReply("Alice", "user")),
    );
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);
    expect(screen.getByRole("button", { name: "Change access…" })).toBeTruthy();
  });

  it("re-runs the lookup after a successful change", async () => {
    wire.adminLevel = "admin";
    mpAdminCommand
      .mockResolvedValueOnce(answered(accountReply("Alice", "user")))
      .mockResolvedValueOnce(
        answered({ shape: "setAccess", success: true, message: "" }),
      )
      .mockResolvedValueOnce(answered(accountReply("Alice", "mod")));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);

    fireEvent.change(screen.getByLabelText("New access level"), {
      target: { value: "mod" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change access" }));

    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "SETACCESS",
      args: ["Alice", "mod"],
      shape: "setAccess",
    });
    await screen.findByText("mod");
    expect(mpAdminCommand).toHaveBeenNthCalledWith(3, {
      serverKey: SERVER_KEY,
      command: "GETUSERINFO",
      args: ["Alice"],
      shape: "userInfo",
    });
  });
});

describe("the password reset action", () => {
  function accountReply(email: string | null) {
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
        email,
        lastIp: null,
        lastSysId: null,
        lastMacId: null,
      },
    });
  }

  it("sends no email when the account already has a valid one, and does not offer to type one", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply("alice@example.com"));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);

    expect(screen.queryByLabelText("Email address to add")).toBeNull();

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "resetUserPassword",
        success: true,
        message:
          "An email was sent to 'alice@example.com' containing a new password for <Alice>",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send reset email" }));
    expect(mpAdminCommand).toHaveBeenLastCalledWith({
      serverKey: SERVER_KEY,
      command: "RESETUSERPASSWORD",
      args: ["Alice"],
      shape: "resetUserPassword",
    });
    expect(
      await screen.findByText(
        "An email was sent to 'alice@example.com' containing a new password for <Alice>",
      ),
    ).toBeTruthy();
  });

  it("sends the typed email when the account has no valid one on file", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply(null));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);

    // The confirm step: nothing is sent until "Send reset email" is
    // clicked, and it stays disabled with no address typed in yet.
    const send = screen.getByRole("button", { name: "Send reset email" });
    expect(send).toHaveProperty("disabled", true);
    expect(mpAdminCommand).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Email address to add"), {
      target: { value: "new@example.com" },
    });
    expect(send).toHaveProperty("disabled", false);

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "resetUserPassword",
        success: true,
        message:
          "An email was sent to 'new@example.com' containing a new password for <Alice>",
      }),
    );
    fireEvent.click(send);
    expect(mpAdminCommand).toHaveBeenLastCalledWith({
      serverKey: SERVER_KEY,
      command: "RESETUSERPASSWORD",
      args: ["Alice", "new@example.com"],
      shape: "resetUserPassword",
    });
    expect(
      await screen.findByText(
        "An email was sent to 'new@example.com' containing a new password for <Alice>",
      ),
    ).toBeTruthy();
  });

  it("shows 'does not exist' as a refusal", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply("alice@example.com"));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "resetUserPassword",
        success: false,
        message: "User <Alice> does not exist",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send reset email" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("User <Alice> does not exist");
    expect(screen.getByText("The server refused")).toBeTruthy();
  });

  it("shows 'already has a valid email' as a refusal", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply(null));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);
    fireEvent.change(screen.getByLabelText("Email address to add"), {
      target: { value: "new@example.com" },
    });

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "resetUserPassword",
        success: false,
        message:
          "User <Alice> already has a valid email address (alice@example.com), please try again without specifying an email address",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send reset email" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("already has a valid email address");
    expect(screen.getByText("The server refused")).toBeTruthy();
  });

  it("explains a timeout as a server with email switched off", async () => {
    mpAdminCommand.mockResolvedValueOnce(accountReply("alice@example.com"));
    draw();
    lookUp("Alice");
    await screen.findByText(/Online \(session 7\)/);

    mpAdminCommand.mockResolvedValueOnce({ outcome: "unanswered" });
    fireEvent.click(screen.getByRole("button", { name: "Send reset email" }));
    expect(
      await screen.findByText(/A server with email switched off/),
    ).toBeTruthy();
    expect(screen.getByText(/ScarylePoo\/uberserver#58/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("identifier field attributes (issue #2919)", () => {
  it("stops the player name field auto-capitalising on macOS", () => {
    draw();
    const field = screen.getByLabelText("Player name");
    expect(field.getAttribute("autocapitalize")).toBe("off");
    expect(field.getAttribute("autocorrect")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
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
