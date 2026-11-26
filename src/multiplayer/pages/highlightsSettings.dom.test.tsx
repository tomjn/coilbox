// @vitest-environment happy-dom

/**
 * The Chat highlights settings page. Add word puts the cursor in the new row,
 * so you can type the word straight away.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useSetting: (_key: string, fallback: unknown) => useState(fallback),
}));

import HighlightsSettings from "./HighlightsSettings";

afterEach(() => {
  cleanup();
});

function renderPage() {
  render(
    <MemoryRouter>
      <HighlightsSettings />
    </MemoryRouter>,
  );
}

it("shows the empty state with no words", () => {
  renderPage();
  screen.getByText("No highlight words.");
});

it("focuses the row Add word makes", () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Add word" }));
  const first = screen.getByRole("textbox", { name: "Highlight word" });
  expect(document.activeElement).toBe(first);

  fireEvent.click(screen.getByRole("button", { name: "Add word" }));
  const rows = screen.getAllByRole("textbox", { name: "Highlight word" });
  expect(rows).toHaveLength(2);
  expect(document.activeElement).toBe(rows[1]);
});

it("removes a word", () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Add word" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Highlight word" }), {
    target: { value: "alice" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove alice" }));
  screen.getByText("No highlight words.");
});
