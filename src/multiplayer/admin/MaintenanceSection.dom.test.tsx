// @vitest-environment happy-dom

/**
 * The Maintenance tool of the Server admin page (issue #2785): uberserver's
 * four server-wide admin commands. The queue and the reply parsing are
 * Rust's and tested there (`admin_reply.rs`, `admin_command.rs`). This
 * covers what the section sends, what its confirm steps do (and do not do
 * until confirmed), and how it shows each outcome.
 *
 * Whether the tool itself is hidden from a moderator is `tools.test.ts`'s,
 * against the real `ADMIN_TOOLS` registry.
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
// for so the content is always drawn, matching PlayerLookupSection.dom.test.tsx.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const mpAdminCommand = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<AdminOutcome>>(),
);
vi.mock("../bindings", () => ({ mpAdminCommand }));

import { MaintenanceSection } from "./MaintenanceSection";

const SERVER_KEY = "admin@uber.example:8200";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
});

function answered(reply: AdminReply): AdminOutcome {
  return { outcome: "answered", reply };
}

function refused(reason: string): AdminOutcome {
  return { outcome: "refused", reason };
}

function draw() {
  render(<MaintenanceSection serverKey={SERVER_KEY} />);
}

describe("the minimum engine version action", () => {
  it("sends nothing until the version is typed and Set version is clicked", () => {
    draw();
    const set = screen.getByRole("button", { name: "Set version" });
    expect(set).toHaveProperty("disabled", true);
    expect(mpAdminCommand).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Minimum engine version"), {
      target: { value: "105.0" },
    });
    expect(set).toHaveProperty("disabled", false);
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("sends SETMINSPRINGVERSION with the typed version and shows the reply", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "setMinSpringVersion", version: "105.0" }),
    );
    draw();
    fireEvent.change(screen.getByLabelText("Minimum engine version"), {
      target: { value: "105.0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set version" }));
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "SETMINSPRINGVERSION",
      args: ["105.0"],
      shape: "setMinSpringVersion",
    });
    expect(await screen.findByText("Set to 105.0.")).toBeTruthy();
  });

  it("shows the server's refusal for a moderator without rights", async () => {
    mpAdminCommand.mockResolvedValueOnce(refused("Insufficient rights."));
    draw();
    fireEvent.change(screen.getByLabelText("Minimum engine version"), {
      target: { value: "105.0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set version" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Insufficient rights.");
  });
});

describe("the server statistics action", () => {
  it("says beside the button that nothing is shown here, before it is even clicked", () => {
    draw();
    expect(screen.getByText(/Nothing is shown here/)).toBeTruthy();
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("sends STATS and shows it was done", async () => {
    mpAdminCommand.mockResolvedValueOnce(answered({ shape: "stats" }));
    draw();
    fireEvent.click(
      screen.getByRole("button", { name: "Write stats to the server log" }),
    );
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "STATS",
      args: [],
      shape: "stats",
    });
    expect(await screen.findByText("Done.")).toBeTruthy();
  });
});

describe("the reload action", () => {
  it("sends nothing until Reload is clicked in the confirm step", () => {
    draw();
    expect(
      screen.getByRole("heading", { name: "Reload the server's code?" }),
    ).toBeTruthy();
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("sends RELOAD and shows success", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "reload",
        success: true,
        message: "Reload successful",
      }),
    );
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "RELOAD",
      args: [],
      shape: "reload",
    });
    expect(await screen.findByText("Reload successful")).toBeTruthy();
  });

  it("shows a failed reload as a refusal-style alert", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({ shape: "reload", success: false, message: "Reload failed" }),
    );
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Reload failed");
    expect(screen.getByText("The reload failed")).toBeTruthy();
  });
});

describe("the cleanup action", () => {
  it("sends nothing until Clean up is clicked in the confirm step", () => {
    draw();
    expect(
      screen.getByRole("heading", { name: "Clean up server state?" }),
    ).toBeTruthy();
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("sends CLEANUP and shows the result", async () => {
    mpAdminCommand.mockResolvedValueOnce(
      answered({
        shape: "cleanup",
        message: "Cleanup complete: 0 deletions, 0 mismatches",
      }),
    );
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Clean up" }));
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "CLEANUP",
      args: [],
      shape: "cleanup",
    });
    expect(
      await screen.findByText("Cleanup complete: 0 deletions, 0 mismatches"),
    ).toBeTruthy();
  });

  it("explains a silent failure as unanswered", async () => {
    mpAdminCommand.mockResolvedValueOnce({ outcome: "unanswered" });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Clean up" }));
    expect(
      await screen.findByText(/A cleanup that raised an error on the server/),
    ).toBeTruthy();
  });
});
