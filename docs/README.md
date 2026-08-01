# Coilbox documentation

Guides for running Coilbox in **portable mode** and shipping it alongside a game. If you're setting Coilbox up for your game (or just trying it next to another lobby), start here.

## Start here

- **[Portable mode](portable-mode.md)** — the foundation. How to run Coilbox self-contained in a `.coilbox` folder, where files live, how to run it alongside skylobby, and how to bundle the game and package everything up for players. **Read this first.**
- **[Distributing to players](distributing.md)** — the short, practical follow-up: the per-OS package layout (one zip each for Windows, Linux, macOS), why to ship a folder rather than loose files, and the macOS `.zip`-not-`.dmg` gotcha.

## Branding and shipping

- **[Distribution profiles](distribution-profile.md)** — the `profile.json` file that rebrands and narrows Coilbox for your game without rebuilding it: title, theme, hidden features, a welcome screen, sidebar links, a splash, and a game-update source. Full field reference with examples.
- **[Routes and nav ids](routes.md)** — every in-app link (`#/…`) and every id you can hide, so the profile's `hide` / `hideSettings` / `welcome` / `links` examples point at real things.

## Content

- **[Campaigns](campaigns.md)** — authoring a linear sequence of skirmish missions in the Campaign Builder, mission media and unit restrictions, export/import, and bundling campaigns into a distribution.
- **[Galactic Conquest](conquest.md)** — the single-player conquest map: generating a galaxy (size, layout, starting territory, fog of war, theatre skin), how a run plays, supplying your game's system/faction names via the profile or branding catalog, and bundling a galaxy.
- **[Scenarios](scenarios.md)**: authoring in-engine missions in the Scenario Builder, what triggers can do, testing one, and how a scenario relates to a mission and a campaign.
- **[The mission runtime](mission-runtime.md)**: the adoption contract a game follows to play scenarios itself, what coilbox installs, how versions are negotiated, and how the runtime is tested.
- **[Roguelite Run](roguelite-run.md)** — the single-player roguelite mode built on the conquest engine: crossing a forward-only node map once, unit-unlocks as a shared tech ceiling, per-team perks, hull/salvage, and between-run meta-progression.

---

A quick mental model of how the pieces fit:

```
portable mode  ─ the .coilbox folder that makes everything below possible
   ├── profile.json   ─ branding/narrowing         (distribution-profile.md)
   ├── campaigns/      ─ bundled missions, scenarios and all (campaigns.md)
   ├── galaxies/       ─ bundled conquest maps        (conquest.md)
   └── game content    ─ engine + .sdz as a Portable root (portable-mode.md)
```
