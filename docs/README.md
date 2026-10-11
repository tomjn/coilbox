# Coilbox documentation

These pages are published at [tomjn.github.io/coilbox](https://tomjn.github.io/coilbox/). They are grouped by who reads them, one folder each.

| Folder | Reader | Start at |
| --- | --- | --- |
| [`players/`](players/index.md) | People who play games through coilbox | [Player guides](players/index.md) |
| [`developers/`](developers/index.md) | People who make a game, a campaign, a map or a unit | [Game developer guides](developers/index.md) |
| [`staff/`](staff/server-admin.md) | Moderators and admins of a lobby server | [Server admin](staff/server-admin.md) |
| [`reference/`](reference/index.md) | Anyone looking something up | [Reference](reference/index.md) |

## Adding a page

1. Put the page in the folder for its reader. A page that serves two readers is two pages.
2. Add it to that folder's sidebar in `.vitepress/config.mts`.
3. Add a line for it to that folder's `index.md`.

A guide tells one reader how to do one thing. Lists of fields, ids, bytes and messages go in `reference/`, and the guide links to them.

## What is not published

`superpowers/`, `mockups/`, `examples/`, `reports/` and any `ideas-*.md` file are left out of the site. `examples/` holds the sample files the guides link to on GitHub.

## How the pieces of a distribution fit

```
portable mode  - the .coilbox folder that makes everything below possible
   |-- profile.json   - branding and narrowing      (developers/distribution-profile.md)
   |-- campaigns/     - bundled missions            (developers/campaigns.md)
   |-- galaxies/      - bundled conquest maps       (developers/conquest-for-your-game.md)
   `-- game content   - the engine, game and maps   (developers/distributing.md)
```
