// @vitest-environment happy-dom

/**
 * Regression test for issue #3208: Progress computed the fill's transform
 * from `value` but never forwarded `value` to ProgressPrimitive.Root, so
 * Radix always treated the bar as indeterminate and never set
 * aria-valuenow, whatever value it was given.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "./progress";

describe("Progress", () => {
  it("reports a partial value to assistive tech", () => {
    const { container } = render(<Progress value={40} />);
    const root = container.querySelector('[data-slot="progress"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute("aria-valuenow")).toBe("40");
    expect(root?.getAttribute("data-state")).toBe("loading");
  });

  it("reports completion once the value reaches max", () => {
    const { container } = render(<Progress value={100} />);
    const root = container.querySelector('[data-slot="progress"]');
    expect(root?.getAttribute("aria-valuenow")).toBe("100");
    expect(root?.getAttribute("data-state")).toBe("complete");
  });

  it("stays indeterminate when no value is given", () => {
    const { container } = render(<Progress />);
    const root = container.querySelector('[data-slot="progress"]');
    expect(root?.hasAttribute("aria-valuenow")).toBe(false);
    expect(root?.getAttribute("data-state")).toBe("indeterminate");
  });
});
