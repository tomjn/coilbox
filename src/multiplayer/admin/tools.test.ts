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
