// @vitest-environment happy-dom

/**
 * What the new-project drawer says about an empty game list when the scan's
 * unitsync `Init` failed (issue #3398).
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectDetailsDrawer } from "./ProjectDetailsDrawer";

afterEach(cleanup);

function renderDrawer(scanFailure?: string) {
  render(
    <ProjectDetailsDrawer
      open
      onOpenChange={() => {}}
      games={[]}
      scanning={false}
      scanFailure={scanFailure}
      existing={[]}
      onSubmit={() => {}}
    />,
  );
}

describe("ProjectDetailsDrawer with no games listed", () => {
  it("says the scan failed, not that no games are installed", () => {
    renderDrawer("no space left");
    expect(screen.queryByText(/No games are installed/)).toBeNull();
    expect(screen.getByText(/no space left/)).toBeTruthy();
  });

  it("says no games are installed when the scan answered", () => {
    renderDrawer(undefined);
    expect(screen.getByText(/No games are installed/)).toBeTruthy();
  });
});
