# Browse a game's units in the app

A player who wants to know what a unit costs, what it builds, or what it turns into has two ways to find out in coilbox today, and neither is reading. The build tree draws a node graph, which answers what leads to what and nothing else. The unit picker offers a list to tick, which answers which units exist. Neither is a page you read about one unit.

The hub has that page. `coilbox-hub` shows a filtered grid of a game's units and a page per unit with its stats, what builds it and what it builds. This design brings the same idea into the app, for every installed game, reading the archive rather than the hub.

## What it is for

The reader is someone with a game installed who wants to look a unit up. They are comparing two units, planning a build, or working out why a commander they upgraded is not the unit they remember. They are not necessarily online, and the hub cannot help them with a game nobody has submitted.

Success is that a unit has a page, that page is reachable by a link, and everything on it comes from the archive on disk.

## Decisions

Four decisions were settled before this was written, and each rules out work rather than merely choosing a flavour.

**Archive first, not a port.** The page shows what coilbox can read: the model, the buildpic from the archive, morph stages, footprint and terrain limits. It drops what only makes sense on a hub holding many versions of many games: retired units, release history and author written snippets. Copying those would mean shipping sections that are always empty.

**Its own routes.** Not a section of the game page and not a drawer. A unit gets a URL, the game page stays the size it is, and the shape matches the hub's `/games/[shortname]/units/[unit]`.

**Model first.** The 3D viewport leads the unit page, because rendering a unit from a live archive is the thing the desktop app can do and the hub never will.

**Faction sections with morphs folded.** The grid groups by faction the way the picker does, and a unit's morph stages fold into one cell, the way the tree and the picker now do.

## Approach

This is user interface over data coilbox already fetches. No new Rust, no new worker mode, no new plugin command, no new dependency.

`useUnitsyncUnitDataset` (`src/content/config.ts:674`) returns every unit in a game with its stats, weapons, `buildOptions`, `morphTargets`, footprints, water limits and `objectName`. It is cached twice over: a module level map keyed on engine, data directory and archive, and the worker's own disk cache keyed on archive file identity. `GameDetailPage.tsx:89` already calls it, so opening the encyclopedia after the build tree costs nothing.

`UnitModelPanel` already takes an engine path, a data directory, a game archive, a unit id and that unit's dataset entry, which is exactly what a unit page has in hand.

Two alternatives were considered and rejected. An encyclopedia specific worker mode returning a richer per unit payload buys nothing, because the dataset already carries every field the page shows. Vendoring the hub's page runs the vendoring backwards: `scripts/sync-vendor.ts` pulls from coilbox into the hub, and coilbox is upstream.

## Routes

Two routes, registered beside the existing game routes in `src/content/index.ts`:

- `content/games/:name/units`, crumb "Units"
- `content/games/:name/units/:unit`, crumb resolving the unit's display name from the session cached dataset and falling back to the def key

Both wrapped in `gateProfileHidden("content.games", ...)`, matching `content/games` and `content/games/:name`, so a distribution profile that hides games hides the encyclopedia with them rather than leaving a reachable orphan.

The crumb fallback matters because the dataset may not be read yet when the crumb renders. A def key is a worse label than a name and a better one than nothing, and it is the same trade the blueprint route already makes for a uuid.

Entry is a link on `GameDetailPage`, beside the build tree, because that is where someone already goes to ask about a game's units.

## The grid

Sections come from `buildTechForest` and `factionGroups` in `src/content/techForest.ts`. Both already exist, both already cross morph edges when assigning a unit to a faction, and `factionGroups` already puts units no faction reaches into a block of their own rather than hiding them.

Cells fold morph stages through `morphGroups` and `groupOf` from `src/content/morphGraph.ts`. One cell per group, labelled with the base's name and how many upgrades it folds, counting upgrades the way the tree and the picker count them, which is excluding the base.

Search matches three things: a def key, a display name, and a folded stage's own def key. The third is not obvious and is the one people notice, because a def key pasted out of a mission file, a replay or a game's own config is most of why anyone types in that box.

Long rosters use a render budget per section, in the shape `UnitPicker.tsx:577` already uses, with `loading="lazy"` on cell images. No virtualisation library: none is in the tree, and adding one to draw a grid would be a dependency bought for a problem the existing pattern already solves. The ceiling worth designing for is 2000 units, which is the cap the hub refuses a submission above.

## The unit page

Model first is a layout decision, not a loading state. Everything except the model renders from the already cached dataset on first paint, and the viewport fills its box when `useUnitsyncUnitModel` returns. A page that leads with a model and waits for it would answer more slowly than the build tree it replaced.

In order:

1. The model viewport, reusing `UnitModelPanel`'s existing hook rather than a second model path.
2. Name, def key, faction, and the buildpic from the archive.
3. Stats and a weapons table: health, metal and energy cost, build time, sight, speed, range, then one row per weapon with damage, reload, range and projectile type.
4. What it builds and what builds it, as links to those units' pages.
5. Its morph stages, as links, each carrying whatever conditions the game declared beside the edge.
6. Footprint, maximum slope, water limits and whether it floats.

A field the unitdef does not declare gets no row. Never a zero. `shared/unitdef-stats.json` writes that rule down and the dataset already honours it, so the page has only to not undo it.

The morph conditions are free JSON, keyed however the game keyed them, so the page renders whatever keys arrive rather than naming a fixed set. Four games spell them four ways and a page naming today's set would be wrong by the fifth.

## Shared components

One overlap is real. `BuildTreeDrawer` already renders `UnitModelPanel` for a focused node (`BuildTreeDrawer.tsx:33` and `:643`), so the build tree and the unit page will both show a unit's model. The page reuses that component rather than growing a second model path, which is why the model section costs almost nothing to build.

Whatever stats block the page grows should be a component the drawer can adopt too, so the two frames answer the same question the same way. Moving the drawer onto it is not required by this work and is not part of it.

An earlier draft of this design claimed `FactionBuildList` duplicates the grid's faction grouping. It does not. It reads `reachableCounts` to show a per side unit count and a build button per side, and never groups units into lists. There is nothing to extract there, and an implementer should not go looking.

## Out of scope

Retired units, release history and author snippets, because they are facts about a hub holding many versions and coilbox holds one archive.

Unit comparison, which the hub has and this does not need in a first version.

Any change to what coilbox sends the hub. This reads the dataset and draws it.

## Testing

The grid model and the search rule are pure functions over the dataset, unit tested in the shape `morphGraph.test.ts` and `techForest.test.ts` use, including a morph group folding into one cell and a stage's def key finding its base.

Both pages get `.dom.test.tsx` coverage in the shape `UnitPicker.dom.test.tsx` established, driving a real search box rather than asserting against static markup.

No agent drives the application. The visual result gets one `bun tauri dev` run at the end, against a game with morphs, which means SplinterFaction or Metal Factions.

## Risks

The model viewport is the slowest thing on the page and the first thing a reader sees. If it proves slow enough to be annoying, the fix is in how the box behaves while empty rather than in the ordering, which is a decision already made.

A game with no faction start units puts every unit in the ungrouped block, so the grid degrades to one long section. That is the honest answer for a game whose sides could not be read, and it matches what the picker already does.
