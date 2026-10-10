// @vitest-environment happy-dom
/**
 * Issue #1172. Closing the save dialog is not an error and writes nothing. A
 * write that fails says so rather than looking like a save.
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
const write = vi.fn();
const notify = vi.fn(async () => {});

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => save(...args),
}));
vi.mock("@/notify/notify", () => ({
  notify: (...args: unknown[]) => notify(...(args as [])),
}));
vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return { ...actual, contentWriteFile: (a: unknown) => write(a) };
});

const { MatchStatsExportButton } = await import("./MatchStatsExportButton");

const input = {
  info: { gameId: "abc", mapName: "Map", startTimeMs: 0 } as DemoInfo,
  metric: {
    key: "k" as MetricKey,
    label: "Metric",
    group: "economy",
    unit: "metal",
  } as Metric,
  mode: "cumulative" as const,
  view: "players" as const,
  series: [{ id: "team0", label: "Alice", color: "#fff", samples: [] }],
  rows: [{ timeSec: 0, team0: 1 }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const press = () =>
  fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

describe("MatchStatsExportButton", () => {
  it("does nothing when the dialog is closed", async () => {
    save.mockResolvedValue(null);
    render(<MatchStatsExportButton input={input} />);
    press();
    await waitFor(() => expect(save).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: /export csv/i,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(write).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("writes the CSV to the chosen path and says so", async () => {
    save.mockResolvedValue("/tmp/out.csv");
    write.mockResolvedValue({});
    render(<MatchStatsExportButton input={input} />);
    press();
    await waitFor(() => expect(write).toHaveBeenCalled());
    const call = write.mock.calls[0][0] as { dest: string; text: string };
    expect(call.dest).toBe("/tmp/out.csv");
    expect(call.text.startsWith("match_time_sec,Alice,game_id")).toBe(true);
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ level: "success" }),
      ),
    );
  });

  it("reports a failed write", async () => {
    save.mockResolvedValue("/tmp/out.csv");
    write.mockRejectedValue(new Error("disk full"));
    render(<MatchStatsExportButton input={input} />);
    press();
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          title: "Export failed: disk full",
        }),
      ),
    );
  });
});
