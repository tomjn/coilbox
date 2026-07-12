---
layout: home

hero:
  name: Coilbox
  text: Desktop tooling for Recoil RTS & Spring RTS games
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

Click any shot to enlarge.

<div class="screenshot-gallery">
  <figure>
    <label for="lb-lobby"><img src="/screenshots/lobby.png" alt="Coilbox lobby and battle rooms"></label>
    <figcaption>Lobby &amp; battle rooms</figcaption>
  </figure>
  <figure>
    <label for="lb-content"><img src="/screenshots/content.png" alt="Coilbox content browser"></label>
    <figcaption>Content browser</figcaption>
  </figure>
  <figure>
    <label for="lb-branding"><img src="/screenshots/game-branding.png" alt="A branded game detail view with a unit build tree"></label>
    <figcaption>Branded game detail &amp; build tree</figcaption>
  </figure>
  <figure>
    <label for="lb-mission"><img src="/screenshots/mission-briefing.png" alt="A campaign mission briefing screen"></label>
    <figcaption>Campaign mission briefing</figcaption>
  </figure>
  <figure>
    <label for="lb-conquest"><img src="/screenshots/conquest-starfield.png" alt="The galactic conquest strategic starfield map"></label>
    <figcaption>Galactic conquest map</figcaption>
  </figure>
</div>

<input type="checkbox" id="lb-lobby" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-lobby"><img src="/screenshots/lobby.png" alt="Coilbox lobby and battle rooms, enlarged"></label>
<input type="checkbox" id="lb-content" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-content"><img src="/screenshots/content.png" alt="Coilbox content browser, enlarged"></label>
<input type="checkbox" id="lb-branding" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-branding"><img src="/screenshots/game-branding.png" alt="A branded game detail view with a unit build tree, enlarged"></label>
<input type="checkbox" id="lb-mission" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-mission"><img src="/screenshots/mission-briefing.png" alt="A campaign mission briefing screen, enlarged"></label>
<input type="checkbox" id="lb-conquest" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-conquest"><img src="/screenshots/conquest-starfield.png" alt="The galactic conquest strategic starfield map, enlarged"></label>

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
