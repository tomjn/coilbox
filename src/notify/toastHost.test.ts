import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `NotifyProvider` mounts no toast host (issue #4901), because picoframe's
 * layout mounts one. If a release stops doing that, no toast is drawn anywhere
 * and nothing else fails.
 */
describe("the toast host the layout mounts", () => {
  it("is still mounted by picoframe's AppLayout", () => {
    const layout = readFileSync(
      fileURLToPath(
        new URL(
          "../../node_modules/@picoframe/frame/dist/layout/AppLayout.js",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(
      layout.includes("_jsx(Toaster,"),
      "@picoframe/frame's AppLayout no longer mounts a Toaster, and " +
        "NotifyProvider mounts none, so no toast is drawn anywhere. Mount a " +
        "host once, wherever the layout stops doing it.",
    ).toBe(true);
  });
});
