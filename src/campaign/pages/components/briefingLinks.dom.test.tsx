// @vitest-environment happy-dom

/**
 * What happens when somebody clicks a link in a mission briefing (issue #1789).
 *
 * A campaign is read off disk and can be imported from somebody else, so the
 * briefing text is the campaign author's rather than Coilbox's. Before this, a
 * briefing link was a bare anchor: the webview followed it and the linked page
 * replaced the whole app, with no back button and no address bar to get out of.
 *
 * So each case is a real click on a real briefing, through the real markdown
 * render, asserting whether the webview was allowed to follow the link and what
 * the OS was asked to do. `../../../profile/customPageLinks.dom.test.tsx` drives
 * the same stranding on a distribution's pages.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { BriefingProse } from "./Briefing";

/** Render a one-link briefing, click the link, and report what the click did. */
function clickLink(markdown: string) {
  render(<BriefingProse>{markdown}</BriefingProse>);
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

describe("a link in a mission briefing", () => {
  it("opens an external link in the browser instead of over the app", () => {
    const { followed, link } = clickLink(
      "[our Discord](https://example.org/c)",
    );
    // The href is still there, so the link reads as a link and can be copied.
    // It is the click that must not reach the webview.
    expect(link.getAttribute("href")).toBe("https://example.org/c");
    expect(followed).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("https://example.org/c");
  });

  it("is still not followed when the OS refuses to open it", async () => {
    // The failure that must not fall back to letting the webview navigate,
    // because that is the bug. The click says so in the console instead.
    openUrl.mockRejectedValue(new Error("no browser"));
    const { followed } = clickLink("[our Discord](https://example.org/c)");
    expect(followed).toBe(false);
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("https://example.org/c"),
        expect.any(Error),
      ),
    );
  });

  it("refuses a link to a bundled file rather than drawing it over the app", () => {
    // A briefing shows a bundled picture with the `!` image spelling, which still
    // works. A plain link to one has nowhere to go that is not on top of Coilbox.
    const { followed } = clickLink("[the map](images/map.jpg)");
    expect(followed).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("images/map.jpg"),
    );
  });

  it("refuses a bare fragment, which would move the app rather than scroll", () => {
    // Coilbox routes on the hash, so following `#part-two` changes the route.
    const { followed } = clickLink("[part two](#part-two)");
    expect(followed).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("#part-two"),
    );
  });

  it("still renders inline media, which the link renderer sits beside", () => {
    render(<BriefingProse>{"![the map](images/map.jpg)"}</BriefingProse>);
    const img = screen.getByAltText("the map");
    expect(img.getAttribute("src")).toMatch(/images\/map\.jpg$/);
  });
});
