// @vitest-environment happy-dom

/**
 * What the module list says when a filter hides every module (issue #3298).
 * `../../moduleFilter.test.ts` covers what a query keeps, and
 * `Inventory.dom.test.tsx` the category menu.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NoModuleMatches } from "./ModuleFilters";

afterEach(cleanup);

describe("the empty module list", () => {
  it("says so when a filter hides everything", () => {
    render(<NoModuleMatches />);
    expect(screen.getByText(/No module matches/)).toBeTruthy();
  });
});
