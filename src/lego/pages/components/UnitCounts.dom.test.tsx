// @vitest-environment happy-dom

/** The counts readout: both columns, labelled, with the numbers as given. */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UnitCounts } from "./UnitCounts";

afterEach(cleanup);

describe("UnitCounts", () => {
  it("shows the unit's counts beside the reference's, with no verdict", () => {
    render(
      <UnitCounts
        unit={{ pieces: 3, triangles: 1200, vertices: 3600 }}
        reference={{ pieces: 1, triangles: 370, vertices: 900 }}
        referenceLabel="Solar collector (a building)"
      />,
    );
    const table = screen.getByRole("table", { name: "Unit counts" });
    expect(
      within(table).getByRole("columnheader", {
        name: "Solar collector (a building)",
      }),
    ).toBeTruthy();
    const triangles = within(table)
      .getByRole("row", { name: /Triangles/ })
      .textContent?.replace(/\s/g, "");
    expect(triangles).toBe("Triangles1,200370".replace(/\s/g, ""));
    expect(table.textContent).not.toMatch(/too|limit|exceed/i);
  });
});
