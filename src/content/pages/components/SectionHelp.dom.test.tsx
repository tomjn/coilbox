// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const { REPLAY_SOURCE_NOTES, REPLAY_SOURCES_DOC_URL } = await import(
  "../../replaySources"
);
const { SectionHelp } = await import("./SectionHelp");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const trigger = () => screen.getByRole("button", { name: "About Players" });

describe("SectionHelp", () => {
  it("is a real button with a name, and shows nothing until it is opened", () => {
    render(
      <SectionHelp section="Players">
        <p>A long explanation.</p>
      </SectionHelp>,
    );
    expect(trigger().tagName).toBe("BUTTON");
    expect(trigger().getAttribute("type")).toBe("button");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("A long explanation.")).toBeNull();
  });

  it("opens on click and puts the content in a named dialog", () => {
    render(
      <SectionHelp section="Players">
        <p>A long explanation.</p>
      </SectionHelp>,
    );
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("A long explanation.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "About Players" })).toBeTruthy();
  });

  it("closes on Escape and gives focus back to the button", async () => {
    render(
      <SectionHelp section="Players">
        <p>A long explanation.</p>
      </SectionHelp>,
    );
    trigger().focus();
    fireEvent.click(trigger());
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
      // Radix hands focus back on the next tick.
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.queryByText("A long explanation.")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("puts the source line first and the docs link last", () => {
    render(
      <SectionHelp section="Players" source="trailer" detail="Every 15 s.">
        <p>Middle.</p>
      </SectionHelp>,
    );
    fireEvent.click(trigger());
    const dialog = screen.getByRole("dialog");
    const kids = Array.from(dialog.children);
    expect(kids[0].textContent).toBe(
      `${REPLAY_SOURCE_NOTES.trailer} Every 15 s.`,
    );
    expect(kids[1].textContent).toBe("Middle.");
    const link = kids[kids.length - 1];
    expect(link.textContent).toBe("Where these numbers come from");
    fireEvent.click(link);
    expect(openUrl).toHaveBeenCalledWith(REPLAY_SOURCES_DOC_URL);
  });

  it("names the source in words a player can read", () => {
    expect(REPLAY_SOURCE_NOTES.stream).toMatch(/orders/);
    expect(REPLAY_SOURCE_NOTES.trailer).toMatch(/engine/);
    expect(REPLAY_SOURCE_NOTES.players).toContain(REPLAY_SOURCE_NOTES.setup);
  });
});
