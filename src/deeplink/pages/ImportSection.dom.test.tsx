// @vitest-environment happy-dom

/**
 * The import box: the clipboard offer (issue #1344), what it says it takes
 * (issue #1515), and which code a deep link hands it.
 *
 * macOS WKWebView refuses `navigator.clipboard.readText()` with no user gesture
 * behind it, so the box reads the clipboard through Tauri's clipboard plugin
 * instead. These tests stand in for the plugin and check what the box does with
 * each answer it can give.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, type NavigateFunction, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTAINER_KINDS } from "@/container/container";
import { containerKindName } from "@/container/names";
import { encodeChallenge } from "../../challenge/code";

const readText = vi.fn<() => Promise<string>>();
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: () => readText(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
vi.mock("../bindings", () => ({ importContainerFile: async () => ({}) }));

const { default: ImportSection } = await import("./ImportSection");

let navigate: NavigateFunction = () => {};
function CaptureNavigate() {
  navigate = useNavigate();
  return null;
}

function renderBox() {
  return render(
    <MemoryRouter>
      <CaptureNavigate />
      <ImportSection />
    </MemoryRouter>,
  );
}

const warpath = (shortname: string) =>
  encodeChallenge("warpath", { seed: 7, nodes: 12, game: { shortname } });

const OFFER = /Your clipboard holds/;

beforeEach(() => {
  readText.mockReset();
});

afterEach(cleanup);

describe("the import box's clipboard offer", () => {
  it("offers a share code the clipboard holds", async () => {
    readText.mockResolvedValue(warpath("BA"));
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

describe("the import box", () => {
  it("names every kind a container can hold in its help", () => {
    readText.mockRejectedValue(new Error("clipboard is empty"));
    renderBox();
    fireEvent.click(screen.getByRole("button", { name: "About importing" }));
    const help = screen.getByRole("dialog", { name: "About importing" });
    for (const kind of CONTAINER_KINDS) {
      expect(help.textContent).toContain(`a ${containerKindName(kind)}`);
    }
  });

  it("labels the paste box", () => {
    readText.mockRejectedValue(new Error("clipboard is empty"));
    renderBox();
    expect(screen.getByLabelText("Code, link or file").tagName).toBe(
      "TEXTAREA",
    );
  });

  it("takes a deep-linked code after the clipboard offer was used", async () => {
    readText.mockResolvedValue(warpath("BA"));
    renderBox();
    fireEvent.click(await screen.findByRole("button", { name: "Use it" }));
    expect(
      await screen.findByText("Import a warpath challenge for BA"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    act(() => navigate(`/?import=${encodeURIComponent(warpath("ZK"))}`));
    expect(
      await screen.findByText("Import a warpath challenge for ZK"),
    ).toBeTruthy();
  });
});
