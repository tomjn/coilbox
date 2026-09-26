// @vitest-environment happy-dom

/**
 * Regression test for issue #3098: the shared TooltipContent had no maximum
 * width, so a long help string ran across the whole window instead of
 * wrapping. `w-fit` on its own does not stop that, so the class list itself
 * is the thing worth asserting on.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

describe("TooltipContent", () => {
  it("caps its width so long help text wraps", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>trigger</TooltipTrigger>
          <TooltipContent>long help text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    // TooltipContent renders through a portal, so it lands in document.body
    // rather than inside the container render() returns.
    const content = document.body.querySelector(
      '[data-slot="tooltip-content"]',
    );
    expect(content).not.toBeNull();
    expect(content?.className).toMatch(/\bmax-w-xs\b/);
  });
});
