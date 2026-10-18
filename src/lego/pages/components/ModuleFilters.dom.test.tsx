// @vitest-environment happy-dom

/**
 * The module list's filter row (issue #3298). `../../moduleFilter.test.ts`
 * covers what a query keeps, and `DetailPanel.dom.test.tsx` the fields that
 * label a module.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModuleFilters, NoModuleMatches } from "./ModuleFilters";

afterEach(cleanup);

describe("the module filter row", () => {
  it("reports what is typed into the search box", () => {
    const onQuery = vi.fn();
    render(
      <ModuleFilters
        compounds={[]}
        query=""
        onQuery={onQuery}
        category={null}
        onCategory={vi.fn()}
        shown={0}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search modules"), {
      target: { value: "gun" },
    });
    expect(onQuery).toHaveBeenCalledWith("gun");
  });

  it("says how many modules the grid is showing", () => {
    render(
      <ModuleFilters
        compounds={[]}
        query=""
        onQuery={vi.fn()}
        category={null}
        onCategory={vi.fn()}
        shown={1}
      />,
    );
    expect(screen.getByText("1 module")).toBeTruthy();
  });

  it("says so when a filter hides everything", () => {
    render(<NoModuleMatches />);
    expect(screen.getByText(/No module matches/)).toBeTruthy();
  });
});
