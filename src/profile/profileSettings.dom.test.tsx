// @vitest-environment happy-dom

/**
 * The Distribution profile settings page in both of its states. A player with
 * no profile sees one row saying so and the Create tool. An author with a
 * profile sees what it changed and the Reload tool. Creating a profile swaps
 * the button for Restart, since the new file only loads at startup.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  source: "default" as "default" | "file",
  profile: {} as Record<string, unknown>,
  authoring: true,
}));
const scaffoldProfile = vi.hoisted(() =>
  vi.fn(async () => ({ written: true, path: "/app/.coilbox/profile.json" })),
);
const reloadProfile = vi.hoisted(() => vi.fn());

vi.mock("./profile", () => ({
  getProfile: () => state.profile,
  getProfileSource: () => state.source,
  isProfileAuthoringEnabled: () => state.authoring,
}));
vi.mock("./authoring", () => ({
  buildScaffoldProfile: () => ({}),
  installedGameNames: () => [],
  reloadProfile,
  scaffoldProfile,
}));
vi.mock("./HealthChecklist", () => ({
  default: () => <p>health results</p>,
}));
vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useTheme: () => ({ mode: "dark", accent: "blue" }),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("../general/features", () => ({ useFeatureStates: () => ({}) }));
vi.mock("../general/fullscreen", () => ({
  useFullscreenSetting: () => [false, vi.fn()],
}));
vi.mock("../play/config", () => ({
  usePreferredTarget: () => ({ target: null }),
}));
vi.mock("../content/config", () => ({
  useUnitsyncScan: () => ({ data: { games: [] }, error: null }),
}));

import ProfileSettings from "./SettingsSection";

beforeEach(() => {
  state.source = "default";
  state.profile = {};
  state.authoring = true;
  scaffoldProfile.mockClear();
  reloadProfile.mockClear();
});

afterEach(() => {
  cleanup();
});

it("says there is no profile and offers to create one", () => {
  render(<ProfileSettings />);
  expect(screen.getByText("Nothing, this is standard Coilbox")).toBeTruthy();
  expect(screen.queryByText("Hidden features")).toBeNull();
  expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
});

it("lists what a loaded profile changed and offers to reload it", () => {
  state.source = "file";
  state.profile = { title: "Splinter", hide: ["games", "maps"] };
  render(<ProfileSettings />);
  expect(screen.getByText(".coilbox/profile.json")).toBeTruthy();
  expect(screen.getByText("Splinter")).toBeTruthy();
  expect(screen.getByText("games, maps")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(reloadProfile).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
});

it("hides the authoring tool when the profile turns it off", () => {
  state.source = "file";
  state.profile = { authoring: false };
  state.authoring = false;
  render(<ProfileSettings />);
  expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  expect(screen.getByRole("button", { name: "Check" })).toBeTruthy();
});

it("shows the results only once Check is pressed", () => {
  render(<ProfileSettings />);
  expect(screen.queryByText("health results")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  expect(screen.getByText("health results")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
});

it("offers a restart once the profile is written", async () => {
  render(<ProfileSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy(),
  );
  expect(
    screen.getByText(
      "Wrote /app/.coilbox/profile.json. Restart Coilbox to load it.",
    ),
  ).toBeTruthy();
});

it("shows why creating the profile failed", async () => {
  scaffoldProfile.mockRejectedValueOnce(new Error("disk full"));
  render(<ProfileSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByRole("alert").textContent).toContain("disk full");
  expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
});
