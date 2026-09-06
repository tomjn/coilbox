# Routes and nav ids

A reference for the internal locations you can link to and the ids you can hide, so the [distribution profile](distribution-profile.md) `hide`, `hideSettings`, `welcome`, `links` and `home` fields have something concrete to point at.

The **nav id** column is also the key a profile's [`home.zones` art map](distribution-profile.md#home-object) uses to give one tool its own card picture.

Coilbox uses **hash routing**: every screen is a URL fragment beginning with `#/`. That's what makes in-app links work from a profile's welcome HTML. `<a href="#/play/skirmish">` navigates without a page reload.

## Top-level pages

These appear in the sidebar for every user (unless hidden). The **nav id** column is what you pass to the profile [`hide`](distribution-profile.md#hide-string) list (only the ids marked hideable can currently be hidden).

| Sidebar group | Item          | Link (`href`)        | Nav id             | Hideable |
| ------------- | ------------- | --------------------- | ------------------ | -------- |
| Play          | Singleplayer  | `#/play/skirmish`    | `play.skirmish`    | no       |
| Play          | Campaigns     | `#/campaign`         | `campaign.list`    | no¹      |
| Play          | Scenarios     | `#/scenarios`        | `scenario.list`    | no¹      |
| Play          | Conquest      | `#/conquest`         | `conquest.list`    | **yes**  |
| Play          | Warpath       | `#/warpath`          | `runlite.list`     | **yes**  |
| Play          | Replays       | `#/play/replays`     | `play.replays`     | no       |
| Play          | Save Games    | `#/play/savegames`   | `play.savegames`   | no       |
| Multiplayer   | Login         | `#/lobby`            | `multiplayer.lobby`| no²      |
| Multiplayer   | Chat          | `#/chat`             | `multiplayer.chat` | no²      |
| Multiplayer   | Battles       | `#/battles`          | `multiplayer.battles` | **yes** |
| Multiplayer   | Matchmaking   | `#/matchmaking`      | `multiplayer.matchmaking` | no²|
| Multiplayer   | Battle Room   | `#/battle`           | `multiplayer.battle`  | no²   |
| Multiplayer   | Player stats  | `#/stats`            | `multiplayer.stats`   | **yes** |
| Library       | Maps          | `#/library/maps`     | `library.maps`     | no       |
| Library       | Games         | `#/library/games`    | `library.games`    | **yes**  |
| Library       | Blueprints    | `#/library/blueprints` | `library.blueprints` | no    |
| Downloads     | Coilbox hub   | `#/hub`              | `hub.browse`       | **yes**  |
| Downloads     | Browse Rapid  | `#/downloads`        | `downloads.browse` | **yes**  |
| Downloads     | Maps          | `#/downloads/maps`   | `downloads.maps`   | no       |
| Downloads     | Games         | `#/downloads/games`  | `downloads.games`  | **yes**  |
| Settings      | Engine settings | `#/settings/engine-settings` | `settings.engine` | no³ |
| Settings      | Appearance    | `#/settings/frame.appearance` | `settings.appearance` | no³ |
| Settings      | Accounts      | `#/settings/lobby-servers` | `settings.accounts` | no³ |
| Settings      | All settings  | `#/settings`         | `settings.all`     | no       |

¹ **Campaigns** only appears in the sidebar once at least one campaign exists (bundled or created locally), and **Scenarios** once at least one scenario names a game and a map. Until then the item is hidden automatically.

³ **Settings** items are not on the `hide` list. They link to settings sections rather than to routes of their own, so `hideSettings` already governs them: hide `engine-settings`, `frame.appearance` or `lobby-servers` and both the settings section and its card here disappear together.

² **Multiplayer** items appear contextually, not via the profile. **Login** shows only while logged out. **Chat** appears after the first connect, then stays for the session. **Matchmaking** shows only while connected to a Tachyon server, because TASServer has no matchmaking. **Battle Room** shows only while you're in a battle. **Battles** is not contextual, it stays visible even logged out, because a direct room can be hosted from that page with no server and no login (issue #1580). It is profile-hideable instead.

> Want a nav item hideable that isn't yet? It's a one-line change per item in the plugin. Ask and the list can grow. Today `campaign.builder`, `conquest.list`, `library.games`, `downloads.browse`, `downloads.games`, `hub.browse`, `multiplayer.battles`, `multiplayer.stats` and `runlite.list` are wired for hiding (the authoritative set is `HIDEABLE_NAV_IDS` in `src/profile/hidden.tsx`). `content.setupPacks` is also on the same `hide` list. It no longer names a nav item. It hides the Coilbox hub screen's "Share a pack" button instead.

> **Old paths**: `#/content/replays(/:name)` and `#/content/stats(/:name)` redirect to `#/play/replays(/:name)` and `#/stats(/:name)` respectively, so existing bookmarks and links keep working (#467). `#/content/setup-packs` redirects to `#/downloads/maps`, since the Setup packs page is gone and sharing a pack now happens from the Coilbox hub screen instead.
>
> Content became Library, so every browser path moved from `#/content/` to `#/library/`. The old ones redirect: `#/content/maps`, `#/content/maps/:name`, `#/content/games`, `#/content/games/:name`, `#/content/games/:name/units`, `#/content/games/:name/units/:unit`, `#/content/blueprints`, `#/content/blueprints/:id`, `#/content/archives`, `#/content/archives/:name` and `#/content/archives/:name/repl`.
>
> The nav ids moved with them. A distribution profile written against `content.maps`, `content.games`, `content.blueprints`, `content.archives` or the `content` settings section keeps working, in `hide`, `hideSettings` and the home page `art` map alike. The old names are mapped in `src/profile/renamedIds.ts`. `content.setupPacks` did not move, because it never named a nav item.

## Advanced-mode pages

These are hidden unless **Advanced mode** is on (Settings > General). They're modding/authoring tools, not player-facing, so a game distribution usually leaves Advanced mode off and never sees them.

| Sidebar group    | Item        | Link (`href`)          | Nav id                 |
| ---------------- | ----------- | ----------------------- | ----------------------- |
| Library          | Archives    | `#/library/archives`   | `library.archives`     |
| uberstress       | Run         | `#/uberstress`         | `uberstress.run`       |
| uberstress       | History     | `#/uberstress/history` | `uberstress.history`   |
| Campaign Builder | Campaigns   | `#/campaign-builder`   | `campaign.builder`     |
| Campaign Builder | Scenarios   | `#/scenario-builder`   | `scenario.builder`     |
| Mapping Tools    | Projects    | `#/mapconv/projects`   | `mapconv.projects`     |
| Mapping Tools    | Compile     | `#/mapconv`            | `mapconv.compile`      |
| Mapping Tools    | Decompile   | `#/mapconv/decompile`  | `mapconv.decompile`    |
| animation        | BOS → Lua   | `#/animation`          | `animation.bos2lua`    |
| animation        | COB tools   | `#/animation/cob`      | `animation.cob`        |
| unit builder     | Units       | `#/lego`               | `lego.units`           |
| unit builder     | Lego Parts  | `#/lego/parts`         | `lego.parts`           |

(Mapping Tools and animation also add a few external-link items, wiki/tool guides, that open in the browser rather than routing in-app.)

The Mapping Tools group keeps the nav group id `mapconv`, the `#/mapconv/*` paths and the `mapconv` settings section. Only the sidebar label changed, because mapconv is the name of the tool itself.

**Campaign Builder** is one sidebar group (nav group id `builder`), shared by the campaign and scenario plugins. It is not two separate "Campaign Builder" and "Scenario Builder" groups. `src/scenario/index.ts` registers its item into the same `builder` group under the label "Campaign Builder", so the two items merge into one group in the sidebar.

## Detail pages

Reachable by clicking through the lists above. Not sidebar items, but you can deep-link to them if you know the id/name. `:name`, `:id` and `:unit` are placeholders.

| Link (`href`)                             | What it is                                    |
| ------------------------------------------ | ---------------------------------------------- |
| `#/library/maps/:name`                    | A single map's detail page                     |
| `#/library/games/:name`                   | A single game's detail page                    |
| `#/library/games/:name/units`             | A single game's unit list                      |
| `#/library/games/:name/units/:unit`       | A single unit's detail page                    |
| `#/library/blueprints/:id`                | A single layout's detail page                  |
| `#/play/replays/:name`                    | A single replay's detail page                  |
| `#/stats/:name`                           | A player's dossier (head-to-head stats)        |
| `#/chatlogs`                              | Saved chat history (DMs and channels), read from disk with no live connection |
| `#/hub/:id`                               | A single shared Coilbox hub item's page        |
| `#/library/archives/:name`                | A single archive (advanced)                    |
| `#/library/archives/:name/repl`           | An archive's Lua console (advanced)            |
| `#/campaign/:id`                          | A campaign's mission list                      |
| `#/campaign/:id/:missionId`               | A mission briefing/result                      |
| `#/campaign-builder/:id`                  | Editing a campaign (advanced)                  |
| `#/scenario-builder/:id`                  | Editing a scenario (advanced)                  |
| `#/conquest/:id`                          | A galactic conquest run in progress            |
| `#/warpath/:runId`                        | A Warpath run's node map                       |
| `#/lego/open`                             | Opens an archive member in the unit builder (advanced) |
| `#/lego/:id`                              | Editing a unit in the builder (advanced)       |

## Settings sections

Each settings section lives at `#/settings/<id>`. **Any** of these ids can be hidden from the Settings nav via the profile [`hideSettings`](distribution-profile.md#hidesettings-string) list. Sections with no page of their own are group headers. Visiting one shows an index of the sections nested under it (the indented rows below it).

| Settings section        | Id                 | Link                           |
| ------------------------ | ------------------ | ------------------------------- |
| General                  | `general`          | `#/settings/general`           |
| Appearance                | `frame.appearance` | `#/settings/frame.appearance`  |
| Engine Settings           | `engine-settings`  | `#/settings/engine-settings`   |
| → Display                | `engine-display`   | `#/settings/engine-display`    |
| → Graphics                | `engine-graphics`  | `#/settings/engine-graphics`   |
| → Sound                    | `engine-sound`     | `#/settings/engine-sound`      |
| → Input and camera          | `engine-input`     | `#/settings/engine-input`      |
| → In game                    | `engine-game`      | `#/settings/engine-game`       |
| → Keybinds                    | `engine-keybinds`  | `#/settings/engine-keybinds`   |
| → Saved configs                 | `engine-profiles`  | `#/settings/engine-profiles`   |
| → Engine log                     | `engine-log`       | `#/settings/engine-log`        |
| Notifications             | `notifications`    | `#/settings/notifications`     |
| Coilbox hub               | `hub`              | `#/settings/hub`               |
| Coilbox updates           | `updates`          | `#/settings/updates`           |
| Game updates              | `game-updates`     | `#/settings/game-updates`      |
| Multiplayer               | `multiplayer`      | `#/settings/multiplayer`       |
| → Lobby servers           | `lobby-servers`    | `#/settings/lobby-servers`     |
| → Chat highlights          | `chat-highlights`  | `#/settings/chat-highlights`   |
| → Ignored users              | `ignored-users`    | `#/settings/ignored-users`     |
| Library                   | `library`          | `#/settings/library`           |
| → Content folders         | `content-folders`  | `#/settings/content-folders`   |
| → Engines                  | `engines`          | `#/settings/engines`           |
| → Downloads                 | `downloads`        | `#/settings/downloads`         |
| → Storage                    | `storage`          | `#/settings/storage`           |
| → Import                      | `import`           | `#/settings/import`            |
| Advanced                  | `advanced`         | `#/settings/advanced`          |
| → mapconv                 | `mapconv`          | `#/settings/mapconv`           |
| → uberstress                | `uberstress`       | `#/settings/uberstress`        |
| → Distribution profile        | `profile`          | `#/settings/profile`           |

> Hiding is presentational: a hidden nav item or settings section is still reachable by a direct `#/…` link. Hiding removes the button, not the page.

## Useful links for a welcome screen

A profile's [`welcome`](distribution-profile.md#welcome-object) HTML commonly points at:

```html
<a href="#/play/skirmish">Play Skirmish</a>
<a href="#/campaign">Campaigns</a>
<a href="#/library/maps">Maps</a>
<a href="#/play/replays">Replays</a>
<a href="#/battles">Multiplayer</a>
<a href="#/settings">Settings</a>
```

Welcome HTML also has one non-navigation action available, closing the app:

```html
<button data-coilbox-action="quit">Exit</button>
```
