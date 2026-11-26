// @vitest-environment happy-dom

/**
 * The uberstress settings page. A number field saves only a whole number in
 * range once it loses focus or Enter is pressed, so clearing it to retype
 * never saves 0. A saved scenario the binary no longer lists still shows in
 * the select.
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
import { defaultConfig } from "../config";

const usScenarios = vi.hoisted(() => vi.fn());
const setCfg = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ cfg: {} as Config }));

vi.mock("../bindings", () => ({ usScenarios }));
vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config")>()),
  useUberstressConfig: () => [state.cfg, setCfg],
}));

import UberstressSettings from "./SettingsSection";

beforeEach(() => {
  usScenarios.mockReset();
  usScenarios.mockResolvedValue({ scenarios: ["login-storm", "chat-storm"] });
  setCfg.mockReset();
  state.cfg = structuredClone(defaultConfig);
});

afterEach(() => {
  cleanup();
});

it("keeps the saved count when the field is cleared", () => {
  render(<UberstressSettings />);
  const conns = screen.getByLabelText("Connections") as HTMLInputElement;
  fireEvent.change(conns, { target: { value: "" } });
  expect(setCfg).not.toHaveBeenCalled();
  fireEvent.blur(conns);
  expect(setCfg).not.toHaveBeenCalled();
  expect(conns.value).toBe("100");
});

it("saves a typed number on Enter, held to its range", () => {
  render(<UberstressSettings />);
  const port = screen.getByLabelText("Lobby port");
  fireEvent.change(port, { target: { value: "70000" } });
  fireEvent.keyDown(port, { key: "Enter" });
  expect(setCfg).toHaveBeenCalledWith({
    ...defaultConfig,
    bench: { ...defaultConfig.bench, port: 65535 },
  });
});

it("ignores a number that is not whole", () => {
  render(<UberstressSettings />);
  const conns = screen.getByLabelText("Connections");
  fireEvent.change(conns, { target: { value: "2.5" } });
  fireEvent.blur(conns);
  expect(setCfg).not.toHaveBeenCalled();
});

it("still shows a saved scenario the binary no longer lists", async () => {
  state.cfg.defaults.scenario = "old-storm";
  render(<UberstressSettings />);
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Scenario" }).textContent).toBe(
      "old-storm",
    ),
  );
});
