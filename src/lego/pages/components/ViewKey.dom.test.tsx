// @vitest-environment happy-dom

/**
 * The line at the foot of the view, and what four views leave out of it
 * (#5410).
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ViewKey } from "./ViewKey";

afterEach(cleanup);

function key(fourViews: boolean) {
  return render(
    <ViewKey
      fourViews={fourViews}
      pieceDots="box"
      collision={null}
      aimPoint={false}
      guides={false}
      balance={null}
      overlap={null}
      reaches={[]}
      hint="Hold Alt to place freely"
    />,
  );
}

describe("the view's key", () => {
  it("has the hint in one view", () => {
    key(false);
    expect(screen.getByText("Hold Alt to place freely")).toBeTruthy();
    expect(screen.getByText("Turns here")).toBeTruthy();
  });

  it("leaves the hint out in four views, and keeps the key", () => {
    key(true);
    expect(screen.queryByText("Hold Alt to place freely")).toBeNull();
    expect(screen.getByText("Turns here")).toBeTruthy();
    expect(screen.getByText("Faces")).toBeTruthy();
  });

  it("does not say the footprint, which the Game tab does", () => {
    key(false);
    expect(screen.queryByText(/^Footprint/)).toBeNull();
  });
});
