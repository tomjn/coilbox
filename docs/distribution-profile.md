# Distribution profiles

A **distribution profile** lets you ship Coilbox alongside a game (or otherwise
brand/narrow it) **without forking or rebuilding**. You drop a single
`profile.json` file next to the app; Coilbox reads it once at startup and applies
it: window title, hidden features, a preset game filter, a branded welcome screen,
theme colours, hidden settings sections, extra sidebar links, custom Markdown pages,
and a GitHub-releases update source for the game.

If no profile is present, Coilbox behaves exactly as normal.

> New here? Read **[portable-mode.md](portable-mode.md)** first — it explains the
> `.coilbox` folder this file lives in and how to package everything up. For the
> exact route/nav ids the `hide`, `hideSettings`, `welcome` and `links` fields
> below refer to, see **[routes.md](routes.md)**.

## Where the file goes

Profiles ride on **[portable mode](portable-mode.md)**. Put a `.coilbox` folder
next to the Coilbox executable and place `profile.json` inside it. The presence of
that `profile.json` is exactly what turns portable mode on (a bare `.coilbox`
folder is no longer enough, since the Windows installer keeps sidecars there too):

```
<YourGameFolder>/
  coilbox(.exe)            # or Coilbox.app on macOS (the folder beside it)
  .coilbox/
    profile.json          # <- the distribution profile
    data/                 # (portable app data, created on first run)
    cache/
```

- On **macOS**, `.coilbox` sits beside `Coilbox.app`, not inside it.
- In **development** (`bun tauri dev`), the binary runs from `target/debug/`, so the
  file lives at `target/debug/.coilbox/profile.json`.

The profile is only read when Coilbox is running in portable mode (i.e. a `.coilbox`
folder exists). A normal per-user install ignores it.

## Minimal example

```json
{
  "version": 1,
  "title": "Splinter Faction - Coilbox"
}
```

## Full example

```json
{
  "version": 1,
  "title": "Splinter Faction - Coilbox",
  "mode": "dark",
  "accent": "orange",
  "hide": ["downloads.browse", "downloads.games", "content.games"],
  "hideSettings": ["engines", "engine-settings", "downloads"],
  "gameFilter": { "regex": "^Splinter *Faction" },
  "welcome": {
    "css": ".coilbox-welcome{display:flex;flex-direction:column;align-items:center;gap:20px;padding:64px 32px;text-align:center;font-family:system-ui}.coilbox-welcome img{width:200px}.coilbox-welcome h1{color:hsl(var(--primary));font-weight:800}.coilbox-welcome .cta a{padding:10px 20px;border-radius:8px;font-weight:600;text-decoration:none}.coilbox-welcome .cta a.primary{background:hsl(var(--primary));color:hsl(var(--primary-foreground))}",
    "html": "<img src=\"https://splinterfaction.info/images/logo.webp\" alt=\"Splinter Faction\"><h1>Splinter Faction</h1><p>Welcome, commander.</p><div class=\"cta\"><a class=\"primary\" href=\"#/play/skirmish\">Play Skirmish</a></div>"
  }
}
```

## Fields

Every field is optional except `version`. Unknown fields are ignored, and a malformed
file falls back to defaults rather than breaking the app.

### `version` (number, required)

Schema version. Currently `1`.

### `title` (string)

Overrides the OS window title **and** the in-app title. Defaults to `"Coilbox"`.

```json
{ "version": 1, "title": "Splinter Faction - Coilbox" }
```

### `mode` (string)

Forces the colour scheme: `"light"`, `"dark"`, or `"system"`. Applied on every
launch (it overrides a value the user may have set previously — including one carried
over from a vanilla Coilbox install). The user can still switch it for the current
session under Settings > Appearance; it reverts to the profile next launch. Omit to
leave the colour scheme entirely under the user's control.

```json
{ "version": 1, "mode": "dark" }
```

### `accent` (string)

Forces a built-in accent colour — the `--primary` brand hue. This recolours the
whole shell cohesively (primary, ring, sidebar, in both light and dark) using
picoframe's vetted palette. Same force-each-launch / session-override behaviour as
`mode`. The full set of accents:

`neutral` (the default — no hue, the plain grey shell), `blue`, `green`, `rose`,
`violet`, `orange`, `red`, `amber`, `yellow`, `teal`, `cyan`, `sky`, `indigo`,
`purple`, `pink`, plus two animated/gradient accents `rainbow` and `opal`.

```json
{ "version": 1, "accent": "orange" }
```

> These are picoframe's accent axis. The neutral **base** tint (zinc, slate, gray,
> stone, …) is a separate control and isn't set from a profile — reach for `theme`
> (below) if you need to touch base tokens.

> Prefer `accent` over hand-rolling `theme` colours for the brand accent — it's one
> line and stays consistent across light/dark. Use `theme` (below) only for tokens
> the named accents don't cover.

### `hide` (string[])

Hides top-level navigation items (sidebar + welcome launcher) by id, and makes their
routes redirect home. Currently these nav ids can be hidden:

| id                 | Sidebar item          |
| ------------------ | --------------------- |
| `downloads.browse` | Downloads > Browse Rapid |
| `downloads.games`  | Downloads > Games     |
| `content.games`    | Content > Games       |

```json
{ "version": 1, "hide": ["downloads.games", "content.games"] }
```

> Adding a new hideable nav item is a one-line change in that plugin's `index.ts`
> (`useVisible: () => !isProfileHidden("<id>")`), so this list can grow on request.
> See **[routes.md](routes.md)** for the full list of pages and nav ids.

### `hideSettings` (string[])

Hides settings sections from the Settings navigation by id. **Any** app settings
section can be hidden:

| id                | Settings section   |
| ----------------- | ------------------ |
| `general`         | General            |
| `content-folders` | Content Folders    |
| `engines`         | Engines            |
| `engine-settings` | Engine Settings    |
| `downloads`       | Downloads          |
| `lobby-servers`   | Lobby servers      |
| `uberstress`      | uberstress         |
| `mapconv`         | mapconv            |
| `updates`         | Updates            |
| `game-updates`    | Game updates       |
| `profile`         | Distribution profile |
| `frame.appearance`| Appearance (theme/accent) |

```json
{ "version": 1, "hideSettings": ["engines", "engine-settings", "downloads"] }
```

Hiding the built-in **Appearance** section pairs well with forcing `mode` / `accent`
— it removes the theme controls so the brand's look is fixed:

```json
{ "version": 1, "mode": "dark", "accent": "orange", "hideSettings": ["frame.appearance"] }
```

> Note: hiding is presentational — a hidden section is still reachable by a direct
> `#/settings/<id>` link.

### `gameFilter` (object)

Narrows game lists to a single game. When set, the multiplayer **Battles** list and
the game picker only show matching games. Matched case-insensitively against the
game name.

```json
{ "version": 1, "gameFilter": { "regex": "^Splinter *Faction" } }
```

```json
{ "version": 1, "gameFilter": { "names": ["Splinter Faction"] } }
```

- `regex` — a case-insensitive regular expression tested against the game name.
- `names` — exact (case-insensitive) game names.

Provide either or both; an entry matches if the regex matches or any name matches.

### `welcome` (object)

Replaces the default home launcher with a branded landing page. Declarative HTML +
CSS only (no JavaScript).

```json
{
  "version": 1,
  "welcome": {
    "html": "<img src=\"https://example.com/logo.webp\"><h1>My Game</h1><p>Welcome!</p>",
    "css": ".coilbox-welcome{padding:48px;text-align:center}"
  }
}
```

- `html` — injected into the welcome page body. Style it via `.coilbox-welcome …`.
- `css` — injected alongside the HTML.
- **Local media**: reference files bundled in your `.coilbox/` folder by relative path,
  and Coilbox resolves them at load time — in both the HTML and the CSS. So
  `<img src="images/logo.webp">`, `background: url(images/hero.gif)`, and even
  `@font-face { src: url(fonts/brand.woff2) }` all pull from `.coilbox/images/…`,
  `.coilbox/fonts/…`, etc. Images, animated GIFs, audio (`<audio src="…">`), video
  (`<video>`) and web fonts are supported. Absolute URLs (`https:`, `data:`) and
  app-absolute paths (`/…`) are left untouched, so remote `https` images still work
  directly with no embedding.
- **In-app links**: because Coilbox uses hash routing, an `<a href="#/play/skirmish">`
  navigates inside the app without a reload. Useful routes include
  `#/play/skirmish`, `#/content/maps`, `#/content/replays`, `#/battles`,
  `#/settings` — the full list is in **[routes.md](routes.md)**.
- **Quit action**: the welcome HTML can't run JavaScript, but any element carrying
  `data-coilbox-action="quit"` closes Coilbox when clicked — the one interactive hook
  available. Use it to add your own exit control to a branded landing page (handy for
  fullscreen builds). This works regardless of the [`quit`](#quit-boolean) flag.

  ```json
  { "html": "<button data-coilbox-action=\"quit\">Exit</button>" }
  ```

The HTML is trusted (it ships inside your distribution): apart from rewriting relative
asset URLs (above), it is injected as-is, so only put content you control in it.

### `links` (object[])

Adds external links to the sidebar **and** the home launcher — e.g. a Discord
invite or a wiki. Each entry:

| Field   | Required | Meaning                                                        |
| ------- | -------- | -------------------------------------------------------------- |
| `label` | yes      | Sidebar/launcher text, e.g. `"Discord"`.                       |
| `href`  | yes      | URL opened in the system browser. Must be `http(s)` / `mailto` / `tel`. |
| `icon`  | no       | Icon name from the list below; unknown or omitted uses a generic link icon. |
| `group` | no       | Sidebar group heading. Links sharing a `group` merge into one section; omitting it uses a default **Links** group. These groups sit below the built-in navigation. |

```json
{
  "version": 1,
  "links": [
    { "label": "Discord", "href": "https://discord.gg/xxxx", "icon": "discord" },
    { "label": "Wiki", "href": "https://wiki.example", "icon": "docs", "group": "Community" },
    { "label": "Donate", "href": "https://example.com/donate", "icon": "heart", "group": "Community" }
  ]
}
```

Malformed entries (missing `label` / `href`, or an href scheme the browser opener
won't open) are skipped; the rest still load.

**Icon names:** `discord`, `forum` / `forums`, `chat` / `message`,
`globe` / `website` / `web`, `docs` / `book` / `wiki`, `news` / `blog`,
`rss` / `feed`, `heart` / `donate`, `support` / `help`, `users` / `community`,
`mail` / `email` / `contact`, `link`, `game` / `play`, `calendar` / `events`,
`star`, `info`, `hash` / `channel`, `bell` / `updates`, `trophy`. Anything else
falls back to a generic external-link icon. (lucide ships no brand marks, so
`discord` uses a generic chat glyph.)

### `lobby` (object)

Controls the multiplayer **lobby-server** presets a distribution ships: a preferred
"official" server, which stock presets appear, and the chat channels a player joins on
login. It narrows and brands the Settings > Lobby servers list without ever locking the
player out — they can still add their own servers and remove their own logins.

| Field      | Required | Meaning                                                          |
| ---------- | -------- | ---------------------------------------------------------------- |
| `official` | no       | The preferred server. Either a built-in **id** (a string, e.g. `"recoil-official"`) to promote an existing preset, or an inline server object (below). Shown with an **Official** badge, listed first, and not removable. |
| `presets`  | no       | Allow-list of built-in server **ids** to keep. Omitted → all built-ins shown (the default). Present → only these appear (plus `official`); `[]` hides every stock preset, leaving just the official one. Never restricts the player's own custom servers. |
| `channels` | no       | Channels seeded into the auto-join list the **first** time a login connects to the official server. A seed, not a lock: the player can leave them afterwards and they stay gone. Each entry is a channel name string, or `{ "name": "...", "key": "..." }` for a keyed channel. |

An inline `official` server object:

| Field             | Required | Meaning                                          |
| ----------------- | -------- | ------------------------------------------------ |
| `host`            | yes      | Hostname, e.g. `"lobby.example.org"`.            |
| `name`            | no       | Display name; defaults to the host.              |
| `port`            | no       | TCP port. Defaults to `8200`.                    |
| `tls`             | no       | Connect over TLS. Defaults to `false`.           |
| `allowSelfSigned` | no       | Accept a self-signed cert. Defaults to `false`.  |

A single-server distribution — one official server, no stock presets:

```json
{
  "version": 1,
  "lobby": {
    "official": {
      "name": "Scary Lobby",
      "host": "lobby.scary.example",
      "tls": true,
      "allowSelfSigned": true
    },
    "presets": [],
    "channels": ["main", "newbies", { "name": "clan", "key": "s3cret" }]
  }
}
```

Or just promote and brand an existing built-in as official while keeping one other
preset available:

```json
{
  "version": 1,
  "lobby": { "official": "recoil-official", "presets": ["bar"] }
}
```

Built-in ids: `recoil-official`, `spring-official`, `techa`, `bar`, `bar-ssl`. An
unknown `official` id (or an inline object with no `host`) is ignored — the rest of the
block still applies.

### `splash` (object)

Shows a brand splash over the whole window at startup: a centered image that fades in
on a solid background, holds, then fades out. Plays on every launch; the user can turn
it off (Settings > General > Display > "Startup splash") and can dismiss it early by
clicking it or pressing Escape.

```json
{
  "version": 1,
  "splash": {
    "image": "logo.webp",
    "background": "hsl(240 6% 7%)",
    "duration": 3000
  }
}
```

- `image` — the centered image. Either a path **relative to the `.coilbox/` folder**
  (read locally, so it works offline — put e.g. `logo.webp` next to `profile.json`),
  or an inline `data:` / `https:` URL used as-is. Paths can't escape `.coilbox/`
  (no `..` or absolute paths).
- `background` (optional) — solid backdrop CSS colour. Defaults to the profile's
  top-level [`background`](#background-string) if set, else the theme background.
- `duration` (optional) — total time in ms (fade in + hold + fade out). Defaults to
  `3000`.

Honours `prefers-reduced-motion` (skips the fades). If the image can't be loaded the
splash is silently skipped — it never blocks startup.

### `background` (string)

A solid CSS colour painted behind everything from the first frame until the app has
rendered. A dark distribution otherwise briefly flashes the default white page while
it loads; setting this paints your colour instead. It's also the splash's default
backdrop, so one colour covers the boot screen and the splash seamlessly.

```json
{ "version": 1, "mode": "dark", "background": "hsl(240 6% 7%)" }
```

The colour is cached so it applies before the first paint on subsequent launches (the
very first launch of a fresh install still shows one brief flash). A vanilla install
(no profile) is unaffected.

### `theme` (object)

Fine-grained override of Coilbox's colour tokens app-wide, for anything the named
`accent` doesn't cover. Each key is a CSS custom property; each value is an HSL triple
(`H S% L%`, no `hsl()` wrapper). These re-point picoframe's design tokens, so the
whole shell recolours. For a simple brand accent, prefer `accent` above.

```json
{
  "version": 1,
  "theme": {
    "--primary": "22 92% 52%",
    "--ring": "22 92% 52%",
    "--sidebar-primary": "22 92% 52%",
    "--background": "20 14% 8%"
  }
}
```

Common tokens: `--primary`, `--primary-foreground`, `--ring`, `--accent`,
`--sidebar-primary`, `--background`, `--foreground`, `--border`. See
`node_modules/@picoframe/frame/src/theme.css` for the full list and the light/dark
defaults.

> Coilbox also ships built-in named [`accent`](#accent-string)s (neutral, blue,
> green, rose, orange, … — the full axis) selectable under Settings > Appearance.
> A `theme` override takes precedence over the user's accent choice.

### `release` (object)

Points Coilbox at a GitHub repository whose **releases** ship the game's archive
(`.sdz` / `.sd7`) — for games distributed outside the rapid ecosystem (e.g. straight
from GitHub). On launch Coilbox checks the repo's latest release; if none of that
release's archives are already installed, a **Game updates** settings section and a
topbar badge offer a one-click download that installs the archive and rescans content.

```json
{ "version": 1, "release": { "repo": "your-org/your-game" } }
```

- `repo` — the GitHub repository as `"owner/name"`.

"Latest" is whatever GitHub marks as the latest release. If that release also carries
an asset named exactly `profile.json`, Coilbox installs it into `.coilbox/` alongside
the game archive; because the profile is read once at startup, the app then prompts for
a restart to apply the updated profile.

### `mapLists` (object[])

Curated **map packs** offered for bulk download on the Maps download page — a
tournament set, a galactic-conquest galaxy, "space maps", etc. Each pack has an
`id`, a `title`, an optional `blurb`, and a `maps[]` array; **Download all** queues
every not-yet-present map in the pack through the normal download queue.

```json
{
  "version": 1,
  "mapLists": [
    {
      "id": "tournament-2026",
      "title": "Tournament 2026 map set",
      "blurb": "The official pool for this season.",
      "maps": [
        {
          "id": "supreme-isthmus",
          "title": "Supreme Isthmus v2.1",
          "filename": "supreme_isthmus_v2.1.sd7",
          "download": { "kind": "map", "springName": "Supreme Isthmus v2.1" }
        }
      ]
    }
  ]
}
```

Each map's `download` is `{ "kind": "map", "springName", "searchUrl"? }` (fetched
by springname via pr-downloader) or `{ "kind": "url", "url", "filename", "subdir"? }`
(a direct mirror file); `filename` enables "already downloaded" detection. This is
the same shape and mechanism the branding catalog's `suggested.mapLists` uses — see
[Branding catalog](../README.md#branding-catalog); catalog packs are listed first,
then a profile's, deduped by `id`.

### `quit` (boolean)

Adds a **Quit** button to the bottom of the sidebar that closes Coilbox. Off by
default. It's an escape hatch for fullscreen or kiosk (`fullscreenLocked`) builds,
where a player may otherwise have no obvious way out — so unlike the fullscreen
toggle, this button is **not** removed by the kiosk lock.

```json
{ "version": 1, "fullscreen": true, "quit": true }
```

For a fully branded exit instead of (or in addition to) the sidebar button, put a
`data-coilbox-action="quit"` element in your [`welcome`](#welcome-object) HTML.

### `layout` (object)

Controls the app-frame chrome — the sidebar mode, the breadcrumb, the top-bar
history/fullscreen buttons, the menu-button branding, and top-bar logos. These
are **locks** (authoritative every launch, like `title`/`hide`, with no user
toggle) except `sidebarCollapsed`, which is a **seed**. Omit `layout` and the
chrome behaves as normal.

```json
{
  "version": 1,
  "layout": {
    "popover": true,
    "sidebarCollapsed": true,
    "hideBreadcrumb": true,
    "historyButtons": false,
    "fullscreenButton": false,
    "menu": {
      "label": "Splinter Faction",
      "icon": "game",
      "image": "menu-logo.webp"
    },
    "center": { "image": "wordmark.webp", "href": "https://example.com" }
  }
}
```

| Field              | Type    | Meaning                                                                 |
| ------------------ | ------- | ----------------------------------------------------------------------- |
| `popover`          | boolean | `true` forces the sidebar into popover mode (a menu button opens it as an overlay); omitted/`false` is a persistent sidebar. A lock — the user has no toggle. |
| `sidebarCollapsed` | boolean | **Seed** the sidebar to start collapsed. The user can still expand it, and their choice persists. Only meaningful when `popover` is off. |
| `hideBreadcrumb`   | boolean | Hide the breadcrumb region in the top bar entirely.                     |
| `historyButtons`   | boolean | Force the top-bar back/forward buttons on (`true`) or off (`false`).    |
| `fullscreenButton` | boolean | `false` hides the top-bar fullscreen button and makes F11 inert (does **not** force fullscreen — that's [`fullscreenLocked`](#fullscreenlocked-boolean)). Default `true`. |
| `menu`             | object  | Branding for the popover menu button (see below).                       |
| `left` / `center` / `right` | object | A logo/text in the corresponding top-bar slot (see below).     |

**`menu` (popover menu-button branding).** When the sidebar is in popover mode
(`popover: true`) a menu button in the top bar opens it; this rebrands that
button. It is **only visible in popover mode**.

| Field          | Type    | Meaning                                                                         |
| -------------- | ------- | ------------------------------------------------------------------------------- |
| `label`        | string  | The button's accessible name and tooltip.                                       |
| `labelVisible` | boolean | Show the label/logo beside the icon. Defaults to `true` when `label` or `image` is set; set `false` for an icon-only button that still has your `label` as its tooltip. |
| `icon`         | string  | Icon name (same list as [`links`](#links-object)) for the closed state.         |
| `iconOpen`     | string  | Icon name for the open state.                                                   |
| `image`        | string  | A logo shown in place of the label text. Same source rules as [`splash.image`](#splash-object) (`.coilbox`-relative path, or inline `data:`/`https:`). Wins over `label` as the visible content; `label` stays the accessible name. |

**`left` / `center` / `right` (top-bar logos).** Each places a logo or text in
that top-bar slot. Same shape:

| Field   | Type   | Meaning                                                                          |
| ------- | ------ | -------------------------------------------------------------------------------- |
| `text`  | string | Text shown when no image resolves.                                               |
| `image` | string | Logo image. Same source rules as [`splash.image`](#splash-object). **Wins over `text`** when it resolves; falls back to `text` if it can't be loaded. |
| `href`  | string | Makes the logo a link opened in the system browser (`http(s)`/`mailto`/`tel`; other schemes are ignored). |

### `conquest` (object)

Supplies system/faction names — and whole lore factions — for
**[Galactic Conquest](conquest.md)** galaxies generated in this distribution, so
they read as your game rather than generic space. Every field is optional and
overrides the branding catalog's per-game defaults.

```json
{
  "version": 1,
  "conquest": {
    "starNames": ["Uros", "Ophvor", "Loz"],
    "factions": [
      { "name": "Sovereign Syndicate", "color": "#00c853", "side": "Core", "aggression": 0.4 }
    ]
  }
}
```

- `starNames` / `starPrefixes` / `starSuffixes` — full system names (used first),
  then syllables synthesized names are built from.
- `factionNames` — full faction names, used when no `factions` presets are given.
- `factions` — lore factions assigned in order (the player first); each is
  `{ name, color?, side?, aggression? }`.

See the [Names and factions](conquest.md#names-and-factions) section for how the
pools are drawn and the full merge order (profile over catalog over built-ins).

## Custom pages

A distribution can add its own screens — a rules page, a "getting started" guide, a
credits page — by dropping Markdown files into a **`pages/` folder** inside `.coilbox`.
Each `.md` file becomes an in-app page; no `profile.json` entry is needed (the folder is
auto-discovered).

```
<YourGameFolder>/
  .coilbox/
    profile.json
    pages/
      about.md
      rules.md
      bg.jpg          # an asset a page references
```

Each file starts with an optional **frontmatter** block — a `---`-fenced set of
`key: value` lines — that configures the page:

```markdown
---
path: rules
title: House Rules
icon: info
group: Info
order: 10
background: pages/bg.jpg
---

# House Rules

1. Be excellent to each other.
2. No sharing accounts.

See the [about page](#/pages/about) for more.
```

| Key          | Meaning                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `path`       | Route slug. The page is served at `#/pages/<path>` (always namespaced under `pages/` so it can't collide with a built-in screen). Lowercase `a-z 0-9 - /`; omitted → derived from the filename. |
| `title`      | Breadcrumb and sidebar label. Omitted → the slug.                                                |
| `icon`       | Sidebar icon — same name list as [`links`](#links-object).                                       |
| `nav`        | `false` keeps the page reachable by link/route but adds **no** sidebar item (a hidden-but-linkable page). Default `true`. |
| `group`      | Sidebar group heading; pages sharing a `group` collect under it. Omitted → a top-level item.     |
| `order`      | Sort order among pages (sidebar + routes).                                                        |
| `background` | A full-page background image. `.coilbox`-relative (e.g. `pages/bg.jpg`) or an inline `data:`/`https:` URL. |

Notes:

- **Assets are `.coilbox`-relative**, the same convention as the splash/logo images. A
  Markdown image `![](pages/diagram.png)` or a `background: pages/bg.jpg` resolves to a
  file under `.coilbox/`. Audio/video files referenced as images render inline players.
- **Link between pages** (or from a welcome screen) with `#/pages/<path>` — handy with
  `nav: false` for pages you only want reached from elsewhere.
- Content is trusted bundler-authored Markdown (safe by default: no raw HTML/JS).
  Malformed or duplicate `path`s are skipped rather than breaking the app.

## Verifying it's active

Open **Settings > Distribution profile**. It shows whether a profile is loaded, where
it came from (`file` / `default`), and a summary of everything it's changing. If no
profile is loaded it reads "No distribution profile loaded — standard Coilbox".
