---
layout: home

hero:
  name: Coilbox
  text: Desktop tooling for Recoil & Beyond All Reason
  tagline: Browse and download games, maps and engines, host and join battles, run campaigns and galactic conquest — in one Tauri desktop app.
  image:
    src: /app-icon.png
    alt: Coilbox
  actions:
    - theme: brand
      text: Download
      link: https://github.com/tomjn/coilbox/releases/latest
    - theme: alt
      text: Guides
      link: /portable-mode
    - theme: alt
      text: GitHub
      link: https://github.com/tomjn/coilbox

features:
  - title: Content, handled
    details: Browse the Spring/Recoil rapid repositories and springfiles, and download games, maps and engines through a bundled pr-downloader sidecar — including curated map packs in one click.
  - title: Play together
    details: A built-in lobby client — chat channels, battle rooms, self-hosting, and moderation tools — plus singleplayer skirmish, campaigns, and galactic conquest.
  - title: Brandable & portable
    details: Ship a distribution profile to reskin and narrow Coilbox for your game, or run it fully portable from a folder next to the executable.
---

## Screenshots

> Placeholder captures — a curated set is on the way.

![Coilbox lobby](/screenshots/lobby.png)

![Coilbox content](/screenshots/content.png)

## Install

Download the build for your OS from [Releases](https://github.com/tomjn/coilbox/releases/latest).

### macOS

The app is ad-hoc signed but **not notarized** (no Apple Developer account), so Gatekeeper blocks it on first launch. After copying Coilbox to Applications, clear the download quarantine:

```sh
xattr -dr com.apple.quarantine /Applications/Coilbox.app
```

(or right-click the app → Open, then confirm in System Settings → Privacy & Security). This is a one-time step per download. macOS builds are Apple Silicon (arm64) only.

### Windows & Linux

Download and run the installer / AppImage from the [latest release](https://github.com/tomjn/coilbox/releases/latest).

## Learn more

- [Portable mode](/portable-mode) — run Coilbox from a self-contained folder.
- [Distribution profile](/distribution-profile) — reskin and narrow Coilbox for a specific game.
- [Campaigns](/campaigns) and [Galactic conquest](/conquest) — the singleplayer game modes.
- [Routes](/routes) — the app's screen map.
