---
layout: home

hero:
  name: Coilbox
  text: Desktop tooling for Recoil RTS & Spring RTS games
  tagline: Browse and download games, maps and engines, host and join battles, run campaigns and galactic conquest — in one Tauri desktop app.
  image:
    light: /coil-mark-light.svg
    dark: /coil-mark-dark.svg
    alt: Coilbox
  actions:
    - theme: brand
      text: Download
      link: https://github.com/tomjn/coilbox/releases/latest
    - theme: alt
      text: Guides
      link: /portable-mode
    - theme: alt
      text: Community hub
      link: https://coilbox-hub.vercel.app
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
  - title: Share what you make
    details: Publish battle presets, warpath and conquest challenges, setup packs and scenarios to the community hub, and import anyone else's in one click.
    link: https://coilbox-hub.vercel.app
    linkText: Browse the hub
---

## Screenshots

Click any shot to enlarge.

<div class="screenshot-gallery">
  <figure>
    <label for="lb-home"><img src="/screenshots/thumbs/home.webp" loading="lazy" decoding="async" alt="The Coilbox home screen, with a resume rail and illustrated tool cards"></label>
    <figcaption>Home and tool cards</figcaption>
  </figure>
  <figure>
    <label for="lb-singleplayer"><img src="/screenshots/thumbs/singleplayer.webp" loading="lazy" decoding="async" alt="The Coilbox singleplayer setup screen, with AI opponents, mod options and a map preview"></label>
    <figcaption>Singleplayer setup</figcaption>
  </figure>
  <figure>
    <label for="lb-battle"><img src="/screenshots/thumbs/battle-room.webp" loading="lazy" decoding="async" alt="A multiplayer battle room on a SPADS host, with battle chat and a map preview"></label>
    <figcaption>Multiplayer battle room</figcaption>
  </figure>
  <figure>
    <label for="lb-branding"><img src="/screenshots/thumbs/game-branding.webp" loading="lazy" decoding="async" alt="A branded game detail view with a unit build tree"></label>
    <figcaption>Branded game detail &amp; build tree</figcaption>
  </figure>
  <figure>
    <label for="lb-mission"><img src="/screenshots/thumbs/mission-briefing.webp" loading="lazy" decoding="async" alt="A campaign mission briefing screen"></label>
    <figcaption>Campaign mission briefing</figcaption>
  </figure>
  <figure>
    <label for="lb-conquest"><img src="/screenshots/thumbs/conquest-starfield.webp" loading="lazy" decoding="async" alt="The galactic conquest strategic starfield map"></label>
    <figcaption>Galactic conquest map</figcaption>
  </figure>
  <figure>
    <label for="lb-warpath"><img src="/screenshots/thumbs/warpath.webp" loading="lazy" decoding="async" alt="A warpath run map, showing battle, event, salvage and depot nodes branching from a command node"></label>
    <figcaption>Warpath run map</figcaption>
  </figure>
  <figure>
    <label for="lb-lego"><img src="/screenshots/thumbs/lego-builder.webp" loading="lazy" decoding="async" alt="The unit builder, with a part assembled in a 3D viewport beside its piece tree"></label>
    <figcaption>Unit builder</figcaption>
  </figure>
</div>

<input type="checkbox" id="lb-home" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-home"><img src="/screenshots/home.png" loading="lazy" decoding="async" alt="The Coilbox home screen, enlarged"></label>
<input type="checkbox" id="lb-singleplayer" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-singleplayer"><img src="/screenshots/singleplayer.png" loading="lazy" decoding="async" alt="The Coilbox singleplayer setup screen, enlarged"></label>
<input type="checkbox" id="lb-battle" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-battle"><img src="/screenshots/battle-room.png" loading="lazy" decoding="async" alt="A multiplayer battle room, enlarged"></label>
<input type="checkbox" id="lb-branding" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-branding"><img src="/screenshots/game-branding.png" loading="lazy" decoding="async" alt="A branded game detail view with a unit build tree, enlarged"></label>
<input type="checkbox" id="lb-mission" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-mission"><img src="/screenshots/mission-briefing.png" loading="lazy" decoding="async" alt="A campaign mission briefing screen, enlarged"></label>
<input type="checkbox" id="lb-conquest" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-conquest"><img src="/screenshots/conquest-starfield.png" loading="lazy" decoding="async" alt="The galactic conquest strategic starfield map, enlarged"></label>
<input type="checkbox" id="lb-warpath" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-warpath"><img src="/screenshots/warpath.png" loading="lazy" decoding="async" alt="A warpath run map, enlarged"></label>
<input type="checkbox" id="lb-lego" class="lb-toggle" aria-hidden="true">
<label class="lb-overlay" for="lb-lego"><img src="/screenshots/lego-builder.png" loading="lazy" decoding="async" alt="The unit builder, enlarged"></label>

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
- [Campaigns](/campaigns), [Galactic conquest](/conquest) and [Roguelite run](/roguelite-run) — the singleplayer game modes.
- [Scenarios](/scenarios) and [the mission runtime](/mission-runtime): authoring in-engine missions, and what a game does to play them.
- [Routes](/routes) — the app's screen map.
