# Coilbox documentation

Guides for running Coilbox in **portable mode** and shipping it alongside a game.
If you're setting Coilbox up for your game (or just trying it next to another
lobby), start here.

## Start here

- **[Portable mode](portable-mode.md)** — the foundation. How to run Coilbox
  self-contained in a `.coilbox` folder, where files live, how to run it
  alongside skylobby, and how to bundle the game and package everything up for
  players. **Read this first.**

## Branding and shipping

- **[Distribution profiles](distribution-profile.md)** — the `profile.json` file
  that rebrands and narrows Coilbox for your game without rebuilding it: title,
  theme, hidden features, a welcome screen, sidebar links, a splash, and a
  game-update source. Full field reference with examples.
- **[Routes and nav ids](routes.md)** — every in-app link (`#/…`) and every id
  you can hide, so the profile's `hide` / `hideSettings` / `welcome` / `links`
  examples point at real things.

## Content

- **[Campaigns](campaigns.md)** — authoring a linear sequence of skirmish
  missions in the Campaign Builder, mission media and unit restrictions,
  export/import, and bundling campaigns into a distribution.

---

A quick mental model of how the pieces fit:

```
portable mode  ─ the .coilbox folder that makes everything below possible
   ├── profile.json   ─ branding/narrowing         (distribution-profile.md)
   ├── campaigns/      ─ bundled missions            (campaigns.md)
   └── game content    ─ engine + .sdz as a Portable root (portable-mode.md)
```
