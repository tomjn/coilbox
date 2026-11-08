// @vitest-environment happy-dom

/**
 * The clipboard offer in the import box (issue #1344).
 *
 * macOS WKWebView refuses `navigator.clipboard.readText()` with no user gesture
 * behind it, so the box reads the clipboard through Tauri's clipboard plugin
 * instead. These tests stand in for the plugin and check what the box does with
 * each answer it can give.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeChallenge } from "../../challenge/code";

const readText = vi.fn<() => Promise<string>>();
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: () => readText(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
vi.mock("../bindings", () => ({ importContainerFile: async () => ({}) }));

const { default: ImportSection } = await import("./ImportSection");

function renderBox() {
  return render(
    <MemoryRouter>
      <ImportSection />
    </MemoryRouter>,
  );
}

const OFFER = /Your clipboard holds/;

beforeEach(() => {
  readText.mockReset();
});

afterEach(cleanup);

describe("the import box's clipboard offer", () => {
  it("offers a share code the clipboard holds", async () => {
    readText.mockResolvedValue(
      encodeChallenge("warpath", {
        seed: 7,
        nodes: 12,
        game: { shortname: "BA" },
      }),
    );
    renderBox();
    expect(
      await screen.findByText(
        "Your clipboard holds a warpath challenge for BA.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use it" })).toBeTruthy();
  });

  it("offers a coilbox link the clipboard holds", async () => {
    readText.mockResolvedValue("coilbox://open?screen=battles");
    renderBox();
    expect(
      await screen.findByText("Your clipboard holds a coilbox link."),
    ).toBeTruthy();
  });

  it("offers nothing for text coilbox does not recognise", async () => {
    readText.mockResolvedValue("the quick brown fox");
    renderBox();
    await waitFor(() => expect(readText).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByText(OFFER)).toBeNull();
  });

  it("offers nothing for an empty clipboard", async () => {
    readText.mockResolvedValue("");
    renderBox();
    await waitFor(() => expect(readText).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByText(OFFER)).toBeNull();
  });

  it("says nothing when the read fails, and the box still works", async () => {
    readText.mockRejectedValue(new Error("clipboard is empty"));
    renderBox();
    await waitFor(() => expect(readText).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByText(OFFER)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
  });
});
