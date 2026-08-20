// @vitest-environment happy-dom

/**
 * What happens when somebody clicks a link on a distribution's markdown page
 * (issue #1783).
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

// Matching `./pageLinks.test.ts`: the link classifier reaches refs/pages, whose
// published `defineCommand` will not load under Vitest's resolver.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

// A widget embed pulls in most of the app, and no case here embeds one.
vi.mock("./widgets", () => ({ PageWidget: () => null }));

// Stands in for the OS file manager and browser. `vi.hoisted` so the mock
// factories below, which are hoisted above the imports, can reach them.
const { openUrl, revealItemInDir, root } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
  revealItemInDir: vi.fn(async (_path: string) => {}),
  root: { path: "/pkg/.coilbox" },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl, revealItemInDir }));
vi.mock("./profile", () => ({ getProfileRoot: () => root.path }));

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
  root.path = "/pkg/.coilbox";
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
  revealItemInDir.mockReset();
  revealItemInDir.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a link on a distribution's markdown page", () => {
  it("shows the file in the file manager rather than drawing it over the app", () => {
    const { followed, at, link } = clickLink(
      "[our logo](@.coilbox/images/logo.webp)",
    );
    // The href is still the asset URL, so the link reads as a link and can be
    // copied. It is the click that must not reach the webview.
    expect(link.getAttribute("href")).toMatch(/coilbox/);
    expect(followed).toBe(false);
    expect(at).toBe("/");
    expect(revealItemInDir).toHaveBeenCalledWith(
      "/pkg/.coilbox/images/logo.webp",
    );
  });

  it("does the same for a plain relative link, which means the same file", () => {
    const { followed } = clickLink("[our guide](docs/guide.pdf)");
    expect(followed).toBe(false);
    expect(revealItemInDir).toHaveBeenCalledWith(
      "/pkg/.coilbox/docs/guide.pdf",
    );
  });

  it("is still not followed when the OS refuses to show the file", async () => {
    // The failure that must not fall back to letting the webview navigate,
    // because that is the bug. The click says so in the console instead.
    revealItemInDir.mockRejectedValue(new Error("no such file"));
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

  it("is still not followed when there is no .coilbox folder to look in", () => {
    // Off the portable path there is no folder to point at. The click says which
    // link it was, because a click that silently does nothing is its own puzzle.
    root.path = "";
    const { followed, at } = clickLink(
      "[our logo](@.coilbox/images/logo.webp)",
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
    expect(revealItemInDir).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("images/logo.webp"),
    );
  });

  it("still hands an external link to the OS and an in-app link to the router", () => {
    const external = clickLink("[Discord](https://discord.gg/example)");
    expect(external.followed).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("https://discord.gg/example");
    expect(revealItemInDir).not.toHaveBeenCalled();
    cleanup();

    const route = clickLink("[Play](@route/singleplayer)");
    expect(route.followed).toBe(false);
    expect(route.at).toBe("/singleplayer");
  });
});
