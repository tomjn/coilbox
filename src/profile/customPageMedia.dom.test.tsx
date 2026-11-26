// @vitest-environment happy-dom

/**
 * Which file a distribution page's inline picture asks the `coilbox://` protocol
 * for (issue #5483). The protocol decodes the URL once, so the page has to encode
 * the author's file name exactly once.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The link classifier reaches refs/pages, whose published `defineCommand` will
// not load under Vitest's resolver.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

// A widget embed pulls in most of the app, and no case here embeds one.
vi.mock("./widgets", () => ({ PageWidget: () => null }));

import { MarkdownPage } from "./CustomPage";

function renderPage(body: string, background?: string) {
  return render(
    <MemoryRouter>
      <MarkdownPage
        page={{
          route: "pages/about",
          title: "About",
          nav: true,
          order: 0,
          body,
          background,
        }}
      />
    </MemoryRouter>,
  );
}

const srcOf = (alt: string) => screen.getByAltText(alt).getAttribute("src");

afterEach(cleanup);

describe("inline media on a distribution's markdown page", () => {
  it("encodes the name the author wrote once", () => {
    renderPage("![the art](<images/my art é.jpg>)");

    expect(srcOf("the art")).toBe(
      "coilbox://localhost/portable/images/my%20art%20%C3%A9.jpg",
    );
  });

  it("reads a name the author percent encoded as the same file", () => {
    renderPage("![the art](images/my%20art.jpg)");

    expect(srcOf("the art")).toBe(
      "coilbox://localhost/portable/images/my%20art.jpg",
    );
  });

  it("uses a web address as it is written", () => {
    renderPage("![far](<https://example.org/my art.jpg>)");

    expect(srcOf("far")).toBe("https://example.org/my%20art.jpg");
  });

  it("takes a background name from front matter as it is spelled", () => {
    // Front matter does not go through Markdown, so nothing encoded this name.
    const { container } = renderPage("Hello", "images/100%25 ready.jpg");

    expect(
      container.querySelector<HTMLElement>("[aria-hidden]")?.style
        .backgroundImage,
    ).toContain("/portable/images/100%2525%20ready.jpg");
  });
});
