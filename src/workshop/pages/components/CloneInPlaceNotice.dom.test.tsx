// @vitest-environment happy-dom
/**
 * Whether a copy's own unwritable changes are shown, and whether sending it
 * to the mutator route can be toggled (issue #3035).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloneInPlaceNotice } from "./CloneInPlaceNotice";

afterEach(cleanup);

describe("a copy the edit-in-place route cannot fully write", () => {
  it("says nothing while checking and nothing has been found yet", () => {
    render(
      <CloneInPlaceNotice
        unitName="Dragonfly Mk2"
        unwritable={null}
        checking={true}
        error={null}
        routed={false}
        onRoute={() => {}}
      />,
    );
    expect(screen.queryByText(/cannot be written/)).toBeNull();
  });

  it("says nothing once checked when every change can be written", () => {
    render(
      <CloneInPlaceNotice
        unitName="Dragonfly Mk2"
        unwritable={[]}
        checking={false}
        error={null}
        routed={false}
        onRoute={() => {}}
      />,
    );
    expect(screen.queryByText(/cannot be written/)).toBeNull();
  });

  it("names each unwritable change and offers the mutator route for the whole copy", () => {
    const onRoute = vi.fn();
    render(
      <CloneInPlaceNotice
        unitName="Dragonfly Mk2"
        unwritable={[
          { field: "featuredefs", message: "The copy adds a table." },
        ]}
        checking={false}
        error={null}
        routed={false}
        onRoute={onRoute}
      />,
    );
    expect(
      screen.getByText(/1 change to Dragonfly Mk2 cannot be written/),
    ).toBeTruthy();
    const item = screen.getByText("featuredefs").closest("li");
    expect(item?.textContent).toBe("featuredefs: The copy adds a table.");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Send Dragonfly Mk2 through the mutator route",
      }),
    );
    expect(onRoute).toHaveBeenCalledWith(true);
  });

  it("keeps showing the offer once routed, and can undo it", () => {
    const onRoute = vi.fn();
    render(
      <CloneInPlaceNotice
        unitName="Dragonfly Mk2"
        unwritable={[
          { field: "featuredefs", message: "The copy adds a table." },
        ]}
        checking={false}
        error={null}
        routed={true}
        onRoute={onRoute}
      />,
    );
    expect(
      screen.getByText(
        "Goes through the mutator route. Writing in place skips this whole copy.",
      ),
    ).toBeTruthy();
    // The field-by-field explanation is only useful while deciding, not once
    // the choice is made.
    expect(screen.queryByText("featuredefs")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Stop sending Dragonfly Mk2 through the mutator route",
      }),
    );
    expect(onRoute).toHaveBeenCalledWith(false);
  });

  it("reports an error rather than a verdict when the check itself failed", () => {
    render(
      <CloneInPlaceNotice
        unitName="Dragonfly Mk2"
        unwritable={null}
        checking={false}
        error="the game could not be read"
        routed={false}
        onRoute={() => {}}
      />,
    );
    expect(
      screen.getByText(/could not check whether Dragonfly Mk2/),
    ).toBeTruthy();
  });
});
