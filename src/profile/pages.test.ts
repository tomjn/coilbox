import { describe, expect, it, vi } from "vitest";

// pages.ts imports defineCommand from @picoframe/plugin-sdk (and, via links.ts, the
// profile module) whose published dist won't load under Vitest's node resolver. These
// tests exercise only the pure parser/builders, so stubbing the leaf lets it load.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import {
  buildPageNav,
  buildProfilePages,
  expandIncludes,
  type PageFile,
  parseFrontmatter,
} from "./pages";

describe("parseFrontmatter", () => {
  it("returns the whole file as body when there's no frontmatter", () => {
    expect(parseFrontmatter("# Hello\n\nBody")).toEqual({
      data: {},
      body: "# Hello\n\nBody",
    });
  });

  it("parses scalars, coercing booleans and numbers, stripping quotes", () => {
    const raw = [
      "---",
      "title: About Us",
      'path: "about"',
      "nav: false",
      "order: 5",
      "# a comment",
      "",
      "---",
      "The body.",
    ].join("\n");
    const { data, body } = parseFrontmatter(raw);
    expect(data).toEqual({
      title: "About Us",
      path: "about",
      nav: false,
      order: 5,
    });
    expect(body).toBe("The body.");
  });

  it("tolerates CRLF and trailing spaces on the fence", () => {
    const raw = "---\r\ntitle: X\r\n--- \r\nbody";
    expect(parseFrontmatter(raw)).toEqual({
      data: { title: "X" },
      body: "body",
    });
  });
});

const file = (path: string, content: string): PageFile => ({ path, content });

describe("buildProfilePages", () => {
  it("derives a route and title from the filename when frontmatter is bare", () => {
    const pages = buildProfilePages([file("pages/About Us.md", "hi")]);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      route: "pages/about-us",
      title: "about-us",
      nav: true,
      body: "hi",
    });
  });

  it("uses frontmatter path/title/icon/background/group/order", () => {
    const raw = [
      "---",
      "path: rules",
      "title: The Rules",
      "icon: info",
      "background: pages/bg.jpg",
      "group: Info",
      "order: 2",
      "---",
      "Be nice.",
    ].join("\n");
    const [page] = buildProfilePages([file("pages/r.md", raw)]);
    expect(page).toMatchObject({
      route: "pages/rules",
      title: "The Rules",
      icon: "info",
      background: "pages/bg.jpg",
      group: "Info",
      order: 2,
      body: "Be nice.",
    });
  });

  it("namespaces under pages/ and strips a leading slash / .md from the path", () => {
    const [page] = buildProfilePages([
      file("pages/x.md", "---\npath: /guide.md\n---\ng"),
    ]);
    expect(page.route).toBe("pages/guide");
  });

  it("allows nested slugs", () => {
    const [page] = buildProfilePages([
      file("pages/x.md", "---\npath: docs/intro\n---\n"),
    ]);
    expect(page.route).toBe("pages/docs/intro");
  });

  it("drops invalid and duplicate slugs", () => {
    const pages = buildProfilePages([
      file("pages/a.md", "---\npath: bad path!\n---\n"),
      file("pages/b.md", "---\npath: dupe\n---\n"),
      file("pages/c.md", "---\npath: dupe\n---\n"),
    ]);
    expect(pages.map((p) => p.route)).toEqual(["pages/dupe"]);
  });

  it("sorts by order", () => {
    const pages = buildProfilePages([
      file("pages/a.md", "---\npath: a\norder: 20\n---\n"),
      file("pages/b.md", "---\npath: b\norder: 10\n---\n"),
    ]);
    expect(pages.map((p) => p.route)).toEqual(["pages/b", "pages/a"]);
  });
});

describe("expandIncludes", () => {
  // A fake profile_file reader backed by an in-memory map.
  const reader = (files: Record<string, string>) => async (path: string) =>
    path in files ? { text: files[path], ok: true } : { text: "", ok: false };

  it("leaves a body with no include lines unchanged", async () => {
    const body = "# Hi\n\nSome text.";
    expect(await expandIncludes(body, reader({}))).toBe(body);
  });

  it("replaces a lone @.coilbox/*.md line with the referenced file", async () => {
    const body = "before\n@.coilbox/shared.md\nafter";
    const out = await expandIncludes(body, reader({ "shared.md": "SHARED" }));
    expect(out).toBe("before\nSHARED\nafter");
  });

  it("expands includes recursively", async () => {
    const out = await expandIncludes(
      "@.coilbox/a.md",
      reader({ "a.md": "A\n@.coilbox/b.md", "b.md": "B" }),
    );
    expect(out).toBe("A\nB");
  });

  it("ignores an @-ref that isn't alone on its line", async () => {
    const body = "see @.coilbox/x.md for details";
    expect(await expandIncludes(body, reader({ "x.md": "X" }))).toBe(body);
  });

  it("ignores non-.md file refs (only markdown is transcluded)", async () => {
    const body = "@.coilbox/logo.png";
    expect(await expandIncludes(body, reader({ "logo.png": "binary" }))).toBe(
      body,
    );
  });

  it("emits a visible error for a missing include rather than blanking", async () => {
    const out = await expandIncludes("@.coilbox/missing.md", reader({}));
    expect(out).toMatch(/error/i);
    expect(out).toMatch(/missing\.md/);
  });

  it("detects a direct cycle instead of looping forever", async () => {
    const out = await expandIncludes(
      "@.coilbox/loop.md",
      reader({ "loop.md": "@.coilbox/loop.md" }),
      new Set(["pages/host.md"]),
    );
    expect(out).toMatch(/cycle/i);
  });

  it("allows the same fragment included twice in different places", async () => {
    const out = await expandIncludes(
      "@.coilbox/f.md\n---\n@.coilbox/f.md",
      reader({ "f.md": "FRAG" }),
    );
    expect(out).toBe("FRAG\n---\nFRAG");
  });
});

describe("buildPageNav", () => {
  it("returns [] when no page opts into the sidebar", () => {
    const pages = buildProfilePages([
      file("pages/a.md", "---\npath: a\nnav: false\n---\n"),
    ]);
    expect(buildPageNav(pages)).toEqual([]);
  });

  it("puts ungrouped pages in one unlabelled group linking to internal routes", () => {
    const pages = buildProfilePages([
      file("pages/a.md", "---\npath: a\n---\n"),
    ]);
    const nav = buildPageNav(pages);
    expect(nav).toHaveLength(1);
    expect(nav[0].label).toBeUndefined();
    expect(nav[0].items[0]).toMatchObject({
      id: "profile.page.pages/a",
      to: "/pages/a",
    });
  });

  it("collects pages sharing a group under one heading", () => {
    const pages = buildProfilePages([
      file("pages/a.md", "---\npath: a\ngroup: Info\n---\n"),
      file("pages/b.md", "---\npath: b\ngroup: Info\n---\n"),
    ]);
    const nav = buildPageNav(pages);
    expect(nav).toHaveLength(1);
    expect(nav[0].label).toBe("Info");
    expect(nav[0].items.map((i) => i.to)).toEqual(["/pages/a", "/pages/b"]);
  });
});
