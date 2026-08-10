# Setup packs: an arbitrary collection of content

A setup pack stops being a snapshot of one player's setup and becomes a collection of things to install, such as "popular water maps". It can name several games, or none. Its own page goes, and authoring moves to the Coilbox hub screen.

## Why

Content > Setup packs is a page with a heading and two buttons on it. Nothing lists, because a pack is a code and no pack is ever stored, so the screen has no data of its own and looks broken.

Widening what a pack holds is the reason to keep the feature at all. One game and a map list describes a setup you can launch, which presets already do. A bag of maps and games describes something nobody can share today: a curated set of content worth installing.

The curated map lists in the branding catalog (`SuggestedMapList`) are not touched. They stay publisher-curated and keep their banner on the maps download screen. Backwards compatibility of pack codes is not a goal: the feature has seen very little use.

## 1. What a pack holds

`SetupPackManifest` becomes:

```ts
interface SetupPackManifest {
  title?: string,
  engineVersion?: string,
  games?: SetupPackGame[],
  maps?: string[],
  presets?: SetupPackPreset[],
}
```

A manifest is valid when `games` or `maps` has at least one entry. Today `game` is a single required object and `maps` must be non-empty, so both of those rules go.

`title` is new. A code pasted from a chat window has no hub item behind it, so without a title the import drawer can only say "a setup pack". With one it says "Popular water maps".

Two things survive for the packs already published to the hub, which would otherwise fail to decode on the day this ships. A payload carrying the old single `game` object and no `games` reads as a one-game pack. `engineVersion` is still parsed and still resolved on import. Neither is authored any more, and both cost a few lines to keep.

`SetupPackGame` is unchanged: a name, an optional shortname, an optional rapid tag.

`requirementsForPack` maps over `games` instead of the single `game`, and tolerates either list being absent. `dedupeRequirements` already handles repeats.

Files: `src/packs/manifest.ts`, `src/packs/manifest.test.ts`.

## 2. Building a pack

A "Share a pack" button in the Coilbox hub screen header opens a drawer with a title field and three multi-select pickers, over installed content:

- maps, from the unitsync scan
- games, from the same scan, minus coilbox's own generated games
- presets, from `play.presets`, optional

The drawer then shows the code, a copy button, and the existing `PublishSection` for publishing to the hub.

Authoring sits behind the hub gate. A distribution profile with `hub: false` has no way to build a pack, which follows from putting the button there: a distributor who hides community content does not want players publishing it either.

`ExportPackForm` is rewritten around the pickers. It currently reads the preferred play target and pins whatever is selected, which is the behaviour being removed.

Files: `src/hub/pages/BrowsePage.tsx`, `src/packs/pages/components/ExportPackForm.tsx`.

## 3. Importing a pack

The import flow keeps its shape and changes address. `ImportPackForm` lists every game and map in the pack with its install status, installs what is missing through the existing resolve gate and download queue, then saves any bundled presets.

Both ways in land on `/downloads/maps?import=<code>`: the `coilbox://` deep link (`src/deeplink/actions.ts:125`) and the paste box at Settings > Import, which computes a plan and navigates.

The landing route cannot be the hub screen. `/hub` is wrapped in `gated()`, which redirects home when the hub is off or hidden, so a pasted code would bounce to Home and do nothing. `downloads.maps` is not in `HIDEABLE_NAV_IDS`, so a profile cannot take it away. It is also where you would want to be after installing a pack's maps.

Files: `src/deeplink/actions.ts`, `src/deeplink/actions.test.ts`, `src/deeplink/readImport.test.ts`, `src/downloads/pages/MapsPage.tsx`, `src/packs/pages/components/ImportPackForm.tsx`.

## 4. Removing the page

`SetupPacksPage.tsx` goes, along with its nav item and route in `src/content/index.ts`.

`content/setup-packs` redirects to `/downloads/maps` with its query string intact, following `src/content/pages/LegacyRedirect.tsx`. Pack codes are already out in forum posts and hub links, and the query string is what carries the code.

`content.setupPacks` stays in `HIDEABLE_NAV_IDS` and now hides the Share a pack button instead of the nav item. A distribution that switched pack sharing off keeps it off. The id no longer names a nav item, so `hidden.tsx`'s "keep in sync" comment needs a line saying so.

Files: `src/content/index.ts`, `src/hub/pages/BrowsePage.tsx`, `src/profile/hidden.tsx`, `docs/routes.md`, `docs/distribution-profile.md`.

## 5. Do I have this pack

`presenceOf` answers "do I have this" from the local ids an import created, and for a pack those ids are the presets it bundled. A pack that bundles none records nothing and always reads as imported-before-and-gone. That was a corner case when every pack carried a setup. It is the common case once a pack is a bag of maps.

So a pack's presence also counts its content: the pack reads as here when every map and game it names is installed, and gone when some are missing. Presets keep working as they do now, and a pack with both is here when either its presets or its content survive.

This means a pack's record has to carry what it asked for, not just what it created. `HubImportRecord.refs` holds local ids, and the map and game names a pack named are not ids in any store. Add an optional `content` field to the record, holding the game names and map names, written on import and read by the presence check against the installed scan.

Files: `src/hub/importRecord.ts`, `src/hub/importRecord.test.ts`, `src/hub/imports.ts`.

## Naming

The feature stays "Setup packs" everywhere, including the `setup-pack` kind on the wire and the badge on published hub items. Renaming would mean a hub migration or a period of accepting two kinds, for a word.

## Testing

Unit tests cover the manifest rules: a pack with several games, a pack with only maps, a pack with only games, a pack with neither rejected, and an old single-`game` code read as a one-game pack with its engine still pinned.

Deep-link tests assert the new route, and the redirect is covered the way `LegacyRedirect`'s existing cases are.

Presence tests cover a content-only pack whose maps are all installed, one with a map missing, and a pack with presets and content where the presets have been deleted.

The drawer's pickers and the install path are exercised by hand in `bun tauri dev`, since both depend on a live unitsync scan.
