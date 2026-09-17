// @vitest-environment happy-dom

/**
 * The Announcements tool of the Server admin page (issue #2788): `BROADCAST`,
 * `BROADCASTEX` and `ADMINBROADCAST`. The queue-level claim of
 * `ADMINBROADCAST`'s echo is Rust's and tested there (`admin_reply.rs`,
 * `admin_command.rs`). This covers what the section sends for each kind,
 * that `BROADCAST` and `BROADCASTEX` are confirmed first and cancelling
 * sends nothing, that `ADMINBROADCAST` sends straight away, and the sent
 * wording. Whether the tool itself is hidden from a moderator is
 * `tools.test.ts`'s.
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

// The popover's real Radix implementation only draws its content once open,
// which needs positioning APIs jsdom/happy-dom does not implement. Stood in
// so the content is always drawn, matching MaintenanceSection.dom.test.tsx.
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

import { AnnouncementsSection } from "./AnnouncementsSection";

const SERVER_KEY = "cbadmin@uber.example:8200";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
});

function answered(reply: AdminReply): AdminOutcome {
  return { outcome: "answered", reply };
}

function draw() {
  render(<AnnouncementsSection serverKey={SERVER_KEY} />);
}

function pickKind(label: string) {
  fireEvent.change(screen.getByLabelText("Announcement kind"), {
    target: { value: label },
  });
}

function typeMessage(text: string) {
  fireEvent.change(screen.getByLabelText("Announcement message"), {
    target: { value: text },
  });
}

describe("picking a kind", () => {
  it("defaults to Broadcast and says how it looks to a player", () => {
    draw();
    expect(
      screen.getByText("Every player sees it as a Staff announcement toast."),
    ).toBeTruthy();
  });

  it("says how Broadcast (dialog) looks to a player", () => {
    draw();
    pickKind("broadcastex");
    expect(
      screen.getByText(
        "Every player sees it as a dialog box they must dismiss.",
      ),
    ).toBeTruthy();
  });

  it("says Admin broadcast reaches only online admins", () => {
    draw();
    pickKind("adminBroadcast");
    expect(
      screen.getByText(
        "Only online admins, including you, see it as a server message.",
      ),
    ).toBeTruthy();
  });
});

describe("Broadcast", () => {
  it("sends nothing until Send is clicked in the confirm step", () => {
    draw();
    typeMessage("Server restarting in 5 minutes");
    expect(
      screen.getByRole("heading", { name: "Send to every player?" }),
    ).toBeTruthy();
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("sends nothing when the message is empty", () => {
    draw();
    expect(screen.getByRole("button", { name: "Send…" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("sends BROADCAST with the typed message and says it was sent", async () => {
    mpAdminCommand.mockResolvedValueOnce({ outcome: "unanswered" });
    draw();
    typeMessage("Server restarting in 5 minutes");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "BROADCAST",
      args: ["Server restarting in 5 minutes"],
      shape: "noReply",
    });
    expect(
      await screen.findByText(
        "Sent. Nothing replies to confirm a player saw it.",
      ),
    ).toBeTruthy();
  });

  it("shows the server's refusal for a moderator without rights", async () => {
    mpAdminCommand.mockResolvedValueOnce({
      outcome: "refused",
      reason: "Insufficient rights.",
    });
    draw();
    typeMessage("Server restarting in 5 minutes");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Insufficient rights.");
  });
});

describe("Broadcast (dialog)", () => {
  it("sends BROADCASTEX with the typed message", async () => {
    mpAdminCommand.mockResolvedValueOnce({ outcome: "unanswered" });
    draw();
    pickKind("broadcastex");
    typeMessage("Server restarting in 5 minutes");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "BROADCASTEX",
      args: ["Server restarting in 5 minutes"],
      shape: "noReply",
    });
    expect(
      await screen.findByText(
        "Sent. Nothing replies to confirm a player saw it.",
      ),
    ).toBeTruthy();
  });
});

describe("Admin broadcast", () => {
  it("has no confirm step and sends straight away", () => {
    draw();
    pickKind("adminBroadcast");
    typeMessage("Server restarting in 5 minutes");
    expect(
      screen.queryByRole("heading", { name: "Send to every player?" }),
    ).toBeNull();
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("sends ADMINBROADCAST and shows the echoed message as its own answer", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "adminBroadcast",
        message: "Server restarting in 5 minutes",
      }),
    );
    draw();
    pickKind("adminBroadcast");
    typeMessage("Server restarting in 5 minutes");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "ADMINBROADCAST",
      args: ["Server restarting in 5 minutes"],
      shape: "adminBroadcast",
    });
    expect(
      await screen.findByText(
        "Sent. The server echoed back: Server restarting in 5 minutes",
      ),
    ).toBeTruthy();
  });
});
