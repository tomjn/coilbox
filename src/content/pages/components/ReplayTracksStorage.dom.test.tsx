// @vitest-environment happy-dom
/**
 * Issue #3787. The storage settings show what recorded tracks take against the
 * disk budget, let the budget be set, and clear every track. Clearing resets
 * every replay's badge, which is what the second suite proves by rendering a
 * badge beside the section.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredReplayTrack } from "../../bindings";

const MIB = 1024 * 1024;
const DEFAULT_BUDGET = 450 * MIB;
const ID = "00112233445566778899aabbccddeeff";
const OTHER = "ffeeddccbbaa99887766554433221100";

// The frame's `useSetting`, held in memory so a test can see what was saved.
const saved = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  writes: [] as unknown[],
}));
vi.mock("@picoframe/frame", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@picoframe/frame")>();
  const { useState } = await import("react");
  return {
    ...actual,
    useSetting: (key: string, fallback: unknown) => {
      const [value, set] = useState(
        saved.values.has(key) ? saved.values.get(key) : fallback,
      );
      return [
        value,
        (next: unknown) => {
          saved.writes.push(next);
          saved.values.set(key, next);
          set(next);
        },
      ];
    },
  };
});

const listTracks = vi.fn();
const clearTracks = vi.fn();
vi.mock("@/notify/notify", () => ({ notify: vi.fn(async () => {}) }));
vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentReplayTracks: (a: unknown) => listTracks(a),
    contentReplayTracksClear: (a: unknown) => clearTracks(a),
  };
});

const { ReplayTracksStorage } = await import("./ReplayTracksStorage");
const { ReplayTrackBadge } = await import("./ReplayTrackBadge");
const {
  refreshStoredTracks,
  resetReplayTracksForTests,
  seedReplayTracksForTests,
  TRACK_BUDGET_SETTING,
} = await import("../../replayTracks");

const track = (over: Partial<StoredReplayTrack> = {}): StoredReplayTrack => ({
  gameId: ID,
  state: "current",
  sizeBytes: MIB,
  lastWatchedMs: 1,
  ...over,
});

/** What the backend answers for a set of tracks. */
const onDisk = (tracks: StoredReplayTrack[]) => ({
  tracks,
  totalBytes: tracks.reduce((sum, t) => sum + t.sizeBytes, 0),
  defaultBudgetBytes: DEFAULT_BUDGET,
});

beforeEach(() => {
  saved.values.clear();
  saved.writes.length = 0;
  listTracks.mockReset();
  clearTracks.mockReset();
});

afterEach(() => {
  cleanup();
  resetReplayTracksForTests();
});

describe("the track storage settings", () => {
  it("shows the total the backend counted against the default budget", async () => {
    listTracks.mockResolvedValue(
      onDisk([track(), track({ gameId: OTHER, sizeBytes: MIB / 2 })]),
    );
    render(<ReplayTracksStorage />);

    expect(await screen.findByText(/1\.5 MB used of 450 MB/)).toBeTruthy();
    expect(screen.getByText(/2 tracks/)).toBeTruthy();
  });

  it("shows a zero total when there are no tracks, and nothing to clear", async () => {
    listTracks.mockResolvedValue(onDisk([]));
    render(<ReplayTracksStorage />);

    expect(await screen.findByText(/0 B used of 450 MB/)).toBeTruthy();
    const clear = screen.getByRole("button", { name: /clear all tracks/i });
    expect((clear as HTMLButtonElement).disabled).toBe(true);
  });

  it("counts a stale track in the total", async () => {
    listTracks.mockResolvedValue(
      onDisk([track({ state: "stale", sizeBytes: 2 * MIB })]),
    );
    render(<ReplayTracksStorage />);

    expect(await screen.findByText(/2\.0 MB used of/)).toBeTruthy();
  });

  it("shows the saved budget in megabytes instead of the default", () => {
    saved.values.set(TRACK_BUDGET_SETTING, 100 * MIB);
    seedReplayTracksForTests([track()], DEFAULT_BUDGET);
    render(<ReplayTracksStorage />);

    expect(screen.getByText(/1\.0 MB used of 100 MB/)).toBeTruthy();
    const input = screen.getByLabelText(/disk space/i) as HTMLInputElement;
    expect(input.value).toBe("100");
  });

  it("shows the default budget in the field before one is saved", () => {
    seedReplayTracksForTests([], DEFAULT_BUDGET);
    render(<ReplayTracksStorage />);

    const input = screen.getByLabelText(/disk space/i) as HTMLInputElement;
    expect(input.value).toBe("450");
  });

  it("saves a new budget in bytes when the field is left", () => {
    seedReplayTracksForTests([], DEFAULT_BUDGET);
    render(<ReplayTracksStorage />);
    const input = screen.getByLabelText(/disk space/i);

    fireEvent.change(input, { target: { value: "200" } });
    expect(saved.writes).toEqual([]);
    fireEvent.blur(input);

    expect(saved.writes).toEqual([200 * MIB]);
    expect(screen.getByText(/used of 200 MB/)).toBeTruthy();
  });

  it("saves nothing for a budget that is not a whole number above zero", () => {
    seedReplayTracksForTests([], DEFAULT_BUDGET);
    render(<ReplayTracksStorage />);
    const input = screen.getByLabelText(/disk space/i) as HTMLInputElement;

    for (const bad of ["", "0", "-5", "1.5", "abc"]) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.blur(input);
      expect(input.value, bad).toBe("450");
    }
    expect(saved.writes).toEqual([]);
  });

  it("says plainly when the tracks are over the budget", () => {
    saved.values.set(TRACK_BUDGET_SETTING, MIB);
    seedReplayTracksForTests([track({ sizeBytes: 3 * MIB })], DEFAULT_BUDGET);
    render(<ReplayTracksStorage />);

    expect(screen.getByText(/3\.0 MB used of 1\.0 MB/)).toBeTruthy();
    expect(screen.getByText(/over the limit/i)).toBeTruthy();
  });

  it("does not say it is over the budget when the tracks fit", () => {
    seedReplayTracksForTests([track()], DEFAULT_BUDGET);
    render(<ReplayTracksStorage />);

    expect(screen.queryByText(/over the limit/i)).toBeNull();
  });

  it("puts the explanation behind a help button and not in the page", () => {
    seedReplayTracksForTests([], DEFAULT_BUDGET);
    render(<ReplayTracksStorage />);

    expect(screen.queryByText(/least recently watched/i)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /about replay tracks/i }),
    );
    expect(screen.getByText(/least recently watched/i)).toBeTruthy();
  });
});

describe("clearing the tracks", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("button", { name: /clear all tracks/i }));

  it("asks first, with how many and how much, and removes nothing on cancel", () => {
    seedReplayTracksForTests(
      [track(), track({ gameId: OTHER, sizeBytes: 2 * MIB })],
      DEFAULT_BUDGET,
    );
    render(<ReplayTracksStorage />);

    open();
    expect(screen.getByText(/remove 2 tracks and free 3\.0 MB/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(clearTracks).not.toHaveBeenCalled();
  });

  it("removes every track and resets every replay's badge", async () => {
    seedReplayTracksForTests(
      [track(), track({ gameId: OTHER, state: "stale" })],
      DEFAULT_BUDGET,
    );
    clearTracks.mockResolvedValue({
      cleared: { removed: 2, freedBytes: 2 * MIB, kept: 0 },
    });
    listTracks.mockResolvedValue(onDisk([]));
    render(
      <>
        <ReplayTracksStorage />
        <ReplayTrackBadge gameId={ID} />
        <ReplayTrackBadge gameId={OTHER} />
      </>,
    );
    expect(screen.getByText("Track recorded")).toBeTruthy();
    expect(screen.getByText("Track out of date")).toBeTruthy();

    open();
    fireEvent.click(screen.getByRole("button", { name: /^clear tracks$/i }));

    await waitFor(() => expect(clearTracks).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listTracks).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText("Track recorded")).toBeNull();
      expect(screen.queryByText("Track out of date")).toBeNull();
    });
    expect(screen.getByText(/0 B used of 450 MB/)).toBeTruthy();
  });

  it("says why, and leaves the badges, when the backend could not clear", async () => {
    seedReplayTracksForTests([track()], DEFAULT_BUDGET);
    clearTracks.mockRejectedValue(new Error("permission denied"));
    render(
      <>
        <ReplayTracksStorage />
        <ReplayTrackBadge gameId={ID} />
      </>,
    );

    open();
    fireEvent.click(screen.getByRole("button", { name: /^clear tracks$/i }));

    expect(await screen.findByText(/permission denied/)).toBeTruthy();
    expect(screen.getByText("Track recorded")).toBeTruthy();
  });

  it("follows a recording that stores a track while the page is open", async () => {
    seedReplayTracksForTests([], DEFAULT_BUDGET);
    render(<ReplayTracksStorage />);
    expect(screen.getByText(/0 B used of/)).toBeTruthy();

    listTracks.mockResolvedValue(onDisk([track({ sizeBytes: 4 * MIB })]));
    await act(async () => {
      await refreshStoredTracks();
    });

    expect(screen.getByText(/4\.0 MB used of 450 MB/)).toBeTruthy();
  });
});
