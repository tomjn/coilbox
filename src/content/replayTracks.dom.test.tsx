// @vitest-environment happy-dom
/**
 * Issue #3786. A replay's track state is joined from the stored tracks by game
 * id, and shown quietly: a badge in the replay list and on the replay page. A
 * stale track says it needs recording again, and a remix never shows its
 * original's track.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredReplayTrack } from "./bindings";

const listTracks = vi.fn();
vi.mock("./bindings", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./bindings");
  return { ...actual, contentReplayTracks: (a: unknown) => listTracks(a) };
});

const { ReplayTrackBadge } = await import(
  "./pages/components/ReplayTrackBadge"
);
const {
  refreshStoredTracks,
  resetReplayTracksForTests,
  seedReplayTracksForTests,
} = await import("./replayTracks");

const ID = "00112233445566778899aabbccddeeff";

const track = (over: Partial<StoredReplayTrack> = {}): StoredReplayTrack => ({
  gameId: ID,
  state: "current",
  sizeBytes: 1_000,
  lastWatchedMs: 1,
  ...over,
});

afterEach(() => {
  cleanup();
  resetReplayTracksForTests();
});

describe("ReplayTrackBadge", () => {
  it("shows nothing for a replay with no track", () => {
    seedReplayTracksForTests([]);
    const { container } = render(<ReplayTrackBadge gameId={ID} />);
    expect(container.textContent).toBe("");
  });

  it("shows nothing for a replay with no game id", () => {
    seedReplayTracksForTests([track()]);
    const { container } = render(<ReplayTrackBadge gameId={undefined} />);
    expect(container.textContent).toBe("");
  });

  it("says a current track is recorded", () => {
    seedReplayTracksForTests([track()]);
    render(<ReplayTrackBadge gameId={ID} />);
    expect(screen.getByText("Track recorded")).toBeTruthy();
  });

  it("says a track from an older recorder is out of date", () => {
    seedReplayTracksForTests([track({ state: "stale" })]);
    render(<ReplayTrackBadge gameId={ID} />);
    expect(screen.getByText("Track out of date")).toBeTruthy();
    expect(screen.queryByText("Track recorded")).toBeNull();
  });

  it("explains a stale track in a tooltip and not in the page", () => {
    seedReplayTracksForTests([track({ state: "stale" })]);
    render(<ReplayTrackBadge gameId={ID} />);
    const badge = screen.getByText("Track out of date").closest("[title]");
    expect(badge?.getAttribute("title")).toMatch(/recording the replay again/);
  });

  it("shows nothing for a remix, which has no track of its own", () => {
    seedReplayTracksForTests([track()]);
    const { container } = render(<ReplayTrackBadge gameId={ID} remixed />);
    expect(container.textContent).toBe("");
  });

  it("does not show another replay's track", () => {
    seedReplayTracksForTests([track({ gameId: "ff".repeat(16) })]);
    const { container } = render(<ReplayTrackBadge gameId={ID} />);
    expect(container.textContent).toBe("");
  });
});

describe("the stored tracks", () => {
  it("drop a track that was deleted outside the app on the next read", async () => {
    seedReplayTracksForTests([track()]);
    render(<ReplayTrackBadge gameId={ID} />);
    expect(screen.getByText("Track recorded")).toBeTruthy();

    listTracks.mockResolvedValue({
      tracks: [],
      totalBytes: 0,
      defaultBudgetBytes: 1,
    });
    await act(async () => {
      await refreshStoredTracks();
    });

    expect(screen.queryByText("Track recorded")).toBeNull();
  });
});
