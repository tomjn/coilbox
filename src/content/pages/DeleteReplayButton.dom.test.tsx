// @vitest-environment happy-dom
/**
 * Issue #3786. Deleting one replay from its page lists the recorded track in
 * the confirm, read from the same dry run the bulk delete uses, and a replay
 * with no track is confirmed as it was before.
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
const deleteReplay = vi.fn();
const listTracks = vi.fn();
vi.mock("../bindings", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../bindings");
  return {
    ...actual,
    contentDeleteReplays: (a: unknown) => deleteReplays(a),
    contentDeleteReplay: (a: unknown) => deleteReplay(a),
    contentReplayTracks: (a: unknown) => listTracks(a),
  };
});

const { DeleteReplayButton } = await import("./ReplayDetailPage");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const summary = (over: Record<string, unknown> = {}) => ({
  summary: {
    applied: false,
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

async function open() {
  render(
    <DeleteReplayButton replayPath="/demos/a.sdfz" onDeleted={() => {}} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /delete/i }));
}

describe("DeleteReplayButton", () => {
  it("asks for a dry run of this one replay when it opens", async () => {
    deleteReplays.mockResolvedValue(summary());
    await open();
    await waitFor(() =>
      expect(deleteReplays).toHaveBeenCalledWith({
        paths: ["/demos/a.sdfz"],
        apply: false,
      }),
    );
  });

  it("lists the track and what it frees when the replay has one", async () => {
    deleteReplays.mockResolvedValue(summary({ tracks: 1, trackBytes: 2048 }));
    await open();
    expect(await screen.findByText(/recorded track/i)).toBeTruthy();
    expect(screen.getByText(/2(\.0)? KB/)).toBeTruthy();
  });

  it("lists no track when the replay has none", async () => {
    deleteReplays.mockResolvedValue(summary());
    await open();
    await waitFor(() => expect(deleteReplays).toHaveBeenCalled());
    expect(screen.queryByText(/recorded track/i)).toBeNull();
  });

  it("deletes the replay and reads the tracks again when confirmed", async () => {
    deleteReplays.mockResolvedValue(summary({ tracks: 1, trackBytes: 2048 }));
    deleteReplay.mockResolvedValue({
      ok: true,
      analysisDeleted: false,
      trackDeleted: true,
    });
    listTracks.mockResolvedValue({ tracks: [] });
    await open();
    await screen.findByText(/recorded track/i);
    const buttons = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(deleteReplay).toHaveBeenCalledWith({ path: "/demos/a.sdfz" }),
    );
    await waitFor(() => expect(listTracks).toHaveBeenCalled());
  });
});
