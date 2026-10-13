// @vitest-environment happy-dom
/**
 * Issue #3786. The summary the bulk delete shows before deleting lists the
 * recorded tracks that go with the replays, and confirming deletes and reads
 * the tracks again. With no tracks the summary is as it was.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteReplays = vi.fn();
const listTracks = vi.fn();
vi.mock("@/notify/notify", () => ({ notify: vi.fn(async () => {}) }));
vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentDeleteReplays: (a: unknown) => deleteReplays(a),
    contentReplayTracks: (a: unknown) => listTracks(a),
  };
});
vi.mock("../../replayList", () => ({
  loadReplays: async () => [
    {
      filename: "short.sdfz",
      path: "/demos/short.sdfz",
      sizeBytes: 10,
      modifiedMs: 0,
      durationSec: 10,
    },
  ],
}));
vi.mock("../../replayUserState", () => ({
  useReplayUserState: () => ({ state: {} }),
}));

const { BulkDeleteReplaysPanel } = await import("./BulkDeleteReplaysPanel");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const summary = (applied: boolean, over: Record<string, unknown> = {}) => ({
  summary: {
    applied,
    deleted: 1,
    bytes: 10,
    skipped: [],
    analyses: 0,
    analysisBytes: 0,
    tracks: 0,
    trackBytes: 0,
    ...over,
  },
});

async function openConfirm() {
  render(<BulkDeleteReplaysPanel rootPath="/data" onDeleted={() => {}} />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /under 60/i }));
  fireEvent.click(screen.getByRole("button", { name: /delete matching/i }));
}

describe("BulkDeleteReplaysPanel", () => {
  it("lists the recorded track in the summary before deleting", async () => {
    deleteReplays.mockResolvedValue(
      summary(false, { tracks: 1, trackBytes: 2048 }),
    );
    await openConfirm();
    expect(
      await screen.findByText(/1 of them has a recorded track/),
    ).toBeTruthy();
    expect(screen.getByText(/frees another 2(\.0)? KB/)).toBeTruthy();
    expect(deleteReplays).toHaveBeenCalledTimes(1);
    expect(deleteReplays.mock.calls[0][0].apply).toBe(false);
  });

  it("counts tracks when several replays have one", async () => {
    deleteReplays.mockResolvedValue(
      summary(false, { tracks: 3, trackBytes: 9 }),
    );
    await openConfirm();
    expect(
      await screen.findByText(/3 of them have a recorded track/),
    ).toBeTruthy();
  });

  it("says nothing about tracks when none go", async () => {
    deleteReplays.mockResolvedValue(summary(false));
    await openConfirm();
    await screen.findByText(/is freed/);
    expect(screen.queryByText(/recorded track/)).toBeNull();
  });

  it("deletes with the track and reads the tracks again", async () => {
    deleteReplays
      .mockResolvedValueOnce(summary(false, { tracks: 1, trackBytes: 2048 }))
      .mockResolvedValueOnce(summary(true, { tracks: 1, trackBytes: 2048 }));
    listTracks.mockResolvedValue({ tracks: [] });
    await openConfirm();
    await screen.findByText(/recorded track/);
    const buttons = screen.getAllByRole("button", { name: /^delete/i });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(deleteReplays).toHaveBeenCalledTimes(2));
    expect(deleteReplays.mock.calls[1][0].apply).toBe(true);
    await waitFor(() => expect(listTracks).toHaveBeenCalled());
  });
});
