# Distribution profiles

A **distribution profile** lets you ship Coilbox alongside a game (or otherwise
brand/narrow it) **without forking or rebuilding**. You drop a single
`profile.json` file next to the app; Coilbox reads it once at startup and applies
it: window title, hidden features, a preset game filter, a branded welcome screen,
theme colours, and hidden settings sections.

If no profile is present, Coilbox behaves exactly as normal.

## Where the file goes

Profiles ride on **portable mode**. Put a `.coilbox` folder next to the Coilbox
executable and place `profile.json` inside it:

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

Forces a built-in accent colour: `"zinc"` (default), `"blue"`, `"green"`, `"rose"`,
`"violet"`, or `"orange"`. This recolours the whole shell cohesively (primary, ring,
sidebar, in both light and dark) using picoframe's vetted palette. Same
force-each-launch / session-override behaviour as `mode`.

```json
{ "version": 1, "accent": "orange" }
```

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
- **Images**: remote `https` images work directly (e.g. a hosted logo). No embedding
  needed.
- **In-app links**: because Coilbox uses hash routing, an `<a href="#/play/skirmish">`
  navigates inside the app without a reload. Useful routes include
  `#/play/skirmish`, `#/content/maps`, `#/content/replays`, `#/battles`,
  `#/settings`.

The HTML is trusted (it ships inside your distribution). It is injected verbatim, so
only put content you control in it.

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

> Coilbox also ships built-in named accents (zinc, blue, green, rose, violet,
> orange) selectable under Settings > Appearance. A `theme` override takes
> precedence over the user's accent choice.

## Verifying it's active

Open **Settings > Distribution profile**. It shows whether a profile is loaded, where
it came from (`file` / `default`), and a summary of everything it's changing. If no
profile is loaded it reads "No distribution profile loaded — standard Coilbox".
