// @vitest-environment happy-dom

/**
 * `useIsServerAdmin` / `AdminOnly` (issue #2776): the gate later admin-only
 * sections (issues #2785-#2788) use to show a control only to an admin, never
 * to a moderator, on the connection the Server admin page is acting on.
 *
 * `useServerAdminKey` and `useMultiplayer` are mocked directly so this proves
 * the gate reads `ConnectionState.adminLevel` for the chosen connection,
 * rather than exercising the URL/search-param plumbing `useServerAdminKey`
 * itself already has its own tests for.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connections } from "./connections";

let connections: Connections = {};
let serverKey: string | null = null;

vi.mock("./store", () => ({
  useMultiplayer: () => ({ connections }),
}));

vi.mock("./useServerAdminKey", () => ({
  useServerAdminKey: () => [serverKey, () => {}],
}));

import { AdminOnly, useIsServerAdmin } from "./AdminOnly";

function connection(adminLevel: "mod" | "admin") {
  return { adminLevel } as unknown as Connections[string];
}

function Harness() {
  return <>{useIsServerAdmin() ? "admin" : "not admin"}</>;
}

afterEach(() => {
  cleanup();
  connections = {};
  serverKey = null;
});

describe("useIsServerAdmin", () => {
  it("is true for an admin's connection", () => {
    serverKey = "admin@uber.example:8200";
    connections = { [serverKey]: connection("admin") };
    render(<Harness />);
    expect(screen.getByText("admin")).toBeTruthy();
  });

  it("is false for a moderator's connection", () => {
    serverKey = "mod@uber.example:8200";
    connections = { [serverKey]: connection("mod") };
    render(<Harness />);
    expect(screen.getByText("not admin")).toBeTruthy();
  });

  it("is false with no connection chosen", () => {
    serverKey = null;
    render(<Harness />);
    expect(screen.getByText("not admin")).toBeTruthy();
  });
});

describe("AdminOnly", () => {
  it("shows its children to an admin", () => {
    serverKey = "admin@uber.example:8200";
    connections = { [serverKey]: connection("admin") };
    render(
      <AdminOnly>
        <span>Admin-only tool</span>
      </AdminOnly>,
    );
    expect(screen.getByText("Admin-only tool")).toBeTruthy();
  });

  it("renders nothing for a moderator", () => {
    serverKey = "mod@uber.example:8200";
    connections = { [serverKey]: connection("mod") };
    const { container } = render(
      <AdminOnly>
        <span>Admin-only tool</span>
      </AdminOnly>,
    );
    expect(screen.queryByText("Admin-only tool")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
