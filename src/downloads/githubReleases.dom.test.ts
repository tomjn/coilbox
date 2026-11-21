// @vitest-environment happy-dom
/**
 * Keeping GitHub release lists current while coilbox stays open, so a release
 * published during a session reaches the players who already have it running.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dlGithubReleaseArchives } = vi.hoisted(() => ({
  dlGithubReleaseArchives: vi.fn(),
}));
vi.mock("./bindings", () => ({ dlGithubReleaseArchives }));

const {
  AUTO_REFRESH_MS,
  invalidateGithubReleases,
  loadGithubReleases,
  refreshGithubReleases,
  useGithubReleasesAutoRefresh,
  useGithubReleasesVersion,
} = await import("./githubReleases");

const release = (tag: string) => ({
  filename: `game-${tag}.sdz`,
  url: `https://example.test/game-${tag}.sdz`,
  size: 1,
  tag,
  publishedAt: null,
});

beforeEach(() => {
  invalidateGithubReleases();
  vi.clearAllMocks();
  vi.useFakeTimers();
  dlGithubReleaseArchives.mockResolvedValue({ archives: [release("v1")] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a release list that changes", () => {
  it("tells readers when a refresh finds a new release", async () => {
    await loadGithubReleases("o/n");
    const { result } = renderHook(() => useGithubReleasesVersion());
    const before = result.current;

    await act(() => loadGithubReleases("o/n", true));
    expect(result.current).toBe(before);

    dlGithubReleaseArchives.mockResolvedValue({
      archives: [release("v2"), release("v1")],
    });
    await act(() => loadGithubReleases("o/n", true));
    expect(result.current).not.toBe(before);
  });
});

describe("refreshing release lists", () => {
  it("skips a list read more recently than asked", async () => {
    await loadGithubReleases("o/n");
    await refreshGithubReleases(["o/n"], AUTO_REFRESH_MS);
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AUTO_REFRESH_MS);
    await refreshGithubReleases(["o/n"], AUTO_REFRESH_MS);
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(2);
  });

  it("always asks again when no age is given", async () => {
    await loadGithubReleases("o/n");
    await refreshGithubReleases(["o/n"]);
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(2);
  });

  it("reads stale lists again on focus and on the timer", async () => {
    await loadGithubReleases("o/n");
    renderHook(() => useGithubReleasesAutoRefresh(["o/n"]));

    window.dispatchEvent(new Event("focus"));
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS);
    });
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(2);

    // The clock moves on without the timer firing, as when the app sleeps.
    vi.setSystemTime(Date.now() + AUTO_REFRESH_MS);
    window.dispatchEvent(new Event("focus"));
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(3);
  });
});
