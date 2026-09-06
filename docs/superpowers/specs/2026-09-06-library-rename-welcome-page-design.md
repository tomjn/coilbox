# Library rename, welcome page descriptions, Settings nav, update in the top row

Date: 2026-09-06

Four changes to the sidebar and the welcome page. They are independent, so they ship as four pull requests in the order below. The only ordering constraint is that the group descriptions table is written once, after the group list has settled.

1. Content becomes Library
2. A Settings nav group
3. Group descriptions on the welcome page
4. An available update competes for a slot in the top row

## Background

Coilbox composes its UI from picoframe. Each `src/<feature>/index.ts` exports a `FramePlugin` contributing `nav`, `routes`, `settings` and `slots`, and `src/app.plugins.ts` is the ordered list. picoframe's `composeNav` merges every plugin's nav groups by id, so one group can be declared by several plugins.

Two facts shape this work.

Settings is not missing. `/settings` and `/settings/:sectionId` are frame-owned routes with a full composed tree behind them. Nothing contributes a nav group for it, so the only way in is a gear link in the sidebar footer, and it never appears on the welcome page.

`NavItem.description` already exists and the welcome page already renders it (`src/home/zones/ToolCards.tsx:261` and `:306`). Group headings have no equivalent.

## 1. Content becomes Library

### What changes

Route paths `content/*` become `library/*` for the eleven live pages in `src/content/index.ts:111-199`:

```
library/maps                        library/blueprints
library/maps/:name                  library/blueprints/:id
library/games                       library/archives
library/games/:name                 library/archives/:name
library/games/:name/units           library/archives/:name/repl
library/games/:name/units/:unit
```

The nav group id `content` becomes `library` and its label becomes Library. Item ids `content.maps`, `content.games`, `content.blueprints` and `content.archives` become `library.*`. The settings group at `src/content/index.ts:312-319` changes id `content` to `library` and title Content to Library.

### Keeping distribution profiles working

Profiles reference ids, never paths. `hide` takes nav item ids checked against `HIDEABLE_NAV_IDS` (`src/profile/hidden.tsx:33-44`), and `hideSettings` takes settings section ids. `docs/distribution-profile.md:47` ships `content.games` as a worked example, so shipped profiles will hold the old ids.

Compat lands in two places.

Old routes get `LegacyRedirect` entries, the pattern already used for the four retired `content/replays` and `content/stats` paths. `makeLegacyRedirect` (`src/content/pages/LegacyRedirect.tsx:11-17`) only substitutes a single `:name`, so it is generalised to fill every `:param` token in the target from `useParams()`. Without that, `library/blueprints/:id` and `library/games/:name/units/:unit` cannot be expressed.

An old-to-new id map is applied where `profile.hide` and `profile.hideSettings` are read, in `src/profile/hidden.tsx`. `"hide": ["content.games"]` keeps hiding the Games card. `src/profile/health.ts` accepts the old ids without warning and names the replacement in a deprecation note, so a profile author learns about the rename rather than losing a check.

The four paths already retired stay at `content/*`. They redirect to `/downloads/maps`, `/play/replays` and `/stats`. Minting `library/` equivalents for paths nobody should use is not worth the routes.

### What does not change

`src/content/` keeps its name. It holds engine config, keybinds, unitsync bindings and achievements, none of which is the Library section, so renaming the folder would put a large diff over unrelated code.

The "Content folders" settings child keeps its id and title. It names where Spring content lives on disk, which is a Spring concept rather than this part of the UI.

The `content_open_path` Tauri command keeps its name.

### Also updated

`docs/routes.md`, or `src/routesDoc.test.ts` fails. The `content.games` example at `docs/distribution-profile.md:47`. The fixture at `src/home/toolCards.test.ts:349`.

### Testing

A test that an old nav id in `profile.hide` still hides the renamed item. A test that each retired path redirects to its `library/` replacement, including the two-parameter units route. The existing `routesDoc.test.ts` and `settingsTree.test.ts` cover drift.

Size: M.

## 2. A Settings nav group

Declared in `src/general/index.ts`, which already owns the General and Advanced settings groups and contributes no nav today. Group id `settings`, label Settings, order 60. The highest existing group order is animation at 50, so Settings sorts last.

Four items, all `to:` links to routes the frame already owns:

```
Engine settings   /settings/engine-settings
Appearance        /settings/frame.appearance
Accounts          /settings/lobby-servers
All settings      /settings
```

Accounts points at lobby server logins. The Coilbox hub sign-in at `/settings/hub` is a separate system and is out of scope here.

No new routes, so `routesDoc.test.ts` is unaffected and `docs/routes.md` needs no new rows.

The group shows in the sidebar as well as on the welcome page. This makes the footer gear partly redundant, and that is the right trade: a Settings group in the sidebar is the discoverable thing and the gear is easy to miss.

The four ids are added to `HIDEABLE_NAV_IDS` so a distribution can drop any of them, Accounts in particular.

Size: S.

## 3. Group descriptions on the welcome page

A `GROUP_DESCRIPTIONS` table in `src/home/`, keyed by nav group id, rendered under the group heading in `src/home/zones/ToolCards.tsx:89-93`. A group with no entry renders no description, which is what happens to the link groups a profile injects.

The table lives in `src/home/` rather than as a field on each plugin's nav because five plugins declare the `play` group. `composeNav` merges them, so a per-plugin description would be five competing answers to one question. It also needs no change to `NavGroup` in picoframe, so nothing has to be published before this ships.

Copy:

```
Play              Start a skirmish, run a campaign, or pick up a Warpath run.
Multiplayer       Log in to a lobby server, chat, and join battles.
Library           Everything installed on this machine: maps, games, blueprints and archives.
Downloads         Find and install maps, games and other content.
Campaign Builder  Build your own campaigns and scenarios.
mapconv           Compile and decompile Spring maps.
unit builder      Assemble units from parts and inspect s3o models.
animation         Convert BOS to Lua, and work with COB scripts.
uberstress        Run engine stress tests and compare the results.
Settings          Engine options, appearance, accounts, and everything else.
```

### Testing

A test that every built-in group id has a description, so a new group cannot ship without one. A test that an unknown id returns nothing rather than throwing.

Size: S.

## 4. An available update competes for a slot in the top row

### Behaviour

An available update becomes a normal resume candidate. It ranks on release date against everything else, so it can take the hero slot, take a rail slot, or be pushed off the row by more recent activity. The row cap stays at 3 (`src/home/zones/ResumeRail.tsx:30`).

This is a deliberate choice over a reserved slot. It keeps the row constrained and keeps the ranking rule simple. The cost is that the row is not a guaranteed place to notice an update, so the topbar badge (`src/updater/UpdateBadge.tsx`) remains the surface that always shows one. Both stay.

### Implementation

`ResumeKind` in `src/home/continue.ts:19-25` gains `"update"`, with matching entries in `RESUME_KIND_COPY` and `RESUME_KIND_ICON`. The icon name is verified against `lucide-react` before use.

A pure `updateCandidate()` follows the existing per-source pattern:

```
kind       "update"
title      Coilbox <new version>
detail     You have <installed version>
to         /settings/updates
touchedAt  Date.parse(update.date)
expiresAt  absent
```

The kind copy is `{ label: "Coilbox update", action: "Update Coilbox" }`. The action names where the card goes, matching the other kinds.

`useUpdater()` throws outside its provider (`src/updater/UpdaterProvider.tsx:71`), which would pull `UpdaterProvider` into the home tests. The updater module gains a non-throwing `useUpdaterIfPresent()` returning `UpdaterContextValue | null`. `useUpdater()` is unchanged.

`collectCandidates()` and `useResume()` gain the new source.

### Why the date parses

The live manifest carries `pub_date` as `2026-09-01T20:31:16.127Z`. `tauri-plugin-updater` 2.11.0 parses it into an `OffsetDateTime` and reformats it as RFC 3339 before handing it to JavaScript (`src/commands.rs:75-82`), so `Date.parse` reads it.

If a future manifest drops `pub_date`, `Update.date` is undefined, `touchedAt` is `NaN`, and `rankCandidates` (`src/home/continue.ts:136-146`) already filters non-finite timestamps. The card does not appear and the badge is unaffected. This is a silent no-op rather than a fallback, which is acceptable because the badge is the guaranteed surface.

### Testing

Pure tests for `updateCandidate`, including the missing-date case. A ranking test placing an update among resume candidates, proving it can win and can be pushed off.

Size: S.
