// @vitest-environment happy-dom

/**
 * The create-bot-account form of the Server admin page (issue #2780):
 * `CREATEBOTACCOUNT <newname> <fromuser> [founder]`. The queue and reply
 * parsing are Rust's and tested there (`admin_reply.rs`). This covers what
 * the section does with each outcome: success with and without a founder,
 * and a refusal.
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
}));

const mpAdminCommand = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<AdminOutcome>>(),
);
vi.mock("../bindings", () => ({ mpAdminCommand }));

import { BotAccountsSection } from "./BotAccountsSection";

const SERVER_KEY = "mod@uber.example:8200";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
});

function draw() {
  render(<BotAccountsSection serverKey={SERVER_KEY} />);
}

function answered(reply: AdminReply): AdminOutcome {
  return { outcome: "answered", reply };
}

function refused(reason: string): AdminOutcome {
  return { outcome: "refused", reason };
}

function fillForm({
  newName,
  fromUser,
  founder,
}: {
  newName: string;
  fromUser: string;
  founder?: string;
}) {
  fireEvent.change(screen.getByLabelText("New bot account name"), {
    target: { value: newName },
  });
  fireEvent.change(screen.getByLabelText("Copy the password from"), {
    target: { value: fromUser },
  });
  if (founder) {
    fireEvent.change(screen.getByLabelText("Battle founder"), {
      target: { value: founder },
    });
  }
}

describe("explaining the password rule", () => {
  it("says the password is copied, not set", () => {
    draw();
    expect(screen.getByText(/password is copied, not set/i)).toBeTruthy();
    expect(screen.getByText(/Coilbox never sees that password/)).toBeTruthy();
  });
});

describe("creating a bot account", () => {
  it("sends CREATEBOTACCOUNT with no founder and shows the success line", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "createBotAccount",
        username: "Autohost1",
        fromUsername: "Alice",
        founder: null,
      }),
    );
    draw();
    fillForm({ newName: "Autohost1", fromUser: "Alice" });
    fireEvent.click(screen.getByRole("button", { name: "Create bot account" }));

    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "CREATEBOTACCOUNT",
      args: ["Autohost1", "Alice"],
      shape: "createBotAccount",
    });
    expect(
      await screen.findByText(
        "Created bot account Autohost1, with the same password as Alice.",
      ),
    ).toBeTruthy();
  });

  it("sends the founder and shows it in the success line", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "createBotAccount",
        username: "Autohost1",
        fromUsername: "Alice",
        founder: "Bob",
      }),
    );
    draw();
    fillForm({ newName: "Autohost1", fromUser: "Alice", founder: "Bob" });
    fireEvent.click(screen.getByRole("button", { name: "Create bot account" }));

    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "CREATEBOTACCOUNT",
      args: ["Autohost1", "Alice", "Bob"],
      shape: "createBotAccount",
    });
    expect(
      await screen.findByText(
        "Created bot account Autohost1, with the same password as Alice, and battle founder Bob.",
      ),
    ).toBeTruthy();
  });

  it("will not submit without both required fields", () => {
    draw();
    fireEvent.change(screen.getByLabelText("New bot account name"), {
      target: { value: "Autohost1" },
    });
    expect(
      screen.getByRole("button", { name: "Create bot account" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Create bot account" }));
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("shows a refusal, tagged FAILED for an invalid name or a missing user", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      refused("User does not exist 'Nobody'"),
    );
    draw();
    fillForm({ newName: "Autohost1", fromUser: "Nobody" });
    fireEvent.click(screen.getByRole("button", { name: "Create bot account" }));

    expect(
      await screen.findByText("User does not exist 'Nobody'"),
    ).toBeTruthy();
  });
});
