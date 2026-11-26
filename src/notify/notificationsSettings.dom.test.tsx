// @vitest-environment happy-dom

/**
 * The Notifications settings page. Asking for the system permission can fail
 * or be refused, and either way the page says so rather than leaving an
 * unhandled rejection. The test notification carries the profile's app name.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const isPermissionGranted = vi.hoisted(() => vi.fn(async () => false));
const requestPermission = vi.hoisted(() =>
  vi.fn(async (): Promise<string> => "denied"),
);
const notify = vi.hoisted(() => vi.fn(async () => {}));
const profile = vi.hoisted(() => ({ title: undefined as string | undefined }));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted,
  requestPermission,
}));
vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("./notify", () => ({ notify }));
vi.mock("@/profile/profile", () => ({ getProfile: () => profile }));
vi.mock("../multiplayer/battles/SavedSearchSettings", () => ({
  SavedSearchSettings: () => null,
}));

import NotificationsSettings from "./NotificationsSettings";

beforeEach(() => {
  isPermissionGranted.mockResolvedValue(false);
  requestPermission.mockReset();
  notify.mockClear();
  profile.title = undefined;
});

afterEach(() => {
  cleanup();
});

it("hides Allow once the permission is granted", async () => {
  isPermissionGranted.mockResolvedValue(true);
  render(<NotificationsSettings />);
  await screen.findByText("Allowed");
  expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
});

it("says so when the system refuses the permission", async () => {
  requestPermission.mockResolvedValue("denied");
  render(<NotificationsSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /system settings/,
  );
});

it("says so when asking for the permission fails", async () => {
  requestPermission.mockRejectedValue(new Error("no plugin"));
  render(<NotificationsSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /system settings/,
  );
});

it("clears the message once the permission is granted", async () => {
  requestPermission.mockResolvedValueOnce("denied");
  requestPermission.mockResolvedValueOnce("granted");
  render(<NotificationsSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await screen.findByText("Allowed");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("names the test notification after the profile's app", async () => {
  profile.title = "Splinter Launcher";
  render(<NotificationsSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Splinter Launcher" }),
    ),
  );
});
