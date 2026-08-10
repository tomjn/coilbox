# Coilbox hub: browse and item page fixes

Ten pieces of feedback on the hub screens, from using them. Seven changes, one spec. Nothing here changes the hub API, the import flow's checks, or what a distribution profile can switch off.

## Why

The hub shipped as a browse grid plus an item page. Using it turned up problems in three groups: it is hard to find (an untitled nav section, no link to the website, sign-in buried in Settings), the item page is thinner than the website's equivalent (no share link, capped width, no preview), and some controls say the wrong thing (a flashing dropdown, "Import again" on every card, Open styled as the primary action, the nav item going dark on a detail page).

## 1. Nav placement and highlighting

`hub.browse` becomes the first item in the existing Downloads group, above Browse Rapid, with `order: -1`. The hub plugin declares `id: "downloads", label: "Downloads", order: 20` and the frame merges it into the group the downloads plugin owns, the same way `campaign` merges into `play`. The unlabelled group of one goes.

`end: true` comes off the nav item so `/hub/<id>` keeps the entry lit. Nothing else in the item's declaration changes: the `hub.browse` profile-hidden gate and the `isHubEnabled` route gate stay as they are.

Files: `src/hub/index.tsx`.

## 2. Filter combobox opens and stays open

The game and map filter boxes flash a dropdown on click and close it immediately. The `Input` sits inside `PopoverAnchor` rather than `PopoverTrigger`, so `onFocus` opens the popover and the same click's pointer-down then counts as an interaction outside the content, which closes it.

Fix: hold a ref on the anchor and call `preventDefault()` in `PopoverContent`'s `onPointerDownOutside` when the event started inside it. Escape, blur and picking a suggestion still close it, and typing still commits on blur or Enter.

Files: `src/hub/pages/components/FilterCombobox.tsx`.

## 3. Card actions

A card for something already imported shows one button: "Open", outline, full width. "Import again" goes from the card and from the item page. An imported thing that has been edited is a new preset with no tie back to the hub item, so a second copy is not a case worth a button. Somebody who wants one can remove theirs and import again.

A card for something not imported keeps "Import", outline. A card for something imported and since deleted keeps its sentence plus "Import".

Files: `src/hub/pages/BrowsePage.tsx`, `src/hub/pages/ItemPage.tsx`.

## 4. Kind icons

The website draws a glyph per kind. Coilbox draws none, so the two surfaces show the same item differently.

Port the five glyphs from `coilbox-hub/components/KindIcon.tsx` (preset, warpath, conquest, setup pack, scenario) into `src/hub/components/KindIcon.tsx`, and draw them inside the kind badge on the card and the item page. Ported rather than swapped for lucide equivalents, so the mark for a thing is the same wherever it is seen.

Kind filter chips stay text. "Challenges" covers both the conquest and the warpath glyph, so no single one is right.

Files: new `src/hub/components/KindIcon.tsx`, used by `BrowsePage.tsx` and `ItemPage.tsx`.

## 5. Item page

### Layout

The `max-w-3xl` cap goes. Above `lg` the body is two columns: description and preview on the left, the facts list and the actions on the right. Below `lg` it is one column in that order. The description keeps `max-w-prose`, which is a reading measure rather than a page cap.

### Preview

The page fetches the container on load through `fetchImportText` (the capped `dl_fetch_text` command), decodes it with the container reader, and renders a preview for its kind:

- Preset: teams as colour-swatched member lists, then "N playing across M teams".
- Setup pack: game, engine and maps.
- Challenge: the galaxy drawn as an SVG, rebuilt from the payload's seed with coilbox's own `generateGalaxy` (`src/conquest/generate.ts`), plus systems, enemies and layout. Warpath payloads carry no galaxy, so they show the numbers alone.
- Scenario: counts of objectives, triggers, zones, teams, actors and dialogue.

A kind with nothing readable in its payload renders no preview rather than an empty frame.

The fetched container is held, so pressing Import does not fetch a second time. The kind-mismatch and version checks that Import runs today move onto the load fetch, so a discrepancy is shown before the button is pressed rather than after. When they find nothing, Import goes straight to the importer as it does now.

This adds one network request per item page view. It is the same host the page already fetched its metadata from, under the same byte cap and timeout, and through the same `identify()` gate.

### Sharing

Two controls beside the actions: "Copy link" copies `<hub>/i/<id>`, and "View on the hub" opens it in the browser through the frame's `openExternal`. That address is the item's `container_url` and is what `hubItemIdFromUrl` already recognises, so somebody pasting it into coilbox lands on this page.

### Removing

"Remove" sits beside Open, shown only when the item reads as imported. It is a real delete: the local copy is destroyed, not merely forgotten.

Pressing it opens a confirm naming what goes, plus a warning when coilbox can tell the thing is in use:

- Scenario: warn when `scenarioIsAttached` says a campaign mission plays it. The delete passes `keepMedia: true` in that case, matching what the scenario builder's own delete does, so an attached mission's dialogue clips survive.
- Conquest challenge: warn when the galaxy has run state, because a game in progress goes with it.
- Warpath challenge: the run is the progress, so the confirm says so.
- Preset and setup pack: name the presets that go. Nothing else references a preset by id.

Removal deletes every ref the import record holds, in the store that kind lands in: `removePreset`, `deleteRun`, `conquestDelete`, `deleteScenario`. It keys off the record's `refs` rather than the item, because a setup pack leaves several presets behind and the record is the only thing that knows which ones came from it. Refs already gone are skipped. The record is dropped afterwards, so the item reads as never imported.

Not offered on cards: a destructive action on every tile in a grid is too easy to hit.

Files: `src/hub/pages/ItemPage.tsx`, new `src/hub/pages/components/ItemPreview.tsx`, new `src/hub/remove.ts` (the per-kind delete, pure where it can be), `src/hub/importRecord.ts` (dropping a record).

## 6. The hub website

The browse page header gets an "Open the hub website" link, through `openExternal`. Not a sidebar item: an external link under Downloads would read as another download source.

Files: `src/hub/pages/BrowsePage.tsx`.

## 7. Discord sign-in

Signing in is only needed to publish, but it is currently reachable only from Settings, and the publish form's answer to being signed out is to send the reader to Settings.

Two changes, no new screen:

- The browse page header gets a compact account control: "Sign in with Discord" when signed out, "Signed in as X" when signed in.
- `PublishSection` offers the sign-in button inline instead of naming a Settings page.

Sign-out stays in Settings, where an action taken once belongs.

Files: `src/hub/pages/BrowsePage.tsx`, `src/hub/PublishSection.tsx`, and a shared sign-in control extracted from `src/hub/pages/components/AccountControl.tsx`.

## Testing

The repo runs vitest with no DOM testing library, so component behaviour is checked by hand and logic is checked by test.

Tested: the preview readers (what each kind's payload yields, including a payload with nothing readable in it), the removal resolver (which refs go for which kind, refs already gone, the record drop), and the share address.

Checked by hand in `bun tauri dev`: the nav position and highlight on a detail page, the combobox opening and staying open, the two-column layout, each kind's preview against a real shared item, remove-and-confirm for each kind, and sign-in from both the browse header and the publish form.
