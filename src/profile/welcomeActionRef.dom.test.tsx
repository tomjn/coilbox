// @vitest-environment happy-dom

/**
 * What happens when somebody clicks a link in a distribution's own markup
 * (issue #1062).
 *
 * `./welcomeActions.test.ts` covers which marker resolves to which action, and
 * notices nothing about the anchor the marker is written on. The bug this file
 * drives is the anchor Coilbox never looked at: a link with no marker, or with a
 * marker that does not resolve, was followed by the webview, which took the app
 * off screen until it was restarted.
 *
 * So each case is a real click on real markup, through the real asset rewrite,
 * asserting the two things the author cares about: whether the webview was
 * allowed to follow the link, and whether the app moved.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Matching `./welcomeActions.test.ts`: the route classifier reaches refs/pages,
// whose published `defineCommand` will not load under Vitest's resolver.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a link in distribution markup", () => {
  it("is not followed when a relative href has become an asset URL", () => {
    const { followed, at, href } = clickLink(
      '<a data-testid="link" href="images/logo.webp">Our logo</a>',
    );
    // The rewrite ran, so this is the shape the guard actually meets.
    expect(href.getAttribute("href")).toMatch(/^coilbox:/);
    expect(followed).toBe(false);
    expect(at).toBe("/");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("images/logo.webp"),
    );
  });

  it("is not followed when it is an asset URL in the Windows spelling", () => {
    // Windows serves `coilbox://` as `http://coilbox.localhost/`, which would
    // otherwise read as an ordinary `http:` link and be let through there only.
    const { followed, at } = clickLink(
      '<a data-testid="link" href="http://coilbox.localhost/portable/images/logo.webp">Our logo</a>',
    );
    expect(followed).toBe(false);
    expect(at).toBe("/");
  });

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

  it("is followed when it is an external link", () => {
    for (const href of [
      "https://example.org/forum",
      "http://example.org/forum",
      "mailto:someone@example.org",
      "tel:+441234567890",
    ]) {
      const { followed } = clickLink(
        `<a data-testid="link" href="${href}">Elsewhere</a>`,
      );
      expect(followed, href).toBe(true);
      expect(console.warn).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("is followed when it is a hash link, which is how in-app links are written", () => {
    for (const href of ["#/play/skirmish", "#news"]) {
      const { followed } = clickLink(
        `<a data-testid="link" href="${href}">Inside</a>`,
      );
      expect(followed, href).toBe(true);
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
