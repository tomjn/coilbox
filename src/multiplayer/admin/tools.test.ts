// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { visibleTools } from "./toolNav";
import { ADMIN_TOOLS } from "./tools";

/**
 * `ADMIN_TOOLS` itself (issue #2918), rather than a single tool's UI. The
 * Maintenance entry (issue #2785) is the first real `adminOnly` tool, so
 * this is where "hidden from a moderator" is proven against the real
 * registry rather than a rendering stand-in.
 */
describe("the Maintenance tool", () => {
  it("is admin-only", () => {
    const maintenance = ADMIN_TOOLS.find((tool) => tool.id === "maintenance");
    expect(maintenance?.adminOnly).toBe(true);
  });

  it("is offered to an admin and not to a moderator", () => {
    expect(
      visibleTools(ADMIN_TOOLS, true).some((tool) => tool.id === "maintenance"),
    ).toBe(true);
    expect(
      visibleTools(ADMIN_TOOLS, false).some(
        (tool) => tool.id === "maintenance",
      ),
    ).toBe(false);
  });
});

/** The Staff tool (issue #2786): `LISTMODS` and `SETACCESS` are both in
 * uberserver's `restricted['admin']` set, so the tool itself is admin-only,
 * the same as Maintenance. */
describe("the Staff tool", () => {
  it("is admin-only", () => {
    const staff = ADMIN_TOOLS.find((tool) => tool.id === "staff");
    expect(staff?.adminOnly).toBe(true);
  });

  it("is offered to an admin and not to a moderator", () => {
    expect(
      visibleTools(ADMIN_TOOLS, true).some((tool) => tool.id === "staff"),
    ).toBe(true);
    expect(
      visibleTools(ADMIN_TOOLS, false).some((tool) => tool.id === "staff"),
    ).toBe(false);
  });
});
