import { defineConfig } from "vitepress";

// The public documentation site (issue #168), published to GitHub Pages at
// tomjn.github.io/coilbox/. It renders the user guides in `docs/`; internal design
// artifacts (superpowers plans/specs), mockups, and idea drafts are excluded.
// Kept separate from the Tauri app build — this is driven by the `docs:*` scripts.
export default defineConfig({
  title: "Coilbox",
  description:
    "Desktop tooling for the Recoil RTS engine and the Beyond All Reason community.",
  // Project pages live under a repo-named path.
  base: "/coilbox/",
  lang: "en-US",
  cleanUrls: true,
  // The guides cross-link to repo files (CONTRIBUTING.md, source paths) that aren't
  // part of the site; don't fail the build on those.
  ignoreDeadLinks: true,
  head: [["link", { rel: "icon", href: "/coilbox/app-icon.png" }]],
  // Keep internal/design docs off the public site.
  srcExclude: ["**/superpowers/**", "mockups/**", "ideas-*.md", "README.md"],
  themeConfig: {
    logo: "/app-icon.png",
    nav: [
      { text: "Guides", link: "/portable-mode" },
      {
        text: "Download",
        link: "https://github.com/tomjn/coilbox/releases/latest",
      },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [{ text: "Overview", link: "/" }],
      },
      {
        text: "Guides",
        items: [
          { text: "Portable mode", link: "/portable-mode" },
          { text: "Distribution profile", link: "/distribution-profile" },
          { text: "Routes", link: "/routes" },
        ],
      },
      {
        text: "Game modes",
        items: [
          { text: "Campaigns", link: "/campaigns" },
          { text: "Galactic conquest", link: "/conquest" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/tomjn/coilbox" }],
    footer: {
      message:
        "MIT-licensed. Bundles pr-downloader (GPL-2.0-or-later, © the Spring/Recoil authors).",
      copyright: "Coilbox",
    },
    search: { provider: "local" },
  },
});
