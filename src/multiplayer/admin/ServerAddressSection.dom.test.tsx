// @vitest-environment happy-dom

/**
 * The server address tools of the Server admin page (issue #2782):
 * ChanServ's `:showip` for moderators and `:refreship` for admins only.
 * `:refreship` is answered twice, a few seconds apart, and the Rust queue
 * keeps the request open for both (`admin_command.rs`). This covers what the
 * section sends, what it shows, and that a moderator never sees the refresh.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminOutcome, AdminReply } from "../bindings";
import type { Connections } from "../connections";

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}));

const mpAdminCommand = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<AdminOutcome>>(),
);
vi.mock("../bindings", () => ({ mpAdminCommand }));

const SERVER_KEY = "mod@uber.example:8200";
const wire = vi.hoisted(() => ({ adminLevel: "mod" as "mod" | "admin" }));

vi.mock("../store", () => ({
  useMultiplayer: () => ({
    connections: {
      [SERVER_KEY]: { adminLevel: wire.adminLevel },
    } as unknown as Connections,
  }),
}));

vi.mock("../useServerAdminKey", () => ({
  useServerAdminKey: () => [SERVER_KEY, () => {}],
}));

import { ServerAddressSection } from "./ServerAddressSection";

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
  wire.adminLevel = "mod";
});

function draw() {
  render(<ServerAddressSection serverKey={SERVER_KEY} />);
}

function answered(reply: AdminReply): AdminOutcome {
  return { outcome: "answered", reply };
}

const PINNED =
  "Refreshing server IP. Note ONLINE_IP/--onlineip is pinned to 127.0.0.1, so the online IP will not change.";
const UNCHANGED =
  "IP refresh complete. Unchanged: online 127.0.0.1, local 127.0.0.1";

describe("showing the server's address", () => {
  it("sends :showip and shows both addresses and their overrides", async () => {
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "showIp",
        onlineIp: "203.0.113.7",
        onlineOverride: null,
        localIp: "10.0.0.2",
        localOverride: "10.0.0.2",
      }),
    );
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Show server IP" }));
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "showip",
      args: [],
      shape: "showIp",
    });
    expect(await screen.findByText("203.0.113.7")).toBeTruthy();
    expect(screen.getByText("Looked up by the server")).toBeTruthy();
    expect(screen.getByText("10.0.0.2")).toBeTruthy();
    expect(screen.getByText("Pinned to 10.0.0.2")).toBeTruthy();
  });

  it("shows a refusal", async () => {
    const reason =
      "You must be a moderator or admin to view server IP configuration";
    mpAdminCommand.mockResolvedValue({ outcome: "refused", reason });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Show server IP" }));
    expect(await screen.findByText(reason)).toBeTruthy();
  });
});

describe("refreshing the server's address", () => {
  it("is hidden from a moderator", () => {
    draw();
    expect(
      screen.getByRole("heading", { name: "Server address" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Refresh server IP" }),
    ).toBeNull();
  });

  it("shows both of ChanServ's replies to an admin", async () => {
    wire.adminLevel = "admin";
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "refreshIp",
        started: PINNED,
        result: UNCHANGED,
        failed: false,
      }),
    );
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Refresh server IP" }));
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: SERVER_KEY,
      command: "refreship",
      args: [],
      shape: "refreshIp",
    });
    expect(await screen.findByText(PINNED)).toBeTruthy();
    expect(screen.getByText(UNCHANGED)).toBeTruthy();
  });

  it("says so while the lookup runs", () => {
    wire.adminLevel = "admin";
    mpAdminCommand.mockReturnValue(new Promise(() => {}));
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Refresh server IP" }));
    expect(screen.getByText(/can take up to a minute/)).toBeTruthy();
  });

  it("says when the result never came", async () => {
    wire.adminLevel = "admin";
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "refreshIp",
        started: PINNED,
        result: null,
        failed: false,
      }),
    );
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Refresh server IP" }));
    expect(
      await screen.findByText(/did not report the result in time/),
    ).toBeTruthy();
  });

  it("shows a failed lookup as an alert", async () => {
    wire.adminLevel = "admin";
    mpAdminCommand.mockResolvedValue(
      answered({
        shape: "refreshIp",
        started: PINNED,
        result: "IP refresh failed: timed out",
        failed: true,
      }),
    );
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Refresh server IP" }));
    expect(await screen.findByText("The refresh failed")).toBeTruthy();
    expect(screen.getByText("IP refresh failed: timed out")).toBeTruthy();
  });

  it("shows a refusal", async () => {
    wire.adminLevel = "admin";
    const reason = "An IP refresh is already in progress, please wait.";
    mpAdminCommand.mockResolvedValue({ outcome: "refused", reason });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Refresh server IP" }));
    expect(await screen.findByText(reason)).toBeTruthy();
  });
});
