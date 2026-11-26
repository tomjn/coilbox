// @vitest-environment happy-dom
/**
 * Saved configs. Deleting a copy and saving over one with the same name both
 * ask first, and restoring the automatic backup with automatic backups on puts
 * the backup back rather than overwriting it with the current config first.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const backup = vi.fn();
const restore = vi.fn();
const del = vi.fn();
let prefs = { autoBackupEngineConfig: false };
vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentConfigProfiles: (a: unknown) => list(a),
    contentConfigBackup: (a: unknown) => backup(a),
    contentConfigRestore: (a: unknown) => restore(a),
    contentConfigDeleteProfile: (a: unknown) => del(a),
  };
});
vi.mock("../../config", () => ({
  useContentPrefs: () => [prefs, vi.fn()],
}));

const { ConfigProfilesPanel, configSlug } = await import(
  "./ConfigProfilesPanel"
);

const copy = (name: string, slug: string) => ({
  name,
  slug,
  createdAtMs: 0,
  artifacts: ["springsettings.cfg"],
});

beforeEach(() => {
  prefs = { autoBackupEngineConfig: false };
  list.mockResolvedValue({
    profiles: [copy("Auto-backup", "auto-backup"), copy("Mine", "mine")],
  });
  backup.mockResolvedValue({});
  del.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("configSlug", () => {
  it("matches the backend's folder names", () => {
    expect(configSlug("  My Config!! 2 ")).toBe("my-config-2");
    expect(configSlug("!!!")).toBe("");
  });
});

describe("ConfigProfilesPanel", () => {
  it("asks before deleting a copy", async () => {
    render(<ConfigProfilesPanel rootPath="/data" />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Mine" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith({ rootPath: "/data", slug: "mine" }),
    );
  });

  it("asks before saving over a copy with the same name", async () => {
    render(<ConfigProfilesPanel rootPath="/data" />);
    await screen.findByText("Mine");
    fireEvent.change(screen.getByRole("textbox", { name: "Name this copy" }), {
      target: { value: "mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(backup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() =>
      expect(backup).toHaveBeenCalledWith({ rootPath: "/data", name: "mine" }),
    );
  });

  it("restores the automatic backup without overwriting it first", async () => {
    prefs = { autoBackupEngineConfig: true };
    restore.mockImplementation(async ({ overwrite }) =>
      overwrite
        ? { needsOverwrite: false, restored: 1 }
        : { needsOverwrite: true, restored: 0 },
    );
    render(<ConfigProfilesPanel rootPath="/data" />);
    await screen.findByText("Automatic backup");
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Overwrite" }));
    await screen.findByText('Restored "Automatic backup".');
    expect(backup).not.toHaveBeenCalled();
  });

  it("backs up first when restoring any other copy", async () => {
    prefs = { autoBackupEngineConfig: true };
    restore.mockImplementation(async ({ overwrite }) =>
      overwrite
        ? { needsOverwrite: false, restored: 1 }
        : { needsOverwrite: true, restored: 0 },
    );
    render(<ConfigProfilesPanel rootPath="/data" />);
    await screen.findByText("Mine");
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Overwrite" }));
    await screen.findByText('Restored "Mine".');
    expect(backup).toHaveBeenCalledWith({
      rootPath: "/data",
      name: "Auto-backup",
    });
  });
});
