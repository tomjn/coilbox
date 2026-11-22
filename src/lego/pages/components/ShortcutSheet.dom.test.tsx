// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getNavigationPreset,
  resetNavigationPresetCache,
  setNavigationPreset,
} from "../../cameraNavigationStore";
import {
  getShortcutOverrides,
  resetShortcutOverridesCache,
} from "../../shortcutOverridesStore";
import { isShortcut } from "../../shortcuts";
import { ShortcutSheet } from "./ShortcutSheet";

beforeEach(() => {
  localStorage.clear();
  resetNavigationPresetCache();
  resetShortcutOverridesCache();
});
afterEach(cleanup);

describe("the sheet's layout (#5405)", () => {
  it("scrolls its body below a header that stays put, within the window", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const body = screen.getByTestId("shortcut-body");
    const title = screen.getByText("Keyboard shortcuts");
    expect(dialog.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("min-h-0");
    expect(body.contains(title)).toBe(false);
    expect(dialog.contains(body)).toBe(true);
  });

  it("puts Camera first in the body, ahead of Transform", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    const headings = [
      ...screen.getByTestId("shortcut-body").querySelectorAll("h3"),
    ].map((heading) => heading.textContent);
    expect(headings[0]).toBe("Camera");
    expect(headings[1]).toBe("Transform");
  });
});

describe("the camera navigation setting", () => {
  it("defaults to Coilbox and lists its mouse controls", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    expect(getNavigationPreset()).toBe("coilbox");
    expect(screen.getByText("Left drag")).toBeTruthy();
  });

  it("lists the saved preset's controls", () => {
    localStorage.setItem("coilbox.lego.cameraNavigation", "3dsmax");
    resetNavigationPresetCache();
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("Ctrl + Alt + Middle drag")).toBeTruthy();
    expect(screen.queryByText("Left drag")).toBeNull();
  });

  it("saves a new choice and updates the list", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    fireEvent.click(
      screen.getByRole("combobox", { name: "Camera navigation" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Blender" }));
    expect(getNavigationPreset()).toBe("blender");
    expect(localStorage.getItem("coilbox.lego.cameraNavigation")).toBe(
      "blender",
    );
    expect(screen.getByText("Shift + Middle drag")).toBeTruthy();
    setNavigationPreset("coilbox");
  });
});

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...init });
}

describe("rebinding a shortcut", () => {
  function startChanging(description: string) {
    fireEvent.click(
      screen.getByRole("button", { name: `Change ${description}` }),
    );
  }

  it("saves the keys pressed after choosing a row", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    startChanging("Move the selection");
    fireEvent.keyDown(document.body, { key: "q" });
    expect(getShortcutOverrides().translate).toEqual({
      key: "q",
      mod: false,
      shift: false,
    });
    expect(localStorage.getItem("coilbox.lego.shortcutOverrides")).toContain(
      "translate",
    );
    expect(isShortcut("translate", press("q"))).toBe(true);
    expect(isShortcut("translate", press("g"))).toBe(false);
    expect(screen.getByText("Q")).toBeTruthy();
  });

  it("takes modifiers into the combo", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    startChanging("Move the selection");
    fireEvent.keyDown(document.body, { key: "q", ctrlKey: true });
    expect(getShortcutOverrides().translate).toEqual({
      key: "q",
      mod: true,
      shift: false,
    });
  });

  it("cancels on Escape without changing anything", () => {
    const onOpenChange = vi.fn();
    render(<ShortcutSheet open onOpenChange={onOpenChange} />);
    startChanging("Move the selection");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(getShortcutOverrides()).toEqual({});
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Press the new keys")).toBeNull();
  });

  it("refuses a combo another shortcut uses and names that shortcut", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    startChanging("Move the selection");
    fireEvent.keyDown(document.body, { key: "r" });
    expect(getShortcutOverrides()).toEqual({});
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Turn the selection");
    expect(screen.getByText("Press the new keys")).toBeTruthy();
  });

  it("refuses a bare modifier", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    startChanging("Move the selection");
    fireEvent.keyDown(document.body, { key: "Shift", shiftKey: true });
    expect(getShortcutOverrides()).toEqual({});
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("offers no way to change the Alt hold or the modified click", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    expect(screen.getAllByText("Fixed").length).toBe(2);
  });

  it("resets one shortcut, then all of them", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    startChanging("Move the selection");
    fireEvent.keyDown(document.body, { key: "q" });
    startChanging("Turn the selection");
    fireEvent.keyDown(document.body, { key: "x" });
    expect(Object.keys(getShortcutOverrides()).sort()).toEqual([
      "rotate",
      "translate",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Reset Move the selection" }),
    );
    expect(Object.keys(getShortcutOverrides())).toEqual(["rotate"]);
    expect(screen.getByText("G")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Reset all shortcuts" }),
    );
    expect(getShortcutOverrides()).toEqual({});
    expect(localStorage.getItem("coilbox.lego.shortcutOverrides")).toBeNull();
  });
});
