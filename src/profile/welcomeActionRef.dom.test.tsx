// @vitest-environment happy-dom

/**
 * What happens when somebody clicks a link in a distribution's own markup
 * (issues #1062 and #1777).
 *
 * `./welcomeActions.test.ts` covers which marker resolves to which action, and
 * notices nothing about the anchor the marker is written on. The bug this file
 * drives is the anchor Coilbox never looked at: a link with no marker, or with a
 * marker that does not resolve, was followed by the webview, which took the app
 * off screen until it was restarted. A working `https:` link did the same thing,
 * because the webview follows that one just as happily.
 *
 * So each case is a real click on real markup, through the real asset rewrite,
 * asserting the three things the author cares about: whether the webview was
 * allowed to follow the link, whether the app moved, and what the OS was asked
 * to open.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stands in for the OS browser, mail client and dialler, for the Rust side, and
// for the toast. `vi.hoisted` so the mock factories below, which are hoisted
// above the imports, can reach them.
const { openUrl, profileOpen, notify } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
  profileOpen: vi.fn(async (_args: { path: string }) => ({
    action: "open" as const,
  })),
  notify: vi.fn(async (_input: { title: string; body?: string }) => {}),
}));

// Matching `./welcomeActions.test.ts`: the route classifier reaches refs/pages,
// whose published `defineCommand` will not load under Vitest's resolver.
// `profile_open` gets a real spy, because what it was asked to act on is what
// the bundled-file cases assert.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: (_plugin: string, command: string) =>
    command === "profile_open" ? profileOpen : async () => ({}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

// The real one reaches sonner and the Tauri window. What matters here is only
// that a click that achieved nothing said so.
vi.mock("../notify/notify", () => ({ notify }));

import { useWelcomeActionRef } from "./welcomeActionRef";
import { rewriteBrandedHtml } from "./welcomeAssets";

/** The markup block, mounted the way `BrandedWelcome` and `HomeMarkup` mount it. */
function Markup({ html }: { html: string }) {
  const ref = useWelcomeActionRef();
  return (
    <div
      ref={ref}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the same trusted distribution markup the app injects
      dangerouslySetInnerHTML={{ __html: rewriteBrandedHtml(html) }}
    />
  );
}

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

/** Click the one link in `html`, and report what the click did. */
function clickLink(html: string) {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Markup html={html} />
      <Where />
    </MemoryRouter>,
  );
  const link = screen.getByTestId("link");
  // `fireEvent` hands back the `dispatchEvent` result, which is false exactly
  // when something called `preventDefault`.
  const followed = fireEvent.click(link);
  return { followed, at: screen.getByTestId("where").textContent, href: link };
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

describe("a link in distribution markup", () => {
  it("is not followed when a route reference has lost its marker", () => {
    const { followed, at } = clickLink(
      '<a data-testid="link" href="@route/play/replays">Replays</a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("@route/play/replays"),
    );
  });

  it("is not followed when its marker names an action that does not resolve", () => {
    const { followed, at } = clickLink(
      '<a data-testid="link" data-coilbox-action="navigate" href="@widget/build-tree">Build tree</a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
  });

  it("is not followed when it is an app-absolute path", () => {
    // A full page load dressed as in-app navigation. `#/play/replays` is the
    // spelling that works, and the warning says so.
    const { followed, at } = clickLink(
      '<a data-testid="link" href="/play/replays">Replays</a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
  });

  it("is not followed when its href is empty, which would reload the app", () => {
    const { followed, at } = clickLink(
      '<a data-testid="link" href="">Home</a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
  });

  it("goes to the OS rather than the webview when it is an external link", () => {
    // The four schemes that leave Coilbox for another program. Following any of
    // them in the webview loads the site over the app with no way back, which is
    // the whole of issue #1777, so each one is handed to the OS instead.
    for (const href of [
      "https://example.org/forum",
      "http://example.org/forum",
      "mailto:someone@example.org",
      "tel:+441234567890",
    ]) {
      openUrl.mockClear();
      const { followed, at } = clickLink(
        `<a data-testid="link" href="${href}">Elsewhere</a>`,
      );
      expect(openUrl, href).toHaveBeenCalledWith(href);
      expect(followed, href).toBe(false);
      expect(at, href).toBe("/");
      expect(console.warn).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("is still not followed when the OS refuses to open it", async () => {
    // The failure that must not fall back to letting the webview navigate,
    // because that is the bug. The click says so in the console instead.
    openUrl.mockRejectedValue(new Error("no handler"));
    const { followed, at } = clickLink(
      '<a data-testid="link" href="https://example.org/forum">Elsewhere</a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("https://example.org/forum"),
        expect.any(Error),
      ),
    );
  });

  it("is followed when it is a hash link, which is how in-app links are written", () => {
    for (const href of ["#/play/skirmish", "#news"]) {
      const { followed } = clickLink(
        `<a data-testid="link" href="${href}">Inside</a>`,
      );
      expect(followed, href).toBe(true);
      // An in-app link, so nothing goes to the OS.
      expect(openUrl, href).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("still navigates for a marker written on an anchor", () => {
    const { followed, at } = clickLink(
      '<a data-testid="link" data-coilbox-action="navigate" href="@route/play/replays">Replays</a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/play/replays");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("reads the link a click landed inside, not only the click target", () => {
    const { followed, at } = clickLink(
      '<a href="@route/play/replays"><img data-testid="link" src="art/replays.png" alt="Replays"></a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
  });

  it("leaves a click on ordinary markup alone", () => {
    const { followed, at } = clickLink('<p data-testid="link">Welcome</p>');
    expect(followed).toBe(true);
    expect(at).toBe("/");
    expect(console.warn).not.toHaveBeenCalled();
  });
});

/**
 * A link to a file the distribution bundled in its `.coilbox` folder (issue
 * #1802). It used to be swallowed here while the same link on a markdown page
 * opened the file, so the welcome screen read as broken rather than as strict.
 *
 * The asset rewrite has already turned every spelling of the path into the same
 * `coilbox://` URL by the time the click lands, so these cases are what the
 * handler actually meets rather than what the author typed.
 */
describe("a link in distribution markup to a bundled file", () => {
  it("gives the file to the OS rather than drawing it over the app", () => {
    const { followed, at, href } = clickLink(
      '<a data-testid="link" href="docs/guide.pdf">Our guide</a>',
    );
    // The href is still the asset URL, so the link reads as a link. It is the
    // click that must not reach the webview.
    expect(href.getAttribute("href")).toMatch(/^coilbox:/);
    expect(followed).toBe(false);
    expect(at).toBe("/");
    // The path stays relative to the `.coilbox` folder. Nothing in the webview
    // knows or builds a filesystem path, because Rust owns where that folder is.
    expect(profileOpen).toHaveBeenCalledWith({ path: "docs/guide.pdf" });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does the same for the Windows spelling of the same URL", () => {
    // Windows serves `coilbox://` as `http://coilbox.localhost/`, which must not
    // read as an ordinary `http:` link and go to the browser there only.
    const { followed } = clickLink(
      '<a data-testid="link" href="http://coilbox.localhost/portable/docs/guide.pdf">Our guide</a>',
    );
    expect(followed).toBe(false);
    expect(profileOpen).toHaveBeenCalledWith({ path: "docs/guide.pdf" });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("does the same for a marker that names the file rather than a route", () => {
    // `data-coilbox-route` is not rewritten, so this is the one place the raw
    // `@.coilbox/` reference still reaches the handler.
    const { followed, at } = clickLink(
      '<a data-testid="link" data-coilbox-action="navigate" data-coilbox-route="@.coilbox/docs/guide.pdf">Our guide</a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
    expect(profileOpen).toHaveBeenCalledWith({ path: "docs/guide.pdf" });
  });

  it("says so when the file cannot be opened or shown", async () => {
    // The welcome screen is the first thing somebody sees, so a click that
    // achieved nothing has to be visible rather than console-only.
    profileOpen.mockRejectedValue(
      new Error("there is no file at docs/guide.pdf"),
    );
    const { followed, at } = clickLink(
      '<a data-testid="link" href="docs/guide.pdf">Our guide</a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          body: "there is no file at docs/guide.pdf",
        }),
      ),
    );
  });

  it("does not act on an asset URL under another root", () => {
    // `campaign/` and the other roots are Coilbox's own storage, not files the
    // distribution bundled, so a link to one is an author's mistake.
    const { followed } = clickLink(
      '<a data-testid="link" href="coilbox://localhost/campaign/camp-1/a.mp4">A clip</a>',
    );
    expect(followed).toBe(false);
    expect(profileOpen).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("does not act on a path that climbs out of the folder", () => {
    // Rust refuses this too, but refusing it here keeps it an author's mistake
    // in the console rather than an error shown to the reader.
    const { followed } = clickLink(
      '<a data-testid="link" href="../../secrets.txt">Nothing to see</a>',
    );
    expect(followed).toBe(false);
    expect(profileOpen).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});
