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
const { openUrl, profileOpen } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
  profileOpen: vi.fn(async (_args: { path: string }) => ({
    action: "open" as const,
  })),
}));

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

/** Render a one-link page, click the link, and report what the click did. */
function clickLink(markdown: string) {
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
  const link = screen.getByRole("link");
  // `fireEvent` hands back the `dispatchEvent` result, which is false exactly
  // when something called `preventDefault`.
  const followed = fireEvent.click(link);
  return { followed, at: screen.getByTestId("where").textContent, link };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
  profileOpen.mockReset();
  profileOpen.mockResolvedValue({ action: "open" });
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
    // because that is the bug. The click says so in the console instead.
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
