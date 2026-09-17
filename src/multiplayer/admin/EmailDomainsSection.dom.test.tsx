// @vitest-environment happy-dom

/**
 * The Email domains tool of the Server admin page (issue #2784):
 * `LISTBLACKLIST` as a table, `BLACKLIST` to block a domain, `UNBLACKLIST` to
 * unblock one, and the refresh after every change. The queue and reply
 * parsing are Rust's and tested there (`admin_reply.rs`). This covers what
 * the section does with each outcome.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
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

import { EmailDomainsSection } from "./EmailDomainsSection";

const SERVER_KEY = "mod@uber.example:8200";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
});

function draw() {
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <EmailDomainsSection serverKey={SERVER_KEY} />
    </MemoryRouter>,
  );
}

function answered(reply: AdminReply): AdminOutcome {
  return { outcome: "answered", reply };
}

function refused(reason: string): AdminOutcome {
  return { outcome: "refused", reason };
}

const ONE_DOMAIN = {
  domain: "mailinator.com",
  reason: "disposable",
  issuer: "Moderator",
};

/** The forms open on demand in a drawer (issue #2918), so each helper
 * presses the header or row button that opens its form first. */
function blockFieldset() {
  fireEvent.click(screen.getByRole("button", { name: "Block a domain…" }));
  return screen.getByRole("group", { name: "Block a domain" });
}

describe("loading the domain list", () => {
  it("shows an empty list", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [] }),
    );
    draw();
    expect(await screen.findByText("No domains are blocked.")).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "LISTBLACKLIST",
      args: [],
      shape: "blacklist",
    });
  });

  it("shows a populated list", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [ONE_DOMAIN] }),
    );
    draw();
    expect(await screen.findByText("mailinator.com")).toBeTruthy();
    expect(screen.getByText("disposable")).toBeTruthy();
    expect(screen.getByText("Moderator")).toBeTruthy();
  });
});

describe("blocking a domain", () => {
  it("sends BLACKLIST with the typed reason, and refreshes the list", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [] }),
    );
    draw();
    await screen.findByText("No domains are blocked.");

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "blacklistDomain",
        success: true,
        message: "Successfully added mailinator.com to blacklist",
      }),
    );
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [ONE_DOMAIN] }),
    );

    const form = blockFieldset();
    fireEvent.change(within(form).getByLabelText("Domain"), {
      target: { value: "mailinator.com" },
    });
    fireEvent.change(within(form).getByLabelText("Reason"), {
      target: { value: "disposable" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Block domain" }));

    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "BLACKLIST",
      args: ["mailinator.com", "disposable"],
      shape: "blacklistDomain",
    });
    expect(
      await within(form).findByText(/Successfully added mailinator.com/),
    ).toBeTruthy();
    // The refresh: a third LISTBLACKLIST after the block answered.
    expect(mpAdminCommand).toHaveBeenNthCalledWith(3, {
      serverKey: SERVER_KEY,
      command: "LISTBLACKLIST",
      args: [],
      shape: "blacklist",
    });
    await screen.findByText("mailinator.com");
  });

  it("sends BLACKLIST with only the domain when no reason is typed", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [] }),
    );
    draw();
    await screen.findByText("No domains are blocked.");

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "blacklistDomain",
        success: true,
        message: "Successfully added mailinator.com to blacklist",
      }),
    );
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [ONE_DOMAIN] }),
    );

    const form = blockFieldset();
    fireEvent.change(within(form).getByLabelText("Domain"), {
      target: { value: "mailinator.com" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Block domain" }));

    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "BLACKLIST",
      args: ["mailinator.com"],
      shape: "blacklistDomain",
    });
    expect(
      await within(form).findByText(/Successfully added mailinator.com/),
    ).toBeTruthy();
  });

  it("will not submit without a domain", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [] }),
    );
    draw();
    await screen.findByText("No domains are blocked.");
    mpAdminCommand.mockClear();

    const form = blockFieldset();
    expect(
      within(form).getByRole("button", { name: "Block domain" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(within(form).getByRole("button", { name: "Block domain" }));
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("shows a refusal and does not refresh the list", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [] }),
    );
    draw();
    await screen.findByText("No domains are blocked.");

    mpAdminCommand.mockResolvedValueOnce(refused("Insufficient rights."));

    const form = blockFieldset();
    fireEvent.change(within(form).getByLabelText("Domain"), {
      target: { value: "mailinator.com" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Block domain" }));

    expect(await within(form).findByText("Insufficient rights.")).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenCalledTimes(2);
  });
});

describe("a row's Unblock action", () => {
  it("opens the unblock form filled with that row's domain, sends UNBLACKLIST and refreshes", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [ONE_DOMAIN] }),
    );
    draw();
    await screen.findByText("mailinator.com");
    expect(
      screen.queryByRole("group", { name: "Unblock a domain" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Unblock mailinator.com…" }),
    );
    const form = screen.getByRole("group", { name: "Unblock a domain" });
    expect(within(form).getByLabelText("Domain to unblock")).toHaveProperty(
      "value",
      "mailinator.com",
    );

    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "unblacklistDomain",
        success: true,
        message: "Sucessfully removed mailinator.com from blacklist",
      }),
    );
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "blacklist", entries: [] }),
    );

    fireEvent.click(
      within(form).getByRole("button", { name: "Unblock domain" }),
    );

    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "UNBLACKLIST",
      args: ["mailinator.com"],
      shape: "unblacklistDomain",
    });
    expect(
      await within(form).findByText(/Sucessfully removed mailinator.com/),
    ).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenNthCalledWith(3, {
      serverKey: SERVER_KEY,
      command: "LISTBLACKLIST",
      args: [],
      shape: "blacklist",
    });
    await screen.findByText("No domains are blocked.");
  });
});
