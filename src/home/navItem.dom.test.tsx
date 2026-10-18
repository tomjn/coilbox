// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useResolvedNavItem } from "./navItem";

/**
 * An external link whose address is a setting reads it through `useHref`
 * (issue #4584), because picoframe takes `href` as a fixed string.
 */
describe("useResolvedNavItem href", () => {
  it("is the item's href when it has no useHref", () => {
    const { result } = renderHook(() =>
      useResolvedNavItem({ id: "a", label: "A", href: "https://fixed.test" }),
    );
    expect(result.current.href).toBe("https://fixed.test");
  });

  it("is what useHref answers, over the fixed href", () => {
    const { result } = renderHook(() =>
      useResolvedNavItem({
        id: "a",
        label: "A",
        href: "https://fallback.test",
        useHref: () => "https://mine.test",
      }),
    );
    expect(result.current.href).toBe("https://mine.test");
  });
});
