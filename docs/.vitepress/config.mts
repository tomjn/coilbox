import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitepress";

// The public gallery, where people share what they make in Coilbox. Kept as one
// constant because it is linked from the nav, the sidebar and two places on the
// homepage. Matches DEFAULT_HUB_URL in src/hub/config.ts, which is where the app
// itself points.
const HUB_URL = "https://coilbox-hub.vercel.app";

// Notes on formats and protocols other projects own are kept in the repo for
// people working on coilbox and are not published. Their old addresses forward
// to the file on GitHub.
const INTERNAL_URL = "https://github.com/tomjn/coilbox/blob/main/docs/internal";

// Every page sat at the site root until the pages were grouped by reader.
// Released builds of the app link to some of the old addresses, so each old
// address still answers, with a page that forwards to the new one.
const MOVED: Record<string, string> = {
  presets: "players/presets",
  "portable-mode": "players/portable-mode",
  conquest: "players/conquest",
  "roguelite-run": "players/warpath",
  distributing: "developers/distributing",
  "distribution-profile": "developers/distribution-profile",
  "branding-catalog": "developers/branding-catalog",
  "map-packs": "developers/map-packs",
  "teaching-your-game": "developers/teaching-your-game",
  campaigns: "developers/campaigns",
  scenarios: "developers/scenarios",
  "mission-runtime": "developers/mission-runtime",
  "hand-made-maps": "developers/hand-made-maps",
  "lego-builder": "developers/lego-builder",
  "lobby-moderation": "staff/lobby-moderation",
  "server-admin": "staff/server-admin",
  routes: "reference/routes",
  "replay-data-sources": "reference/replay-data-sources",
  "s3o-format": `${INTERNAL_URL}/s3o-format.md`,
  "3do-format": `${INTERNAL_URL}/3do-format.md`,
  "lego-parts-pack": "reference/lego-parts-pack",
  "tachyon-protocol": `${INTERNAL_URL}/tachyon-protocol.md`,
};

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
    "examples/**",
    "reports/**",
    "internal/**",
    "ideas-*.md",
    "README.md",
  ],
  themeConfig: {
    logo: "/app-icon.png",
    // Long guides are hard to scan; surface a per-page table of contents in the
    // right rail that includes both h2 and h3 headings (default is h2 only).
    outline: { level: [2, 3], label: "On this page" },
    nav: [
      { text: "Players", link: "/players/", activeMatch: "^/players/" },
      {
        text: "Game developers",
        link: "/developers/",
        activeMatch: "^/developers/",
      },
      {
        text: "Server staff",
        link: "/staff/server-admin",
        activeMatch: "^/staff/",
      },
      { text: "Reference", link: "/reference/", activeMatch: "^/reference/" },
      { text: "Hub", link: HUB_URL },
      {
        text: "Download",
        link: "https://github.com/tomjn/coilbox/releases/latest",
      },
    ],
    // One sidebar per kind of reader, chosen by the folder a page is in, so a
    // player never has to scan past file formats and a game developer never
    // has to scan past moderation tools.
    sidebar: {
      "/players/": [
        {
          text: "Player guides",
          items: [{ text: "Overview", link: "/players/" }],
        },
        {
          text: "Play",
          items: [
            { text: "Singleplayer battles", link: "/players/singleplayer" },
            { text: "Sign in and chat", link: "/players/lobby-and-chat" },
            { text: "Multiplayer battles", link: "/players/multiplayer" },
            {
              text: "Campaigns and scenarios",
              link: "/players/campaigns-and-scenarios",
            },
            { text: "Replays", link: "/players/replays" },
            {
              text: "Career and player stats",
              link: "/players/career-and-stats",
            },
            { text: "Battle presets", link: "/players/presets" },
            { text: "Galactic conquest", link: "/players/conquest" },
            { text: "Warpath", link: "/players/warpath" },
            { text: "Replay rewind", link: "/players/replay-rewind" },
          ],
        },
        {
          text: "Library",
          items: [
            { text: "Maps, games and units", link: "/players/library" },
            { text: "Base blueprints", link: "/players/blueprints" },
          ],
        },
        {
          text: "Set up",
          items: [
            {
              text: "Get games, maps and engines",
              link: "/players/downloads",
            },
            { text: "Settings and keybinds", link: "/players/settings" },
            { text: "Portable mode", link: "/players/portable-mode" },
          ],
        },
        {
          text: "Share",
          items: [
            { text: "The Coilbox hub", link: "/players/hub" },
            { text: "Community hub", link: HUB_URL },
          ],
        },
      ],
      "/developers/": [
        {
          text: "Game developer guides",
          items: [{ text: "Overview", link: "/developers/" }],
        },
        {
          text: "Ship coilbox with your game",
          items: [
            {
              text: "Package coilbox with your game",
              link: "/developers/distributing",
            },
            {
              text: "Distribution profiles",
              link: "/developers/distribution-profile",
            },
            { text: "Branding catalog", link: "/developers/branding-catalog" },
            { text: "Map packs", link: "/developers/map-packs" },
          ],
        },
        {
          text: "Campaigns and missions",
          items: [
            { text: "Campaigns", link: "/developers/campaigns" },
            { text: "Scenarios", link: "/developers/scenarios" },
            { text: "Mission runtime", link: "/developers/mission-runtime" },
            {
              text: "Make a tutorial campaign",
              link: "/developers/teaching-your-game",
            },
          ],
        },
        {
          text: "Conquest and Warpath",
          items: [
            {
              text: "Set up conquest for your game",
              link: "/developers/conquest-for-your-game",
            },
            { text: "Hand-made maps", link: "/developers/hand-made-maps" },
          ],
        },
        {
          text: "Maps",
          items: [
            {
              text: "Compile and decompile maps",
              link: "/developers/mapping-tools",
            },
          ],
        },
        {
          text: "Units",
          items: [
            { text: "Unit builder", link: "/developers/lego-builder" },
            {
              text: "What the engine reloads",
              link: "/developers/engine-reload",
            },
            { text: "Unit tweaks", link: "/developers/unit-tweaks" },
            {
              text: "Convert and compile unit scripts",
              link: "/developers/animation-tools",
            },
          ],
        },
        {
          text: "Replays",
          items: [
            {
              text: "Replay rewind for your game",
              link: "/developers/replay-rewind",
            },
          ],
        },
        {
          text: "Tools",
          items: [
            {
              text: "Browse archives and run Lua",
              link: "/developers/archives",
            },
          ],
        },
      ],
      "/staff/": [
        {
          text: "Server staff",
          items: [
            { text: "Server admin", link: "/staff/server-admin" },
            { text: "Lobby moderation", link: "/staff/lobby-moderation" },
            { text: "Load testing", link: "/staff/uberstress" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [{ text: "Overview", link: "/reference/" }],
        },
        {
          text: "Coilbox",
          items: [
            {
              text: "Routes and navigation ids",
              link: "/reference/routes",
            },
            {
              text: "Replay data sources",
              link: "/reference/replay-data-sources",
            },
            { text: "Parts pack format", link: "/reference/lego-parts-pack" },
            {
              text: "Replay track format",
              link: "/reference/replay-track-format",
            },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/tomjn/coilbox" }],
    footer: {
      message:
        "MIT-licensed, and the Lua that runs in the engine is MIT or GPL-2.0-or-later. Bundles pr-downloader (GPL-2.0-or-later, © the Spring/Recoil authors).",
      copyright: "Coilbox",
    },
    search: { provider: "local" },
  },
  buildEnd({ outDir, site }) {
    for (const [from, to] of Object.entries(MOVED)) {
      const url = to.startsWith("https://") ? to : `${site.base}${to}`;
      writeFileSync(
        join(outDir, `${from}.html`),
        `<!doctype html><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="${url}"><meta http-equiv="refresh" content="0; url=${url}"><script>location.replace(${JSON.stringify(url)} + location.hash)</script><p>This page moved to <a href="${url}">${url}</a>.</p>\n`,
      );
    }
  },
});
