import { describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";

// The app imports this module before it activates a locale, and Lingui throws
// on a lookup with no locale, so nothing may be translated while it loads.
describe("animPresets at load", () => {
  it("looks up no message until a label is read", async () => {
    vi.resetModules();
    const lookup = vi.spyOn(i18n, "_");
    const { ROLES } = await import("./animPresets");
    expect(lookup).not.toHaveBeenCalled();
    expect(ROLES.find((role) => role.id === "leg.l1.thigh")?.label).toBe(
      "Front left thigh",
    );
    lookup.mockRestore();
  });
});
