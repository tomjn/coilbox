// @vitest-environment happy-dom

/**
 * The bans section of the Server admin page (issue #2778): `LISTBANS` as a
 * table, `BAN` and `BANSPECIFIC` to add a ban, `UNBAN` to lift one, and the
 * refresh after every change. The queue and reply parsing are Rust's and
 * tested there (`admin_reply.rs`). This covers what the section does with
 * each outcome.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
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

import { BansSection } from "./BansSection";

const SERVER_KEY = "mod@uber.example:8200";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
});

function draw(initialPath = "/admin") {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BansSection serverKey={SERVER_KEY} />
    </MemoryRouter>,
  );
}

function answered(reply: AdminReply): AdminOutcome {
  return { outcome: "answered", reply };
}

function refused(reason: string): AdminOutcome {
  return { outcome: "refused", reason };
}

const ONE_BAN = {
  username: "Spammer",
  ip: "203.0.113.7",
  email: "spam@example.com",
  reason: "flooding #main",
  ends: "2026-10-01 00:00:00",
  issuer: "Moderator",
};

/** The forms open on demand in a drawer (issue #2918), so each helper
 * presses the header button that opens its form first. */
function opened(button: string, group: string) {
  fireEvent.click(screen.getByRole("button", { name: button }));
  return screen.getByRole("group", { name: group });
}

function banFieldset() {
  return opened("Ban an account…", "Ban an account");
}

function banSpecificFieldset() {
  return opened("Ban IP or email…", "Ban a specific username, IP or email");
}

function unbanFieldset() {
  return opened("Lift a ban…", "Lift a ban");
}

describe("loading the ban list", () => {
  it("shows an empty list", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [] }),
    );
    draw();
    expect(await screen.findByText("No one is banned.")).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "LISTBANS",
      args: [],
      shape: "banList",
    });
  });

  it("shows a populated list", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [ONE_BAN] }),
    );
    draw();
    expect(await screen.findByText("Spammer")).toBeTruthy();
    expect(screen.getByText("203.0.113.7")).toBeTruthy();
    expect(screen.getByText("spam@example.com")).toBeTruthy();
    expect(screen.getByText("flooding #main")).toBeTruthy();
    expect(screen.getByText("2026-10-01 00:00:00")).toBeTruthy();
    expect(screen.getByText("Moderator")).toBeTruthy();
  });

  it("shows a dash for a ban with no account", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "banList",
        entries: [{ ...ONE_BAN, username: null, email: null }],
      }),
    );
    draw();
    await screen.findByText("203.0.113.7");
    expect(screen.getAllByText("-")).toHaveLength(2);
  });
});

describe("banning an account", () => {
  it("sends BAN with the typed days and reason, and refreshes the list", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [] }),
    );
    draw();
    await screen.findByText("No one is banned.");

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "ban",
        success: true,
        message:
          "Successfully banned Spammer, 203.0.113.7, spam@example.com for 7 days.",
      }),
    );
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [ONE_BAN] }),
    );

    const form = banFieldset();
    fireEvent.change(within(form).getByLabelText("Username"), {
      target: { value: "Spammer" },
    });
    fireEvent.change(within(form).getByLabelText("Days"), {
      target: { value: "7" },
    });
    fireEvent.change(within(form).getByLabelText("Reason"), {
      target: { value: "flooding #main" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Ban account" }));

    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "BAN",
      args: ["Spammer", "7", "flooding #main"],
      shape: "ban",
    });
    expect(
      await within(form).findByText(/Successfully banned Spammer/),
    ).toBeTruthy();
    // The refresh: a third LISTBANS after the ban answered.
    expect(mpAdminCommand).toHaveBeenNthCalledWith(3, {
      serverKey: SERVER_KEY,
      command: "LISTBANS",
      args: [],
      shape: "banList",
    });
    await screen.findByText("Spammer");
  });

  it("will not submit without a reason", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [] }),
    );
    draw();
    await screen.findByText("No one is banned.");
    mpAdminCommand.mockClear();

    const form = banFieldset();
    fireEvent.change(within(form).getByLabelText("Username"), {
      target: { value: "Spammer" },
    });
    fireEvent.change(within(form).getByLabelText("Days"), {
      target: { value: "7" },
    });
    expect(
      within(form).getByRole("button", { name: "Ban account" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(within(form).getByRole("button", { name: "Ban account" }));
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("shows a refusal and does not refresh the list", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [] }),
    );
    draw();
    await screen.findByText("No one is banned.");

    mpAdminCommand.mockResolvedValueOnce(refused("Insufficient rights."));

    const form = banFieldset();
    fireEvent.change(within(form).getByLabelText("Username"), {
      target: { value: "Spammer" },
    });
    fireEvent.change(within(form).getByLabelText("Days"), {
      target: { value: "7" },
    });
    fireEvent.change(within(form).getByLabelText("Reason"), {
      target: { value: "flooding #main" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Ban account" }));

    expect(await within(form).findByText("Insufficient rights.")).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenCalledTimes(2);
  });
});

describe("banning a specific IP or email", () => {
  it("sends BANSPECIFIC and refreshes the list", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [] }),
    );
    draw();
    await screen.findByText("No one is banned.");

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "banSpecific",
        success: true,
        message: "Successfully banned 203.0.113.7 for 3 days",
      }),
    );
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [ONE_BAN] }),
    );

    const form = banSpecificFieldset();
    fireEvent.change(
      within(form).getByLabelText("Username, IP or email to ban"),
      {
        target: { value: "203.0.113.7" },
      },
    );
    fireEvent.change(within(form).getByLabelText("Days"), {
      target: { value: "3" },
    });
    fireEvent.change(within(form).getByLabelText("Reason"), {
      target: { value: "ban evasion" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Ban target" }));

    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "BANSPECIFIC",
      args: ["203.0.113.7", "3", "ban evasion"],
      shape: "banSpecific",
    });
    expect(
      await within(form).findByText(
        "Successfully banned 203.0.113.7 for 3 days",
      ),
    ).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenNthCalledWith(3, {
      serverKey: SERVER_KEY,
      command: "LISTBANS",
      args: [],
      shape: "banList",
    });
  });
});

describe("lifting a ban", () => {
  it("warns that an IP or email lifts every ban on it, and refreshes after UNBAN", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [ONE_BAN] }),
    );
    draw();
    await screen.findByText("Spammer");

    const form = unbanFieldset();
    expect(within(form).getByText(/lifts every ban on it/i)).toBeTruthy();

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "unban",
        success: true,
        message: "Successfully removed 1 bans relating to 203.0.113.7",
      }),
    );
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [] }),
    );

    fireEvent.change(
      within(form).getByLabelText("Username, IP or email to unban"),
      { target: { value: "203.0.113.7" } },
    );
    fireEvent.click(within(form).getByRole("button", { name: "Lift ban" }));

    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "UNBAN",
      args: ["203.0.113.7"],
      shape: "unban",
    });
    expect(
      await within(form).findByText(/Successfully removed 1 bans/),
    ).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenNthCalledWith(3, {
      serverKey: SERVER_KEY,
      command: "LISTBANS",
      args: [],
      shape: "banList",
    });
    await screen.findByText("No one is banned.");
  });
});

describe("a row's Lift action", () => {
  it("opens the unban form filled with that row's name", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [ONE_BAN] }),
    );
    draw();
    await screen.findByText("Spammer");
    expect(screen.queryByRole("group", { name: "Lift a ban" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Lift ban on Spammer…" }),
    );
    const form = screen.getByRole("group", { name: "Lift a ban" });
    expect(
      within(form).getByLabelText("Username, IP or email to unban"),
    ).toHaveProperty("value", "Spammer");
  });

  it("falls back to the IP for a ban with no account", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [{ ...ONE_BAN, username: null }] }),
    );
    draw();
    fireEvent.click(
      await screen.findByRole("button", { name: "Lift ban on 203.0.113.7…" }),
    );
    expect(
      screen.getByLabelText("Username, IP or email to unban"),
    ).toHaveProperty("value", "203.0.113.7");
  });
});

function SearchProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

describe("the name from the player lookup's Ban action", () => {
  it("opens the ban form filled from ?ban=, and swaps the param for ?tool=bans", () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "banList", entries: [] }),
    );
    render(
      <MemoryRouter initialEntries={["/admin?tool=players&ban=Alice"]}>
        <BansSection serverKey={SERVER_KEY} />
        <SearchProbe />
      </MemoryRouter>,
    );
    const search = new URLSearchParams(
      screen.getByTestId("search").textContent ?? "",
    );
    expect(search.has("ban")).toBe(false);
    expect(search.get("tool")).toBe("bans");
    const form = screen.getByRole("group", { name: "Ban an account" });
    expect(within(form).getByLabelText("Username")).toHaveProperty(
      "value",
      "Alice",
    );
  });
});
