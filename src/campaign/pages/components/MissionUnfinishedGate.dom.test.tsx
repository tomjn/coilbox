// @vitest-environment happy-dom
/**
 * What a mission that was never finished says for itself (issue #2245).
 *
 * The card it replaces offers a download, and this one is the reason that card
 * is no longer shown for an unnamed map: a download of "" fixes nothing. So the
 * test worth having is that this card names the real problem and offers no
 * download at all.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The card reads the still-UI setting through the app frame, which a card
// rendered on its own is not inside. Nothing here is about reduced motion.
vi.mock("../../../general/display", () => ({ useStillUi: () => false }));

import { MissionUnfinishedGate } from "./MissionUnfinishedGate";

afterEach(cleanup);

function show(reason: string) {
  render(
    <MemoryRouter>
      <MissionUnfinishedGate campaignId="c1" reason={reason} />
    </MemoryRouter>,
  );
}

describe("the gate on an unfinished mission", () => {
  it("says what the mission is short of", () => {
    show("Mission 3 has no map");

    expect(screen.getByText("Mission 3 has no map")).toBeTruthy();
    expect(screen.getByRole("heading").textContent).toBe("Unfinished mission");
  });

  it("offers no download", () => {
    show("Mission 3 has no map");

    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.queryByText(/download/i, { selector: "button, a" }),
    ).toBeNull();
  });

  it("leads back to the campaign", () => {
    show("Mission 1 has no game or map");

    expect(
      screen
        .getByRole("link", { name: "Back to campaign" })
        .getAttribute("href"),
    ).toBe("/campaign/c1");
  });
});
