// @vitest-environment happy-dom

/**
 * The map compiler settings page. Turning Remember folders off forgets the
 * folders already remembered, since the Compile and Decompile pickers read
 * them whatever the switch says. A failed tool check says so rather than
 * showing "Checking…" for ever.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Config } from "../bindings";

const mcProbe = vi.hoisted(() => vi.fn());
const setCfg = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ cfg: {} as Config }));

vi.mock("../bindings", () => ({ mcProbe }));
vi.mock("../config", () => ({
  useMapconvConfig: () => [state.cfg, setCfg],
}));

import MapconvSettings from "./SettingsSection";

beforeEach(() => {
  mcProbe.mockReset();
  setCfg.mockReset();
  state.cfg = {
    defaultCompressionType: 4,
    rememberDirs: true,
    lastTextureDir: "/maps/src",
    lastOutDir: "/maps/out",
    lastSmfDir: "/maps/smf",
  };
});

afterEach(() => {
  cleanup();
});

it("forgets the remembered folders when Remember folders is turned off", async () => {
  mcProbe.mockResolvedValue({ compile: true, decompile: true });
  render(<MapconvSettings />);
  fireEvent.click(screen.getByRole("switch", { name: "Remember folders" }));
  expect(setCfg).toHaveBeenCalledWith({
    defaultCompressionType: 4,
    rememberDirs: false,
    lastTextureDir: undefined,
    lastOutDir: undefined,
    lastSmfDir: undefined,
  });
  await screen.findAllByText("Found");
});

it("shows which tools were found", async () => {
  mcProbe.mockResolvedValue({ compile: true, decompile: false });
  render(<MapconvSettings />);
  await screen.findByText("Found");
  expect(screen.getByText("Missing")).toBeTruthy();
});

it("says so when the tool check fails", async () => {
  mcProbe.mockRejectedValue(new Error("no plugin"));
  render(<MapconvSettings />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/no plugin/);
  await waitFor(() =>
    expect(screen.getAllByText("Not checked")).toHaveLength(2),
  );
  expect(screen.queryByText("Checking…")).toBeNull();
});
