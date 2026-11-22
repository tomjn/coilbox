// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getNavigationPreset,
  resetNavigationPresetCache,
  setNavigationPreset,
} from "../../cameraNavigationStore";
import { ShortcutSheet } from "./ShortcutSheet";

beforeEach(() => {
  localStorage.clear();
  resetNavigationPresetCache();
});
afterEach(cleanup);

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
