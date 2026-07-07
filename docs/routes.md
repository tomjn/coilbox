# Routes and nav ids

A reference for the internal locations you can link to and the ids you can hide,
so the [distribution profile](distribution-profile.md) `hide`, `hideSettings`,
`welcome` and `links` fields have something concrete to point at.

Coilbox uses **hash routing**: every screen is a URL fragment beginning with
`#/`. That's what makes in-app links work from a profile's welcome HTML —
`<a href="#/play/skirmish">` navigates without a page reload.

## Top-level pages

These appear in the sidebar for every user (unless hidden). The **nav id** column
is what you pass to the profile [`hide`](distribution-profile.md#hide-string) list
(only the ids marked hideable can currently be hidden).

| Sidebar group | Item          | Link (`href`)        | Nav id             | Hideable |
| ------------- | ------------- | -------------------- | ------------------ | -------- |
| Play          | Singleplayer  | `#/play/skirmish`    | `play.skirmish`    | no       |
| Play          | Campaigns     | `#/campaign`         | `campaign.list`    | no¹      |
| Multiplayer   | Login         | `#/lobby`            | `multiplayer.lobby`| no²      |
| Multiplayer   | Chat          | `#/chat`             | `multiplayer.chat` | no²      |
| Multiplayer   | Battles       | `#/battles`          | `multiplayer.battles` | no²   |
| Multiplayer   | Battle Room   | `#/battle`           | `multiplayer.battle`  | no²   |
| Content       | Maps          | `#/content/maps`     | `content.maps`     | no       |
| Content       | Games         | `#/content/games`    | `content.games`    | **yes**  |
| Content       | Replays       | `#/content/replays`  | `content.replays`  | no       |
| Downloads     | Browse Rapid  | `#/downloads`        | `downloads.browse` | **yes**  |
| Downloads     | Maps          | `#/downloads/maps`   | `downloads.maps`   | no       |
| Downloads     | Games         | `#/downloads/games`  | `downloads.games`  | **yes**  |

¹ **Campaigns** only appears in the sidebar once at least one campaign exists
(bundled or created locally). Until then the item is hidden automatically.

² **Multiplayer** items appear contextually, not via the profile: **Login** shows
only while logged out; **Chat** and **Battles** appear after the first connect;
**Battle Room** only while you're in a battle.

> Want a nav item hideable that isn't yet? It's a one-line change per item in the
> plugin — ask and the list can grow. Today only `content.games`,
> `downloads.browse` and `downloads.games` are wired for hiding.

## Advanced-mode pages

These are hidden unless **Advanced mode** is on (Settings > General). They're
modding/authoring tools, not player-facing, so a game distribution usually leaves
Advanced mode off and never sees them.

| Sidebar group    | Item        | Link (`href`)          |
| ---------------- | ----------- | ---------------------- |
| Content          | Archives    | `#/content/archives`   |
| uberstress       | Run         | `#/uberstress`         |
| uberstress       | History     | `#/uberstress/history` |
| Campaign Builder | Builder     | `#/campaign-builder`   |
| mapconv          | Projects    | `#/mapconv/projects`   |
| mapconv          | Compile     | `#/mapconv`            |
| mapconv          | Decompile   | `#/mapconv/decompile`  |
| animation        | BOS → Lua   | `#/animation`          |
| animation        | COB tools   | `#/animation/cob`      |

(mapconv and animation also add a few external-link items — wiki/tool guides —
that open in the browser rather than routing in-app.)

## Detail pages

Reachable by clicking through the lists above; not sidebar items, but you can
deep-link to them if you know the id/name. `:name` and `:id` are placeholders.

| Link (`href`)                       | What it is                     |
| ----------------------------------- | ------------------------------ |
| `#/content/maps/:name`              | A single map's detail page     |
| `#/content/games/:name`             | A single game's detail page    |
| `#/content/replays/:name`           | A single replay's detail page  |
| `#/content/archives/:name`          | A single archive (advanced)    |
| `#/campaign/:id`                    | A campaign's mission list      |
| `#/campaign/:id/:missionId`         | A mission briefing/result      |
| `#/campaign-builder/:id`            | Editing a campaign (advanced)  |

## Settings sections

Each settings section lives at `#/settings/<id>`. **Any** of these ids can be
hidden from the Settings nav via the profile
[`hideSettings`](distribution-profile.md#hidesettings-string) list.

| Settings section     | Id                 | Link                          |
| -------------------- | ------------------ | ----------------------------- |
| General              | `general`          | `#/settings/general`          |
| Content Folders      | `content-folders`  | `#/settings/content-folders`  |
| Engines              | `engines`          | `#/settings/engines`          |
| Engine Settings      | `engine-settings`  | `#/settings/engine-settings`  |
| Downloads            | `downloads`        | `#/settings/downloads`        |
| Lobby servers        | `lobby-servers`    | `#/settings/lobby-servers`    |
| uberstress           | `uberstress`       | `#/settings/uberstress`       |
| mapconv              | `mapconv`          | `#/settings/mapconv`          |
| Updates              | `updates`          | `#/settings/updates`          |
| Game updates         | `game-updates`     | `#/settings/game-updates`     |
| Distribution profile | `profile`          | `#/settings/profile`          |
| Appearance           | `frame.appearance` | `#/settings/frame.appearance` |

> Hiding is presentational: a hidden nav item or settings section is still
> reachable by a direct `#/…` link. Hiding removes the button, not the page.

## Useful links for a welcome screen

A profile's [`welcome`](distribution-profile.md#welcome-object) HTML commonly
points at:

```html
<a href="#/play/skirmish">Play Skirmish</a>
<a href="#/campaign">Campaigns</a>
<a href="#/content/maps">Maps</a>
<a href="#/content/replays">Replays</a>
<a href="#/battles">Multiplayer</a>
<a href="#/settings">Settings</a>
```

And the one non-navigation action available in welcome HTML — close the app:

```html
<button data-coilbox-action="quit">Exit</button>
```
