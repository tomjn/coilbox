import { defineConfig } from "vitepress";

// The public gallery, where people share what they make in Coilbox. Kept as one
// constant because it is linked from the nav, the sidebar and two places on the
// homepage. Matches DEFAULT_HUB_URL in src/hub/config.ts, which is where the app
// itself points.
const HUB_URL = "https://coilbox-hub.vercel.app";

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
  head: [["link", { rel: "icon", href: "/coilbox/favicon.ico" }]],
  // Keep internal/design docs off the public site.
  srcExclude: [
    "**/superpowers/**",
    "mockups/**",
    "reports/**",
    "ideas-*.md",
    "README.md",
  ],
  themeConfig: {
    logo: "/app-icon.png",
    // Long guides are hard to scan; surface a per-page table of contents in the
    // right rail that includes both h2 and h3 headings (default is h2 only).
    outline: { level: [2, 3], label: "On this page" },
    nav: [
      { text: "Guides", link: "/portable-mode" },
      { text: "Hub", link: HUB_URL },
      {
        text: "Download",
        link: "https://github.com/tomjn/coilbox/releases/latest",
      },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Overview", link: "/" },
          { text: "Community hub", link: HUB_URL },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Battle presets", link: "/presets" },
          { text: "Portable mode", link: "/portable-mode" },
          { text: "Distribution profile", link: "/distribution-profile" },
          { text: "Branding catalog", link: "/branding-catalog" },
          { text: "Map packs", link: "/map-packs" },
          { text: "Routes", link: "/routes" },
          { text: "The s3o model format", link: "/s3o-format" },
          { text: "The 3do model format", link: "/3do-format" },
          { text: "The unit builder", link: "/lego-builder" },
          { text: "Lego parts pack", link: "/lego-parts-pack" },
          { text: "The mission runtime", link: "/mission-runtime" },
          { text: "Lobby moderation", link: "/lobby-moderation" },
          { text: "Tachyon protocol", link: "/tachyon-protocol" },
        ],
      },
      {
        text: "Game modes",
        items: [
          { text: "Campaigns", link: "/campaigns" },
          { text: "Scenarios", link: "/scenarios" },
          { text: "Galactic conquest", link: "/conquest" },
          { text: "Roguelite run", link: "/roguelite-run" },
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
