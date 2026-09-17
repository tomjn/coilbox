// @vitest-environment happy-dom

/**
 * The Staff tool of the Server admin page (issue #2786): `LISTMODS` as the
 * list, `SETACCESS` as the form to move an account between `user`, `mod` and
 * `admin`. The queue-level claim of `SETACCESS`'s bare `OK` reply is Rust's
 * and tested there (`admin_reply.rs`, `admin_command.rs`). This covers what
 * the section sends, its confirm wording, and the refresh after a change.
 * Whether the tool itself is hidden from a moderator is `tools.test.ts`'s.
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

vi.mock("../store", () => ({
  usernameFromKey: (key: string) => key.split("@")[0],
}));

import { StaffSection } from "./StaffSection";

const SERVER_KEY = "cbadmin@uber.example:8200";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
});

function answered(reply: AdminReply): AdminOutcome {
  return { outcome: "answered", reply };
}

function listModsReply(admins: string[], mods: string[]): AdminReply {
  return { shape: "listMods", admins, mods };
}

function draw() {
  render(<StaffSection serverKey={SERVER_KEY} />);
}

async function pickLevel(level: "user" | "mod" | "admin") {
  fireEvent.change(screen.getByLabelText("New access level"), {
    target: { value: level },
  });
}

describe("the staff list", () => {
  it("sends LISTMODS on mount and shows the admins and mods, and the 365-day note", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered(listModsReply(["cbadmin"], ["cbmod"])),
    );
    draw();
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "LISTMODS",
      args: [],
      shape: "listMods",
    });
    expect(await screen.findByText("cbadmin")).toBeTruthy();
    expect(screen.getByText("cbmod")).toBeTruthy();
    expect(
      screen.getByText(/removes moderator and admin access.*365 days/),
    ).toBeTruthy();
  });

  it("shows an empty level as None", async () => {
    mpAdminCommand.mockResolvedValueOnce(answered(listModsReply([], [])));
    draw();
    expect(await screen.findAllByText("None.")).toHaveLength(2);
  });
});

describe("changing an account's access", () => {
  it("sends nothing until a username is typed", () => {
    mpAdminCommand.mockResolvedValue(answered(listModsReply([], [])));
    draw();
    expect(
      screen.getByRole("button", { name: "Change access…" }),
    ).toHaveProperty("disabled", true);
  });

  it("says setting mod or admin lifts the account off every ignore list, but not for user", async () => {
    mpAdminCommand.mockResolvedValue(answered(listModsReply([], [])));
    draw();
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "cbplayer2" },
    });
    expect(screen.queryByText(/off every player's ignore list/)).toBeNull();
    await pickLevel("mod");
    expect(
      screen.getByText(
        /Setting cbplayer2 to mod also takes them off every player's ignore list\./,
      ),
    ).toBeTruthy();
  });

  it("warns an admin who is about to demote their own account", async () => {
    mpAdminCommand.mockResolvedValue(answered(listModsReply([], [])));
    draw();
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "cbadmin" },
    });
    await pickLevel("mod");
    expect(screen.getByText("This is your own account")).toBeTruthy();
  });

  it("does not warn about self when the target is somebody else", async () => {
    mpAdminCommand.mockResolvedValue(answered(listModsReply([], [])));
    draw();
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "cbplayer2" },
    });
    await pickLevel("mod");
    expect(screen.queryByText("This is your own account")).toBeNull();
  });

  it("does not warn about self when the admin keeps their own account at admin", async () => {
    mpAdminCommand.mockResolvedValue(answered(listModsReply([], [])));
    draw();
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "cbadmin" },
    });
    await pickLevel("admin");
    expect(screen.queryByText("This is your own account")).toBeNull();
  });

  it("sends SETACCESS with the typed username and chosen level, and refreshes the list on success", async () => {
    mpAdminCommand
      .mockResolvedValueOnce(answered(listModsReply([], [])))
      .mockResolvedValueOnce(
        answered({ shape: "setAccess", success: true, message: "" }),
      )
      .mockResolvedValueOnce(answered(listModsReply([], ["cbplayer2"])));
    draw();
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "cbplayer2" },
    });
    await pickLevel("mod");
    fireEvent.click(screen.getByRole("button", { name: "Change access" }));

    expect(mpAdminCommand).toHaveBeenNthCalledWith(2, {
      serverKey: SERVER_KEY,
      command: "SETACCESS",
      args: ["cbplayer2", "mod"],
      shape: "setAccess",
    });
    expect(await screen.findByText("cbplayer2")).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenCalledTimes(3);
  });

  it("shows a failure and does not refresh the list", async () => {
    mpAdminCommand
      .mockResolvedValueOnce(answered(listModsReply([], [])))
      .mockResolvedValueOnce(
        answered({
          shape: "setAccess",
          success: false,
          message: "User not found.",
        }),
      );
    draw();
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "nobody" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change access" }));

    expect(await screen.findByText("The server refused")).toBeTruthy();
    expect(screen.getByText("User not found.")).toBeTruthy();
    expect(mpAdminCommand).toHaveBeenCalledTimes(2);
  });
});
