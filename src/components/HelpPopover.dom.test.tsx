// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HelpPopover } from "./HelpPopover";

afterEach(cleanup);

const trigger = () => screen.getByRole("button", { name: "About mirroring" });

describe("HelpPopover", () => {
  it("shows nothing until its icon is pressed", () => {
    render(
      <HelpPopover label="About mirroring">
        <p>Across the centre line.</p>
      </HelpPopover>,
    );
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Across the centre line.")).toBeNull();
  });

  it("opens its text in a dialog named for what it explains", () => {
    render(
      <HelpPopover label="About mirroring">
        <p>Across the centre line.</p>
      </HelpPopover>,
    );
    fireEvent.click(trigger());
    const dialog = screen.getByRole("dialog", { name: "About mirroring" });
    expect(dialog.textContent).toBe("Across the centre line.");
  });

  it("closes on Escape and gives focus back to the icon", async () => {
    render(
      <HelpPopover label="About mirroring">
        <p>Across the centre line.</p>
      </HelpPopover>,
    );
    trigger().focus();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Across the centre line.")).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });
  });
});
