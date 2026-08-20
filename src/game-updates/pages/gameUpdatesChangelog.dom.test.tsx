// @vitest-environment happy-dom

/**
 * What happens when somebody clicks a link in a game's changelog (issue #1789).
 *
 * The changelog is the release body from GitHub, so its text is written by
 * whoever cut the release and its links point at github.com. Before this it was
 * rendered with no link renderer at all: the webview followed the link and the
 * release page replaced Coilbox, which has no back button and no address bar to
 * get out of.
 *
 * Each case is a real click on the real section, through the real markdown
 * render, asserting whether the webview was allowed to follow the link and what
 * the OS was asked to do.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openUrl, updates } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
  updates: { body: "" },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

// The section reads its state from the provider and the downloads config, and
// neither has anything to do with the changelog. An update is waiting, because
// that is the only state in which the changelog is on screen.
vi.mock("../GameUpdatesProvider", () => ({
  useGameUpdates: () => ({
    repo: "example/game",
    release: { tag: "v2", name: "Release 2", body: updates.body, assets: [] },
    checking: false,
    error: null,
    updateAvailable: true,
    installing: false,
    installed: false,
    profileUpdated: false,
    currentFile: null,
    progress: null,
    runCheck: async () => {},
    install: async () => {},
    restart: async () => {},
  }),
}));
vi.mock("../../downloads/config", () => ({
  useWriteRoot: () => ({ path: "/games", loading: false }),
}));

import GameUpdatesSection from "./GameUpdatesSection";

/** Render the section with the given changelog body. */
function showChangelog(markdown: string) {
  updates.body = markdown;
  return render(<GameUpdatesSection />);
}

/** Render the section with a one-link changelog, click the link, and report. */
function clickLink(markdown: string) {
  showChangelog(markdown);
  const link = screen.getByRole("link");
  // `fireEvent` hands back the `dispatchEvent` result, which is false exactly
  // when something called `preventDefault`.
  return { followed: fireEvent.click(link), link };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a link in a game's changelog", () => {
  it("opens in the browser instead of replacing the app with GitHub", () => {
    const url = "https://github.com/example/game/pull/7";
    const { followed, link } = clickLink(`- New maps in [#7](${url})`);
    // The href is still there, so the link reads as a link and can be copied.
    // It is the click that must not reach the webview.
    expect(link.getAttribute("href")).toBe(url);
    expect(followed).toBe(false);
    expect(openUrl).toHaveBeenCalledWith(url);
  });

  it("is still not followed when the OS refuses to open it", async () => {
    // The failure that must not fall back to letting the webview navigate,
    // because that is the bug. The click says so in the console instead.
    openUrl.mockRejectedValue(new Error("no browser"));
    const { followed } = clickLink("[the issue](https://example.org/i/1)");
    expect(followed).toBe(false);
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("https://example.org/i/1"),
        expect.any(Error),
      ),
    );
  });

  it("is a link even when the release body only wrote the URL", () => {
    // The line GitHub appends to a generated release body, spelled exactly as
    // GitHub spells it. It used to be plain text (issue #1791).
    const url = "https://github.com/example/game/compare/v1...v2";
    const { followed, link } = clickLink(`**Full Changelog**: ${url}`);
    expect(link.getAttribute("href")).toBe(url);
    // And the autolink goes through the same guard as a written link, so the
    // release page does not replace Coilbox.
    expect(followed).toBe(false);
    expect(openUrl).toHaveBeenCalledWith(url);
  });

  it("refuses a relative link, which would resolve against the app itself", () => {
    // A release body written for github.com can carry `[#7](../issues/7)`, which
    // means nothing here and would take the app to a route that does not exist.
    const { followed } = clickLink("[#7](../issues/7)");
    expect(followed).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("../issues/7"),
    );
  });
});

describe("the rest of a GitHub release body", () => {
  it("renders a table as a table rather than as run-together text", () => {
    const { container } = showChangelog(
      ["| Unit | Change |", "| --- | --- |", "| Pawn | Cheaper |"].join("\n"),
    );
    expect(screen.getByRole("columnheader", { name: "Unit" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Cheaper" })).toBeTruthy();
    // The wrapper around the changelog carries the borders and padding the
    // cells are drawn with, because Tailwind's reset gives a table neither.
    const table = container.querySelector("table");
    expect(table?.closest("[class*='[&_td]:border']")).toBeTruthy();
  });

  it("renders a task list and strikethrough", () => {
    showChangelog("- [x] Ship it\n- [ ] Later\n\n~~Removed~~");
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(screen.getByText("Removed").tagName).toBe("DEL");
  });
});
