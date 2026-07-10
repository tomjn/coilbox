import { describe, expect, it } from "vitest";
import { route } from "./route";

describe("route", () => {
  it("uses a toast when the window is focused", () => {
    expect(route(true, true, true)).toBe("toast");
  });

  it("uses the OS when unfocused, enabled, and permission granted", () => {
    expect(route(false, true, true)).toBe("os");
  });

  it("falls back to a toast when OS notifications are disabled", () => {
    expect(route(false, false, true)).toBe("toast");
  });

  it("falls back to a toast when permission is not granted", () => {
    expect(route(false, true, false)).toBe("toast");
  });
});
