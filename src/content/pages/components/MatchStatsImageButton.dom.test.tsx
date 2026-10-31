// @vitest-environment happy-dom
/**
 * Issue #3836. Closing the save dialog is not an error and draws and writes
 * nothing. A failed write says so rather than looking like a save.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DemoInfo, Metric, MetricKey } from "../../bindings";

const save = vi.fn();
const writePng = vi.fn();
const renderPng = vi.fn();
const notify = vi.fn(async () => {});

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => save(...args),
}));
vi.mock("@/notify/notify", () => ({
  notify: (...args: unknown[]) => notify(...(args as [])),
}));
vi.mock("../../mapImageExport", () => ({
  savePngBytes: (...args: unknown[]) => writePng(...args),
}));
vi.mock("../../matchStatsImageExport", () => ({
  renderMatchStatsImage: (...args: unknown[]) => renderPng(...args),
}));

const { MatchStatsImageButton } = await import("./MatchStatsImageButton");

const input = {
  info: {
    gameId: "abc",
    mapName: "Map",
    startTimeMs: 0,
    players: [],
    ais: [],
  } as unknown as DemoInfo,
  metric: {
    key: "k" as MetricKey,
    label: "Metric",
    group: "economy",
    unit: "metal",
  } as Metric,
  mode: "cumulative" as const,
  view: "players" as const,
  series: [{ id: "team0", label: "Alice", color: "#336699", samples: [] }],
  rows: [{ timeSec: 0, team0: 1 }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const button = () =>
  screen.getByRole("button", { name: /export image/i }) as HTMLButtonElement;

describe("MatchStatsImageButton", () => {
  it("does nothing when the dialog is closed", async () => {
    save.mockResolvedValue(null);
    render(<MatchStatsImageButton input={input} />);
    fireEvent.click(button());
    await waitFor(() => expect(save).toHaveBeenCalled());
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(renderPng).not.toHaveBeenCalled();
    expect(writePng).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("asks for a PNG named for the chart and writes the picture there", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    save.mockResolvedValue("/tmp/out.png");
    renderPng.mockResolvedValue(bytes);
    writePng.mockResolvedValue(undefined);
    render(<MatchStatsImageButton input={input} />);
    fireEvent.click(button());
    await waitFor(() =>
      expect(writePng).toHaveBeenCalledWith("/tmp/out.png", bytes),
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "map-metric-players-cumulative.png",
        filters: [{ name: "PNG image", extensions: ["png"] }],
      }),
    );
    expect(renderPng).toHaveBeenCalledWith(input);
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ level: "success" }),
      ),
    );
  });

  it("has nothing to draw when every line is unchecked", () => {
    render(
      <MatchStatsImageButton input={{ ...input, series: [], rows: [] }} />,
    );
    expect(button().disabled).toBe(true);
  });

  it("reports a failed write", async () => {
    save.mockResolvedValue("/tmp/out.png");
    renderPng.mockResolvedValue(new Uint8Array([1]));
    writePng.mockRejectedValue(new Error("disk full"));
    render(<MatchStatsImageButton input={input} />);
    fireEvent.click(button());
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          title: "Export failed: disk full",
        }),
      ),
    );
  });

  it("reports a picture that could not be drawn", async () => {
    save.mockResolvedValue("/tmp/out.png");
    renderPng.mockRejectedValue(new Error("no canvas"));
    render(<MatchStatsImageButton input={input} />);
    fireEvent.click(button());
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          title: "Export failed: no canvas",
        }),
      ),
    );
    expect(writePng).not.toHaveBeenCalled();
  });
});
