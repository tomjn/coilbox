// @vitest-environment happy-dom

/**
 * What happens when somebody clicks a link on a distribution's markdown page
 * (issues #1783 and #1786).
 *
 * `./pageLinks.test.ts` covers where each `href` spelling points, and notices
 * nothing about the click. The bug this file drives is the one link the click
 * never looked at: a link to a file bundled in `.coilbox` was rendered as a bare
 * anchor, so the webview followed it and drew the file over the whole app until
 * it was restarted. `./welcomeActionRef.dom.test.tsx` drives the same stranding
 * on the welcome screen and the home page's markup, which is the same bug on a
 * different surface.
 *
 * So each case is a real click on a real page, through the real markdown render,
 * asserting whether the webview was allowed to follow the link, whether the app
 * moved, and what the OS was asked to do.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stands in for the Rust side and the system browser. `vi.hoisted` so the mock
// factories below, which are hoisted above the imports, can reach them.
const { openUrl, profileOpen, notify } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
  profileOpen: vi.fn(async (_args: { path: string }) => ({
    action: "open" as const,
  })),
  notify: vi.fn(async (_input: { title: string; body?: string }) => {}),
}));

// The real one reaches sonner and the Tauri window. What matters here is only
// that a click that achieved nothing said so.
vi.mock("../notify/notify", () => ({ notify }));

// Matching `./pageLinks.test.ts`: the link classifier reaches refs/pages, whose
// published `defineCommand` will not load under Vitest's resolver. `profile_open`
// gets a real spy, because what it was asked to act on is what these cases assert.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: (_plugin: string, command: string) =>
    command === "profile_open" ? profileOpen : async () => ({}),
}));

// A widget embed pulls in most of the app, and no case here embeds one.
vi.mock("./widgets", () => ({ PageWidget: () => null }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { MarkdownPage } from "./CustomPage";

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

/** Render a page as a distribution would ship it. */
function renderPage(markdown: string) {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <MarkdownPage
        page={{
          route: "pages/about",
          title: "About",
          nav: true,
          order: 0,
          body: markdown,
        }}
      />
      <Where />
    </MemoryRouter>,
  );
}

/** Where the router ended up. */
function routeNow() {
  return screen.getByTestId("where").textContent;
}

/** Render a one-link page, click the link, and report what the click did. */
function clickLink(markdown: string) {
  renderPage(markdown);
  const link = screen.getByRole("link");
  // `fireEvent` hands back the `dispatchEvent` result, which is false exactly
  // when something called `preventDefault`.
  const followed = fireEvent.click(link);
  return { followed, at: routeNow(), link };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
  profileOpen.mockReset();
  profileOpen.mockResolvedValue({ action: "open" });
  notify.mockReset();
  notify.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a link on a distribution's markdown page", () => {
  it("gives the file to the OS rather than drawing it over the app", () => {
    const { followed, at, link } = clickLink(
      "[our logo](@.coilbox/images/logo.webp)",
    );
    // The href is still the asset URL, so the link reads as a link and can be
    // copied. It is the click that must not reach the webview.
    expect(link.getAttribute("href")).toMatch(/coilbox/);
    expect(followed).toBe(false);
    expect(at).toBe("/");
    // The path stays relative to the `.coilbox` folder. Nothing in the webview
    // knows or builds a filesystem path, because Rust owns where that folder is.
    expect(profileOpen).toHaveBeenCalledWith({ path: "images/logo.webp" });
  });

  it("does the same for a plain relative link, which means the same file", () => {
    const { followed } = clickLink("[our guide](docs/guide.pdf)");
    expect(followed).toBe(false);
    expect(profileOpen).toHaveBeenCalledWith({ path: "docs/guide.pdf" });
  });

  it("is still not followed when the file cannot be opened or shown", async () => {
    // The failure that must not fall back to letting the webview navigate,
    // because that is the bug. The click says so instead: in the console for
    // whoever wrote the link, and on screen for the reader, who would otherwise
    // be looking at a link that ignored them (issue #1802).
    profileOpen.mockRejectedValue(new Error("there is no file at that path"));
    const { followed, at } = clickLink(
      "[our logo](@.coilbox/images/logo.webp)",
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("images/logo.webp"),
        expect.any(Error),
      ),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        body: "there is no file at that path",
      }),
    );
  });

  it("is a link even when the page only wrote the URL", () => {
    // Autolinking (issue #1791) makes an anchor out of text nobody wrote as a
    // link, so it has to land on the same guard: the OS opens it and the
    // webview never follows it off the page.
    const { followed, at, link } = clickLink(
      "Ask us at https://discord.gg/example",
    );
    expect(link.getAttribute("href")).toBe("https://discord.gg/example");
    expect(followed).toBe(false);
    expect(at).toBe("/");
    expect(openUrl).toHaveBeenCalledWith("https://discord.gg/example");
  });

  it("still hands an external link to the OS and an in-app link to the router", () => {
    const external = clickLink("[Discord](https://discord.gg/example)");
    expect(external.followed).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("https://discord.gg/example");
    expect(profileOpen).not.toHaveBeenCalled();
    cleanup();

    const route = clickLink("[Play](@route/singleplayer)");
    expect(route.followed).toBe(false);
    expect(route.at).toBe("/singleplayer");
  });
});

/**
 * A `#` link points inside the page rather than out of it, which is the one link
 * kind Coilbox cannot let the webview follow and cannot hand to anything else:
 * the app reads the hash as its route, so following one moves the app off the
 * page (issue #1805). So the click scrolls by hand.
 */
describe("a link to a heading on a distribution's markdown page", () => {
  /** What `scrollIntoView` was called on, newest last. */
  let scrolled: Element[] = [];

  beforeEach(() => {
    scrolled = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
  });

  it("scrolls to the heading rather than moving the app", () => {
    renderPage("[Installing](#installing)\n\n## Installing\n\nRun it.");
    const followed = fireEvent.click(screen.getByRole("link"));
    // The heading has an id to point at, which markdown does not give it.
    const heading = screen.getByRole("heading", { name: "Installing" });
    expect(heading.id).toBe("installing");
    expect(scrolled).toEqual([heading]);
    // And nothing reached the webview or the router on the way.
    expect(followed).toBe(false);
    expect(routeNow()).toBe("/");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("does nothing when no heading on the page has that id", () => {
    // The author's typo, which must not throw and must not navigate. It says
    // which link it was, so the author can find it.
    renderPage("[Installing](#instaling)\n\n## Installing");
    const followed = fireEvent.click(screen.getByRole("link"));
    expect(scrolled).toEqual([]);
    expect(followed).toBe(false);
    expect(routeNow()).toBe("/");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("#instaling"),
    );
  });

  it("takes a footnote to its note and the note back to the text", () => {
    // Nobody wrote either of these links. GFM (issue #1791) makes both out of
    // `[^1]`, which is why the anchor click had to work rather than be refused.
    renderPage("Cheaper now[^1].\n\n[^1]: Since 1.2.");
    const [toNote, backAgain] = screen.getAllByRole("link");
    fireEvent.click(toNote);
    fireEvent.click(backAgain);
    expect(scrolled.map((el) => el.id)).toEqual([
      "user-content-fn-1",
      "user-content-fnref-1",
    ]);
    expect(routeNow()).toBe("/");
  });
});
