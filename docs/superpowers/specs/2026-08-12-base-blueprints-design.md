# Base blueprints

2026-08-12. Design for milestone 22, https://github.com/tomjn/coilbox/milestone/22, covering where blueprints live in coilbox, how they are shared, and what the hub does with them.

Written after issue 1310 landed the model split, and after the surfaces were decided rather than left to each issue to invent.

## The thing being built

A base blueprint is a named layout of buildings with no binding to a map, a team or a mission. You make one, you keep it, you place it wherever you like, and you give it to other people.

Coilbox already had this object under another name and welded to a mission. https://github.com/tomjn/coilbox/pull/1413 split it: a scenario now carries `blueprints`, which is the reusable geometry, and `bases`, which is one blueprint placed at an origin for a team with the mission-only fields on top. This spec is about what happens once a blueprint is a thing in its own right.

## Where it lives

A top level route under Content, alongside maps, games, archives, setup packs and replays:

- `content/blueprints` lists every blueprint you have.
- `content/blueprints/:id` is a detail view for one, and it is a full page rather than a drawer. You can edit from it, and you can make a new blueprint from the list.

`content/setup-packs` at `src/content/index.ts:144` is the precedent to follow. It is a library of shareable things under Content that publishes through the hub instead of carrying its own sharing mechanism, which is exactly the shape of this.

The nav entry goes in the same group as the others, in the list at `src/content/index.ts:74`.

## The editor

The blueprint editor is the scenario editor's placement surface with the mission parts removed, lifted out so both use it. It is not a second editor. The scenario editor keeps the team picker, the origin, the trigger addressable id and the factory queue, because those belong to a base rather than to a blueprint.

The standalone editor draws on a plain grid or an infinite textured plane standing in for ground. It does not load a map and does not need one. Checking a layout against real terrain is a separate, optional step, and it is https://github.com/tomjn/coilbox/issues/1315.

That decision is what makes the library usable. A blueprint is not made for one map, so requiring a map to look at one would be backwards, and map loading is the slowest thing in coilbox.

## The model

A blueprint carries its buildings in an array, and the array's order is the build order. A flag says whether that order is meaningful, so a layout drawn without caring about sequence is not pretending to be a build order.

This is the same shape BAR's own format uses, which carries `ordered` alongside units in array order, so importing and exporting round-trips the sequence rather than needing anything parallel.

There is no separate build order object. A build order is a blueprint whose order is meaningful, and exporting one as a pure build order strips the positions and leaves the sequence of unit names. Playback walks the same array.

A blueprint names units by their internal name, so it binds to a game the same way a scenario does. The library filters by game. This is not a BAR feature and nothing in it should assume BAR. BAR's `LuaUI/Config/blueprints.json` is one import and export adapter, and the first one, because it is the only format anybody has today.

## Sharing

Blueprints publish to and import from the Coilbox hub, which is the same route every other shareable thing already takes. There is no separate gallery, no followed catalogue and no new server.

This means a seventh container kind, `blueprint`, added to `ContainerKind` and `CONTAINER_KINDS` at `src/container/container.ts:52`, with its own entry in `SUPPORTED_KIND_VERSIONS`. On the hub it means adding `blueprint` to `GALLERY_KINDS` at `lib/container/index.ts:52` in `tomjn/coilbox-hub`, and to `HUB_KINDS` at `src/hub/api.ts:37` on this side.

### The cross repo ordering, which is not optional

`scripts/sync-vendor.ts` in the hub pins each vendored coilbox file by its git blob SHA on `tomjn/coilbox` main, and `check:vendor` is what hub CI runs. A vendored file edited in the hub is a CI failure by design.

So the container change lands on coilbox main first. Only then can the hub run `bun run sync:vendor` and build on it. The two repos cannot move together on this, and the hub work is blocked until the coilbox side is merged.

### What the hub shows

The hub has no unit models and no unit pictures, and is not getting them for this. A blueprint preview is 2D: one rounded square per building on a grid, with a regular gap between squares, sized by the building's footprint.

It goes in the existing per kind preview slot, next to `presetPreview.ts`, `setupPackPreview.ts` and `conquestGalaxy.ts`, rendered through `ItemPreview.tsx`.

The footprint is the reason the squares can be right rather than uniform, and it has to travel in the container for the hub to draw it, because the hub cannot run unitsync.

## Footprints

Nothing in coilbox handles footprints today. The scenario editor lets two buildings overlap and says nothing.

`footprintx` and `footprintz` come from the unit definition. `crates/coilbox-unitsync-worker/src/dataset.rs` already reads unitdefs through the Lua parser and emits one tab separated line per unit, so this is a two field extension of an existing shim rather than the full unit dataset work in https://github.com/tomjn/coilbox/issues/1269.

The editor draws the real footprint, snaps placement to the build grid, and marks an overlap instead of allowing it. Dimensions swap on odd facings, and a footprint spanning an odd number of squares centres differently from an even one. BAR's `api_blueprint.lua` has the arithmetic.

## The in game widget

Out of scope for milestone 22. It gets its own milestone, sequenced after milestone 20, which builds the widget install and catalogue infrastructure it would otherwise have to hand roll.

The shape, recorded here so the milestone has a starting point: coilbox ships its own widget, written from scratch, because BAR's `cmd_blueprint.lua` cannot be reused for licensing reasons. It lets a player browse, insert and create blueprints in game. Coilbox does not install it automatically. The user gets it deliberately.

## What this changes about the existing issues

- https://github.com/tomjn/coilbox/issues/1313 said the community gallery would be reached through a followed catalogue in the shape of the preset pack sources. The hub exists now and carries four kinds already, so that issue narrows to importing a `blueprints.json` holding many layouts, previewing each, taking the ones you want and keeping provenance. The sharing half is the hub.
- https://github.com/tomjn/coilbox/issues/1312 keeps its scope but stops being the centre of gravity. BAR's format is one adapter, not the format.
- https://github.com/tomjn/coilbox/issues/1315 stays optional and stays separate. The editor works with no map.

## New work this creates

Five issues that none of the seven cover:

1. The `content/blueprints` library, the detail view, editing and creating.
2. The blueprint container kind and hub publish and import on the coilbox side.
3. The lifted out editor surface, drawing on a grid rather than a map.
4. The build order flag, recording and playback, and the positions stripped export.
5. The hub side: `blueprint` in `GALLERY_KINDS`, and the 2D squares preview. In `tomjn/coilbox-hub`.
