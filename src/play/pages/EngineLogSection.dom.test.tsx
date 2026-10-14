// @vitest-environment happy-dom
/**
 * The Engine log page points at the real `infolog.txt` and shows none of it.
 * Any slice of the file read as the log misleads a helper, because the start,
 * where the engine records the system and the GPU, is the part that goes
 * missing (issue #4064).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  playInfolog: vi.fn(),
  playSystemInfo: vi.fn(),
  contentOpenPath: vi.fn(async (_a: { path: string }) => {}),
  revealItemInDir: vi.fn(async (_p: string) => {}),
  getVersion: vi.fn(async () => "1.2.3"),
  target: {
    current: {
      dataDir: "/root",
      engineVersion: "2026.03.01",
    } as { dataDir: string; engineVersion: string } | null,
  },
}));

vi.mock("@/play/bindings", () => ({
  playInfolog: m.playInfolog,
  playSystemInfo: m.playSystemInfo,
}));
vi.mock("@/content/bindings", () => ({ contentOpenPath: m.contentOpenPath }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: m.revealItemInDir,
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: m.getVersion }));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({ target: m.target.current }),
}));

import EngineLogSection from "./EngineLogSection";

const LOG = "/Users/p/.config/spring/infolog.txt";

beforeEach(() => {
  m.target.current = { dataDir: "/root", engineVersion: "2026.03.01" };
  m.playInfolog.mockResolvedValue({
    log: {
      path: LOG,
      modifiedMs: 1_700_000_000_000,
      totalLines: 9000,
      lines: [],
      truncated: true,
    },
  });
  m.playSystemInfo.mockResolvedValue({
    os: "macos",
    osVersion: "14.5",
    arch: "aarch64",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows the path to the log file", async () => {
  render(<EngineLogSection />);
  expect(await screen.findByText(LOG)).toBeTruthy();
});

it("asks for no lines of the log", async () => {
  render(<EngineLogSection />);
  await screen.findByText(LOG);
  expect(m.playInfolog).toHaveBeenCalledWith({
    dataDir: "/root",
    maxLines: 0,
  });
});

it("offers no copy of the log and shows no lines of it", async () => {
  m.playInfolog.mockResolvedValue({
    log: {
      path: LOG,
      modifiedMs: 1,
      totalLines: 2,
      lines: ["[t=00:00:32] a late line"],
      truncated: true,
    },
  });
  render(<EngineLogSection />);
  await screen.findByText(LOG);
  expect(screen.queryByText(/a late line/)).toBeNull();
  expect(screen.queryByRole("button", { name: /copy the log/i })).toBeNull();
  expect(screen.queryByText(/showing the last/i)).toBeNull();
});

it("opens the log file", async () => {
  render(<EngineLogSection />);
  fireEvent.click(await screen.findByRole("button", { name: /open the log/i }));
  expect(m.contentOpenPath).toHaveBeenCalledWith({ path: LOG });
});

it("shows the log file in its folder", async () => {
  render(<EngineLogSection />);
  fireEvent.click(
    await screen.findByRole("button", { name: /show in folder/i }),
  );
  expect(m.revealItemInDir).toHaveBeenCalledWith(LOG);
});

it("shows the system, coilbox and engine versions", async () => {
  render(<EngineLogSection />);
  expect(await screen.findByText("macos 14.5 (aarch64)")).toBeTruthy();
  expect(await screen.findByText("1.2.3")).toBeTruthy();
  expect(screen.getByText("2026.03.01")).toBeTruthy();
});

it("copies the system information and nothing from the log", async () => {
  const writeText = vi.fn(async (_t: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  render(<EngineLogSection />);
  fireEvent.click(
    await screen.findByRole("button", { name: /copy system info/i }),
  );
  expect(writeText).toHaveBeenCalledTimes(1);
  const text = writeText.mock.calls[0][0];
  expect(text).toContain("macos 14.5 (aarch64)");
  expect(text).toContain("2026.03.01");
  expect(text).toContain(LOG);
});

it("says so when no engine log exists", async () => {
  m.playInfolog.mockRejectedValue(new Error("no engine log was found"));
  render(<EngineLogSection />);
  expect(await screen.findByText("no engine log was found")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /open the log/i })).toBeNull();
});
