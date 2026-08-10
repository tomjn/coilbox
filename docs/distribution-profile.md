# Distribution profiles

A **distribution profile** lets you ship Coilbox alongside a game (or otherwise brand/narrow it) **without forking or rebuilding**. You drop a single `profile.json` file next to the app, Coilbox reads it once at startup and applies it: window title, hidden features, a preset game filter, a branded welcome screen, a rearranged [home page](#home-object), theme colours, hidden settings sections, extra sidebar links, custom Markdown pages, and a GitHub-releases update source for the game.

If no profile is present, Coilbox behaves exactly as normal.

> New here? Read **[portable-mode.md](portable-mode.md)** first — it explains the
> `.coilbox` folder this file lives in and how to package everything up. For the
> exact route/nav ids the `hide`, `hideSettings`, `welcome` and `links` fields
> below refer to, see **[routes.md](routes.md)**.

## Where the file goes

Profiles ride on **[portable mode](portable-mode.md)**. Put a `.coilbox` folder next to the Coilbox executable and place `profile.json` inside it. The presence of that `profile.json` is exactly what turns portable mode on (a bare `.coilbox` folder is no longer enough, since the Windows installer keeps sidecars there too):

```
<YourGameFolder>/
  coilbox(.exe)            # or Coilbox.app on macOS (the folder beside it)
  .coilbox/
    profile.json          # <- the distribution profile
    data/                 # (portable app data, created on first run)
    cache/
```

- On **macOS**, `.coilbox` sits beside `Coilbox.app`, not inside it.
- In **development** (`bun tauri dev`), the binary runs from `target/debug/`, so the file lives at `target/debug/.coilbox/profile.json`.

The profile is only read when Coilbox is running in portable mode (i.e. a `.coilbox` folder exists). A normal per-user install ignores it.

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

## Custom pages

A distribution can add its own screens — a rules page, a "getting started" guide, a credits page — by dropping Markdown files into a **`pages/` folder** inside `.coilbox`. Each `.md` file becomes an in-app page; no `profile.json` entry is needed (the folder is auto-discovered).

```
<YourGameFolder>/
  .coilbox/
    profile.json
    pages/
      about.md
      rules.md
      bg.jpg          # an asset a page references
```

Each file starts with an optional **frontmatter** block — a `---`-fenced set of `key: value` lines — that configures the page:

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

- **Assets are `.coilbox`-relative**, the same convention as the splash/logo images. A Markdown image `![](pages/diagram.png)` or a `background: pages/bg.jpg` resolves to a file under `.coilbox/`. Audio/video files referenced as images render inline players.
- **Link between pages** (or from a welcome screen) with `#/pages/<path>`, or a plain `[label](other.md)` link — handy with `nav: false` for pages reached only from elsewhere. See [File references](#file-references) for the full link/route scheme.
- **Compose** pages with [`@` references](#file-references): include shared fragments (`@.coilbox/pages/_foo.md`), link to routes (`@route/singleplayer`), and embed live GUI (`@widget/onboarding`, `@widget/build-tree/<game>`).
- Content is trusted bundler-authored Markdown (safe by default: no raw HTML/JS). Malformed or duplicate `path`s are skipped rather than breaking the app.

## File references (`@`)

Profile content is composable through a single `@<namespace>/<rest>` token. The first segment after `@` is a namespace, so there's no ambiguity between (say) a file named `route` and the route namespace:

| Token                          | Means                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `@.coilbox/<path>`             | A **file** under the portable `.coilbox/` folder. A path that escapes the folder (`..`, absolute) is rejected — it can only read files you shipped. |
| `@route/<app-route>`           | An **in-app route**, e.g. `@route/singleplayer`, `@route/downloads/games`. |
| `@widget/<name>[/<arg>]`       | An embedded **live Coilbox component** (see [widgets](#widget-catalogue) below). |

Anything that can't be resolved (a missing file, an unknown widget, an escaping path) renders a **visible error/placeholder**, never a silent blank — so a typo in a bundle is obvious rather than mysterious.

### File-reference profile fields

The [`welcome`](#welcome-object) `html`/`css` fields accept a `@.coilbox/<path>` reference instead of an inline fragment, so you can keep the markup in its own file:

```json
{ "welcome": { "html": "@.coilbox/welcome.html", "css": "@.coilbox/welcome.css" } }
```

The referenced `.html` file's raw HTML is injected as-is — the **one** place raw HTML is allowed (it's your own trusted, script-free file, same as the inline fragment).

### Including files into a page

A custom page can **transclude** another Markdown file: a line whose sole content is a `@.coilbox/<path>.md` reference is replaced by that file's contents (recursively), so pages can share a common header, footer, or rules block:

```markdown
# Getting started

@.coilbox/pages/_shared-intro.md

Now pick a faction below.
```

Includes are cycle-guarded and depth-capped; a missing file or an include loop shows an error marker line instead of hanging.

### Linking between pages and routes

Markdown links resolve intelligently:

- `[Rules](rules.md)` → the page `#/pages/rules` (a `.md` link maps to its page by filename; a nested page can be linked with `@route/pages/...`).
- `[Play](@route/singleplayer)` → navigates in-app.
- `[Discord](https://discord.gg/…)` → opens in the system browser (never navigates the app's own window away).

### Widget catalogue

Drop a live piece of Coilbox GUI into a page by putting a `@widget/<name>` token on its own line:

```markdown
# Welcome

@widget/onboarding

## Maps

@widget/map-pack

## Factions

@widget/faction-button/Beyond All Reason
```

| Widget                          | Renders                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `@widget/onboarding`            | The first-run "Set up Coilbox" + get-started download cards.            |
| `@widget/welcome`               | The branded [`welcome`](#welcome-object) screen.                        |
| `@widget/map-pack`              | The curated [map-pack](#maplists-object) download banner.               |
| `@widget/build-tree/<game>`     | A game's full build-tree graph (all factions, tabbed) in the page.      |
| `@widget/faction-button/<game>` | Per-faction buttons that open the build-tree drawer.                    |

The `<game>` arg matches a game's name or shortname (case-insensitive); on a single-game install it can be omitted. While the game is being scanned, or if it isn't installed, the widget shows a skeleton/notice rather than a blank.

## Verifying it's active

Open **Settings > Distribution profile**. It shows whether a profile is loaded, where it came from (`file` / `default`), and a summary of everything it's changing. If no profile is loaded it reads "No distribution profile loaded — standard Coilbox".

The "Home page" row covers the [`home`](#home-object) key: which layout drew the page, how many zones it drew, and whether that was your `zones` list or the default that moves with Coilbox. It reads "Default" for a profile that has no `home` key. A `layout` name this build does not ship reads as "Default layout" here, because that is the page you are looking at, and the name you wrote is named in the validation row instead.

"Validate profile", below the summary, adds a `home` row naming anything Coilbox dropped or could not read. That row is absent when there is nothing wrong, and for a profile with no `home` key at all. See [when a `home` key is wrong](#when-a-home-key-is-wrong).

## Writing and iterating on a profile

Settings > Distribution profile carries two authoring controls. Which one you see depends on whether a profile is loaded.

**No profile yet: Create profile.json.** Writes a starter profile into `.coilbox/` beside the app, filled in from how Coilbox is set up right now: the title, colour scheme, accent, advanced mode and fullscreen you can see on screen, plus a [`gameFilter`](#gamefilter-object) when exactly one game is installed. It never overwrites a profile that is already there. Coilbox has to restart to pick the new file up, because a `.coilbox` folder with no `profile.json` in it is not a portable install yet, so the button offers the restart.

**Profile loaded: Reload profile.** Re-reads `profile.json` and applies it to the running app, so the edit loop is a reload rather than a restart. Everything applies, including the parts that otherwise only run at startup: theme, hidden nav, top bar, links, custom pages, welcome, home zones and splash. You stay on the page you were on, so you can sit on the screen you are styling and reload after each edit. Anything in progress elsewhere in the app resets, exactly as a restart would reset it.

Both controls disappear when the profile sets [`"authoring": false`](#authoring-boolean), which is what you ship.

## Fields

Every field is optional except `version`. Unknown fields are ignored, and a malformed file falls back to defaults rather than breaking the app.

### `version` (number, required)

Schema version. Currently `1`.

### `title` (string)

Overrides the OS window title **and** the in-app title. Defaults to `"Coilbox"`.

```json
{ "version": 1, "title": "Splinter Faction - Coilbox" }
```

### `mode` (string)

Forces the colour scheme: `"light"`, `"dark"`, or `"system"`. Applied on every launch (it overrides a value the user may have set previously — including one carried over from a vanilla Coilbox install). The user can still switch it for the current session under Settings > Appearance; it reverts to the profile next launch. Omit to leave the colour scheme entirely under the user's control.

```json
{ "version": 1, "mode": "dark" }
```

### `accent` (string)

Forces a built-in accent colour — the `--primary` brand hue. This recolours the whole shell cohesively (primary, ring, sidebar, in both light and dark) using picoframe's vetted palette. Same force-each-launch / session-override behaviour as `mode`. The full set of accents:

`neutral` (the default — no hue, the plain grey shell), `blue`, `green`, `rose`, `violet`, `orange`, `red`, `amber`, `yellow`, `teal`, `cyan`, `sky`, `indigo`, `purple`, `pink`, plus two animated/gradient accents `rainbow` and `opal`.

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

Hides top-level navigation items (sidebar + welcome launcher) by id, and makes their routes redirect home. Currently these nav ids can be hidden:

| id                   | Sidebar item          |
| -------------------- | --------------------- |
| `downloads.browse`   | Downloads > Browse Rapid |
| `downloads.games`    | Downloads > Games     |
| `content.games`      | Content > Games       |
| `content.setupPacks` | Content > Setup packs |
| `multiplayer.stats`  | Multiplayer > Player stats |
| `conquest.list`      | Play > Conquest       |
| `runlite.list`       | Play > Warpath        |
| `campaign.builder`   | Campaign Builder > Builder |

```json
{ "version": 1, "hide": ["downloads.games", "content.games"] }
```

> Adding a new hideable nav item is a one-line change in that plugin's `index.ts`
> (`useVisible: () => !isProfileHidden("<id>")`), so this list can grow on request.
> See **[routes.md](routes.md)** for the full list of pages and nav ids.

### `hideSettings` (string[])

Hides settings sections from the Settings navigation by id. **Any** app settings section can be hidden:

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

Hiding the built-in **Appearance** section pairs well with forcing `mode` / `accent` — it removes the theme controls so the brand's look is fixed:

```json
{ "version": 1, "mode": "dark", "accent": "orange", "hideSettings": ["frame.appearance"] }
```

> Note: hiding is presentational — a hidden section is still reachable by a direct
> `#/settings/<id>` link.

### `gameFilter` (object)

Narrows game lists to a single game. When set, the multiplayer **Battles** list, the game picker and the [Coilbox hub](#hub-boolean) browse screen only show matching games. Matched case-insensitively against the game name.

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

Replaces the default home launcher with a branded landing page. Declarative HTML + CSS only (no JavaScript).

```json
{
  "version": 1,
  "welcome": {
    "html": "<img src=\"https://example.com/logo.webp\"><h1>My Game</h1><p>Welcome!</p>",
    "css": ".coilbox-welcome{padding:48px;text-align:center}"
  }
}
```

Instead of inlining the markup, point `html`/`css` at a **file** in your `.coilbox/` folder with a [`@.coilbox/<path>` reference](#file-references) — much easier to edit and version than a one-line JSON string, and the only place raw HTML is allowed (it's your own trusted, script-free file):

```json
{
  "version": 1,
  "welcome": { "html": "@.coilbox/welcome.html", "css": "@.coilbox/welcome.css" }
}
```

```
<YourGameFolder>/
  .coilbox/
    profile.json
    welcome.html     # your landing-page markup
    welcome.css      # its styles
```

- `html` — injected into the welcome page body. Style it via `.coilbox-welcome …`. Either an inline fragment (above) or a `@.coilbox/<path>.html` [file reference](#file-references) to keep the markup in its own file.
- `css` — injected alongside the HTML. Inline, or a `@.coilbox/<path>.css` reference.
- **Local media**: reference files bundled in your `.coilbox/` folder by relative path, and Coilbox resolves them at load time — in both the HTML and the CSS. So `<img src="images/logo.webp">`, `background: url(images/hero.gif)`, and even `@font-face { src: url(fonts/brand.woff2) }` all pull from `.coilbox/images/…`, `.coilbox/fonts/…`, etc. Images, animated GIFs, audio (`<audio src="…">`), video (`<video>`) and web fonts are supported. A `@.coilbox/<path>` [file reference](#file-references) works in the same places and means the same file. Absolute URLs (`https:`, `data:`), app-absolute paths (`/…`) and `@route/`, `@widget/` references are left untouched, so remote `https` images still work directly with no embedding, and a `navigate` marker's `href` still reads as a route.
- **Stylesheets**: a `<style>` block and a `<link rel="stylesheet" href="theme.css">` both work, and both work wherever you put them, before your markup or after it. A relative `href` resolves against your `.coilbox/` folder like any other asset, so the stylesheet's own relative `url()`s resolve beside it. They are the only two. A `<base>`, a `<meta>` or a `<script>` is removed wherever you write it, because a `<base href>` re-points every relative URL in Coilbox and a `<meta http-equiv="refresh">` navigates the app away from itself, neither of which is a thing your markup should be able to do to the page around it. Your markup never runs JavaScript, so a `<script>` would do nothing anyway.
- **In-app links**: because Coilbox uses hash routing, an `<a href="#/play/skirmish">` navigates inside the app without a reload. Useful routes include `#/play/skirmish`, `#/content/maps`, `#/play/replays`, `#/battles`, `#/settings` — the full list is in **[routes.md](routes.md)**.
- **Actions**: the welcome HTML can't run JavaScript, but any element carrying a `data-coilbox-action` attribute is wired to a built-in action when clicked — the interactive hook available without scripting.
  - `data-coilbox-action="quit"` closes Coilbox. Use it to add your own exit control to a branded landing page (handy for fullscreen builds). This works regardless of the [`quit`](#quit-boolean) flag.
  - `data-coilbox-action="navigate"` goes to an in-app route named in a `data-coilbox-route` attribute (or the element's `href`), using the same `@route/<path>` / `.md` / `/path` scheme as [custom pages](#pages-array) — so `@route/singleplayer` and `/downloads/games` both resolve to the same route a page link would. A route that doesn't resolve is ignored (no crash). This makes a "Play now" button possible on the welcome screen from any element, not just an `<a href="#/…">`. A `#/…` hash link is not one of those spellings and does not need to be: it navigates on its own, with or without the marker.

  The same markers work in the [`home`](#home-object) key's markup, and mean the same thing there.

  ```json
  {
    "html": "<button data-coilbox-action=\"quit\">Exit</button> <button data-coilbox-action=\"navigate\" data-coilbox-route=\"@route/singleplayer\">Play now</button>"
  }
  ```

The HTML is trusted (it ships inside your distribution): apart from rewriting relative asset URLs (above), it is injected as-is, so only put content you control in it.

### `onboarding` (string)

Where the first-run onboarding sits on the branded home. The onboarding is the "Set up Coilbox" card (offers to create a content folder / download an engine) plus the get-started card (curated game/map download suggestions). Both self-hide once setup is complete, the player has a game, and they have at least three maps.

Your `welcome` is **always** shown and is never replaced by the onboarding — this field only positions the cards relative to it:

- `"below"` (default) — under the welcome.
- `"above"` — over the welcome.
- `"off"` — hidden entirely, leaving the welcome as the whole home.

```json
{ "version": 1, "welcome": { "html": "…" }, "onboarding": "off" }
```

Without a `welcome`, the cards sit at the top of Coilbox's own home page above the tool grid: `"off"` hides them there too, and `"above"` and `"below"` have no welcome to position against, so both leave them where they are. An omitted or unrecognized value is treated as `"below"`.

Leaving `onboarding` out of a [`home.zones`](#home-object) list hides the cards as well, because omitting a zone hides it. See [Leaving out `onboarding`](#leaving-out-onboarding).

### `home` (object)

Rearranges Coilbox's own home page: which layout it uses, what it paints behind the page, and which zones it shows in what order.

Leave `home` out and you get the home page as Coilbox ships it. A distribution with no `home` key renders the same page as an unbranded install, byte for byte. That has been checked three times on this feature by comparing the rendered markup, not reasoned about, so it is safe to add the other profile fields without thinking about the home page at all.

`home` and [`welcome`](#welcome-object) are different tools:

- `welcome` replaces the home page with your own markup. Nothing of Coilbox's page is left.
- `home` keeps Coilbox's page, with its resume cards, tool grid and map suggestion, and lets you reorder it and slot your own markup into it.

A profile with both gets the welcome, and `home` is ignored: a page that has been replaced has no zones left to arrange. Wholesale replacement is still the escape hatch when you want the page entirely to yourself.

```json
{
  "version": 1,
  "home": {
    "layout": "stacked",
    "background": "@.coilbox/art/backdrop.jpg",
    "zones": [
      { "zone": "greeting", "title": "Ironhold", "tagline": "Hold the line." },
      { "zone": "continue" },
      { "zone": "cards", "art": { "runlite.list": "@.coilbox/art/warpath.png" } },
      { "html": "@.coilbox/home/community.html" }
    ]
  }
}
```

| Field        | Meaning                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| `layout`     | The named arrangement of the zones. Omit it to track the Coilbox default.                    |
| `background` | A [`@.coilbox/<path>` reference](#file-references) to a backdrop image, or `false` for none. |
| `zones`      | The page, in order. Omit it to track the Coilbox default.                                    |

#### The zones

Six zones make up the page. Each one is self-contained and draws nothing when it has nothing to say, so a page never has a hole in it.

| Zone id      | Draws                                                                                                                     | Draws nothing when                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `onboarding` | The "Set up Coilbox" card (content folder and engine) and the get-started download suggestions.                            | Setup is done, the player has a game and at least three maps, the player dismissed the card, or [`onboarding`](#onboarding-string) is `"off"`. |
| `greeting`   | The page heading and the line under it. Greets by lobby name once logged in.                                              | Never. An app always has a title, though the line under it depends on your other zones. See [What the greeting says depends on the rest of your list](#what-the-greeting-says-depends-on-the-rest-of-your-list). |
| `continue`   | One card for the thing you were last doing: a Warpath run, the next campaign mission, a conquest, a battle you can still rejoin, or your last skirmish setup. | There is nothing to resume, which includes every fresh install.                            |
| `resume`     | Up to three runners-up the `continue` card did not take, plus a "log in as" card when you are logged out with a saved login. | There are no runners-up.                                                                   |
| `cards`      | Every sidebar destination as a card, in the sidebar's own groups. A group's external links share one card at its end.      | The build has no navigation left outside Home.                                             |
| `suggested`  | One curated map to download that the player does not already have, chosen by date. Sits in the tool grid's Downloads group, or at the top of the page when the player has no maps at all and the `onboarding` zone is offering none. | The player already has every curated map, or the catalog offers none that can be installed and pictured. |

The ids in the first column are what you write in `zones`.

Each entry is an object naming one zone, plus whatever that zone takes:

| Entry key  | Applies to      | Meaning                                                                       |
| ---------- | --------------- | ----------------------------------------------------------------------------- |
| `zone`     | any entry       | The zone id from the table above.                                              |
| `html`     | an entry with no `zone` | Your own markup, as a block between zones. See [Markup around and between zones](#markup-around-and-between-zones). |
| `before`   | any entry       | Markup at the head of that entry.                                              |
| `after`    | any entry       | Markup at the foot of that entry.                                              |
| `title`    | `greeting`      | The heading, replacing the one Coilbox would have chosen.                      |
| `tagline`  | `greeting`      | The line under the heading.                                                    |
| `art`      | `cards`         | Per-tool card pictures. See [Card art for one tool](#card-art-for-one-tool).   |

A key written on an entry that does not take it is ignored, so `title` on `cards` does nothing, and `html` on an entry that names a `zone` does nothing either. Coilbox says which key and which entry, on the console and in the profile panel, and says it whatever the value is: the fix is to move the key, not to correct it.

#### The zone list

`zones` present means that list is the page, in that order:

```json
{
  "version": 1,
  "home": {
    "zones": [
      { "zone": "greeting" },
      { "zone": "cards" },
      { "zone": "onboarding" }
    ]
  }
}
```

Two rules follow from that, and they are the whole contract:

- Omitting a zone hides it. There is no separate on/off flag, and no way to say "everything except one". The example above shows three zones and hides `continue`, `resume` and `suggested`.
- A zone Coilbox adds later will not appear on your page. Writing `zones` pins the page to the zones you knew about. Leaving `zones` out tracks Coilbox and picks up whatever comes next.

That is the same pin-or-track trade `layout` makes, and you opt into it by writing the key. If all you want is one zone gone, you still have to write the other five out.

#### Leaving out `onboarding`

Leaving `onboarding` out of your `zones` list hides the "Set up Coilbox" and get-started cards, the same way leaving out any other zone hides it. Those cards are how a fresh install offers to create a content folder and download an engine, so a player on a machine with neither sees a home page that does not mention it.

Coilbox does not make an exception for this, and here is the reasoning so you can judge it:

- The player is still told. Singleplayer says "No engine found. Add a content folder with an engine in Settings > Content Folders first.", and Settings > Distribution profile reports the folders Coilbox can see. What omitting the zone costs is the offer on the home page, not the diagnosis.
- The state is reachable three other ways already: [`"onboarding": "off"`](#onboarding-string), the card's own Dismiss button, and a `welcome` that replaces the page. An exception here would close one door of four.
- "Omitting a zone hides it" is the one rule that makes the zone list explainable in a sentence. A zone that came back when Coilbox decided the install was unhealthy would make it "omitting a zone hides it, sometimes".

There is one thing that goes the other way. On an install with no maps at all, the `suggested` map card moves to the top of the page, ahead of the resume cards, because without a map nothing can be played. It only does that while the `onboarding` zone is offering no maps of its own, since the get-started card lists several with a packs banner under them and one page should not ask twice. Dropping `onboarding`, or setting it `"off"`, is one way to get the promoted card. So is a player who dismissed "Set up Coilbox" and has no engine, where the zone is on your page and drawing nothing.

The card gives that place up at the player's first map, and not at the three the get-started card counts to. The two numbers measure different things: the get-started card is asking whether the player has a library, and the top row is asking whether a map is worth more right now than the run they were in the middle of. Once they have a map there is something to come back to. The card carries on offering from the Downloads group either way, a map a day, so what ends at one map is where it sits and not what it offers.

So keep `onboarding` in your list unless you mean to remove the offer, and use `"onboarding": "off"` when you do, since that says what you meant and works whether or not you write `zones`.

#### What the greeting says depends on the rest of your list

The greeting is the one zone that talks about the others, so leaving a zone out changes the line under the heading:

| Your list has                     | The line under the heading                                                 |
| --------------------------------- | -------------------------------------------------------------------------- |
| `continue` or `resume`, with something waiting | "Pick up where you left off."                                   |
| `cards`                           | "Choose a tool to get started.", or "No tools available yet." if the grid draws no card |
| none of those three               | Nothing. The heading stands on its own.                                    |

Every one of those sentences is about a zone. Left on a page that does not carry it, each points at something the player cannot see: a resume that is not offered, or a grid you chose not to show described as an install with no tools in it. So Coilbox drops the sentence rather than the zone.

Write `tagline` when you want a line there anyway. It replaces whatever Coilbox would have said, on any page, including one with none of those zones.

#### Markup around and between zones

Every entry takes `before` and `after` markup, and an entry with `html` instead of `zone` is a block of your own markup sitting between zones. Together they cover a sentence at the head of a zone and a community feed at the foot of the page.

```json
{
  "version": 1,
  "home": {
    "zones": [
      { "zone": "greeting", "before": "<p class=\"kicker\">Ironhold Command</p>" },
      { "zone": "cards", "after": "@.coilbox/home/roster.html" },
      { "html": "@.coilbox/home/community.html" }
    ]
  }
}
```

- Inline markup and file references are interchangeable, in all three keys. A value starting with `@` is a [file reference](#file-references), anything else is markup. Keep a one-line intro in `profile.json` and a long block in its own file.
- Markup renders whether or not the zone beside it drew anything. A `before` on `continue` still shows on a fresh install with nothing to resume. Tying it to the zone would make it mean "sometimes", and would leave no way at all to say "always". So write markup that reads correctly next to an empty zone.
- The markup goes through the same trusted path as [`welcome.html`](#welcome-object): relative asset URLs resolve against your `.coilbox/` folder, `<style>` blocks are rewritten the same way, `data-coilbox-action` markers work, and there is no JavaScript.
- Coilbox puts your markup in a `div.coilbox-home-markup` and styles it in no other way. A custom `html` entry gets no margin at all, because the layout has no idea whether the block is a hairline or a feed. Bring your own spacing.
- `before` and `after` work on a custom entry too, and are worth reaching for when its `html` is a file: `{ "html": "@.coilbox/home/feed.html", "before": "<p>From the forum</p>" }` keeps the sentence in `profile.json` next to the reference, and leaves the file to whatever generates it.
- A reference that cannot be read renders a visible error in place, rather than blanking.

One layout consequence worth knowing. Coilbox normally puts the `continue` card and the `resume` rail on one row, and folds the `suggested` map card into the tool grid's Downloads group. An entry carrying `before` or `after` markup stops pairing, so those two zones stack separately instead. Put your markup on a neighbouring entry, or on a custom `html` entry, if you want the pairing kept.

The `suggested` card is promoted into that same row for a player with no maps at all whom onboarding is offering none, so markup stops that too: markup on `continue` or `resume` leaves no row to promote into, and markup on `suggested` keeps the card next to the words you wrote about it.

#### Card art for one tool

The `cards` entry takes an `art` map from tool id to a picture:

```json
{
  "zone": "cards",
  "art": {
    "runlite.list": "@.coilbox/art/warpath.png",
    "play.replays": false
  }
}
```

- A [file reference](#file-references) wins that card outright. Only `@.coilbox/` names a file, so a bare `art/warpath.png` is rejected.
- `false` gives the icon-only card, an icon beside a label with no picture.
- A tool you do not list is untouched and walks the rest of the resolution chain: art from the player's own install (a last-played minimap, a campaign panorama, a game's loading art), then a bundled illustration, then a pattern generated from the tool id and your accent colour. The last of those always succeeds, so no card is ever blank and you never have to fill the map in.

Tool ids are the nav ids in [routes.md](routes.md), the same ids [`hide`](#hide-string) uses. Warpath is `runlite.list` and Singleplayer is `play.skirmish`, so check the table rather than guessing from the label.

Any image is safe to put under a card: the label sits in a band measured to stay legible over a pure black picture and a pure white one, in both colour schemes.

> Today `art` can only be written on a `zones` entry, so changing one tool's
> picture means writing the whole page out and pinning it. That cost is filed as
> [#1071](https://github.com/tomjn/coilbox/issues/1071).

#### The backdrop

`background` paints one image behind every zone:

```json
{ "version": 1, "home": { "background": "@.coilbox/art/backdrop.jpg" } }
```

It is a mood layer rather than a hero image. Coilbox composites it over the theme background at 5% strength, which is the strongest setting where the worst possible image still leaves every piece of text on the page readable. If you want art at full strength, use [`welcome`](#welcome-object), which replaces the page and lets your own CSS decide.

`false` removes the backdrop entirely and leaves the flat theme background. Omitting it gives a soft wash built from your own `--primary` and `--foreground`, so a distribution that only sets [`accent`](#accent-string) already gets a backdrop in its colours.

Coilbox checks the file is there at startup. If it is not, you get the default wash and a line in the profile panel, rather than the flat background a typo used to give you, which was indistinguishable from writing `false`.

The backdrop applies to Coilbox's page only. A profile with a `welcome` is on the other arm and paints its own background in `welcome.css`.

#### Pinning a layout

`layout` names the arrangement of the zones. Coilbox ships one, `stacked`, which is a single column down the page.

```json
{ "version": 1, "home": { "layout": "stacked" } }
```

Naming it pins it. If a later Coilbox redesigns the home page, it ships as a new layout plus a change of default, and a distribution that pinned `stacked` keeps the screen it was built against. Leaving `layout` out tracks the default and moves with it. Neither is the right answer for everyone, which is why the name exists.

#### When a `home` key is wrong

You write this JSON by hand and nothing checks it before you ship. So a mistake never blanks the page: every bad value falls back to what Coilbox would have done, and says what it dropped and why on the webview console.

A release build does not expose that console, so the same list is in the app: Settings > Distribution profile, "Validate profile". The `home` row names every entry it dropped and every `@.coilbox/` file it could not read, in the words the console got. The summary above it says which layout drew the page, how many zones it drew, and whether that was your list or the tracking default, so a zone list that was thrown away for being empty or all-bad shows as a zone count you did not write.

| You wrote                                          | You get                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `home` as a string, number, boolean or array        | The stock page.                                              |
| `layout` that is not a string, or a name this build does not ship | The default layout, and a list of the names it does ship. |
| `zones` that is not an array, or is empty           | The stock page. An empty page is indistinguishable from a crash. |
| A zone entry that is not an object                  | That entry dropped, the rest of the list kept.               |
| An unknown zone name                                | That entry dropped, named in the warning.                    |
| The same zone twice                                 | The first kept, the second dropped.                          |
| An entry with neither `zone` nor `html`             | That entry dropped.                                          |
| Every entry bad                                     | The stock page.                                              |
| `title`, `tagline`, `before` or `after` that is not a string | That key ignored, the entry drawn as Coilbox would draw it. |
| A key on an entry that does not take it, such as `title` on `cards` or `html` beside a `zone` | Nothing, and a line saying so rather than one about its value. A `@.coilbox/` file it names is not read either. |
| `art` that is not an object                         | The whole map ignored, every card walks the chain.           |
| An `art` value that is neither a `@.coilbox/` reference nor `false` | That tool dropped from the map and walking the chain, the rest of the map kept. |
| `background` that is neither a `@.coilbox/` reference nor `false` | The default wash.                                |
| A `@.coilbox/` file that is not there               | A visible error block for markup, a card that falls back to the icon for art, and the default wash for the backdrop. |

The rule behind the table is that one mistake costs the thing it was written for and nothing else.

Every row of the table reaches the profile panel. How loudly a mistake shows on the page itself varies with what it cost you: markup you wrote to be read gets an error block where it should have been, while a backdrop that is decoration at 5% strength gets the default wash and says the rest in the panel.

#### A worked example

A complete distribution using all of this lives in [`docs/examples/branded-home`](https://github.com/tomjn/coilbox/tree/main/docs/examples/branded-home). Copy its `.coilbox` folder next to the Coilbox executable and start the app.

```
branded-home/
  .coilbox/
    profile.json
    home/
      community.html     # the custom zone at the foot of the page
    art/
      backdrop.svg       # the page backdrop
      warpath.svg        # the Warpath card's picture
```

```json
{
  "version": 1,
  "title": "Ironhold",
  "mode": "dark",
  "accent": "amber",
  "background": "hsl(28 18% 7%)",
  "home": {
    "layout": "stacked",
    "background": "@.coilbox/art/backdrop.svg",
    "zones": [
      { "zone": "onboarding" },
      {
        "zone": "greeting",
        "title": "Ironhold",
        "tagline": "Hold the line.",
        "before": "<p style=\"margin:0;font-size:0.75rem;letter-spacing:0.12em;text-transform:uppercase;opacity:0.65\">Ironhold Command</p>"
      },
      { "zone": "continue" },
      { "zone": "resume" },
      {
        "zone": "cards",
        "art": {
          "runlite.list": "@.coilbox/art/warpath.svg",
          "play.replays": false
        }
      },
      { "zone": "suggested" },
      { "html": "@.coilbox/home/community.html" }
    ]
  },
  "links": [
    {
      "label": "Discord",
      "href": "https://discord.gg/example",
      "icon": "discord"
    }
  ]
}
```

What each part of it is doing:

- The zone list is Coilbox's own order with a custom block added at the end, so nothing is hidden. Move `onboarding` down the list, or drop a zone, and the page follows.
- `greeting` takes its own heading and line, and carries an inline `before` for the kicker above it.
- `cards` gives Warpath its own picture and takes Replays back to the icon-only card. Every other tool is left to the resolution chain.
- The `html` entry is a file reference, so the community block is a real HTML file you can edit without touching the JSON. It carries its own `<style>` block, an `<img src="art/warpath.svg">` that resolves against `.coilbox/`, and a `data-coilbox-action="navigate"` button that goes to `@route/warpath`.
- `continue`, `resume`, `cards` and `suggested` are bare, so Coilbox keeps its pairings: the resume row is one row, and the map card sits in the Downloads group.

`src/home/homeDocs.test.ts` resolves this exact file, and every JSON sample above, through the real schema on every test run. If the contract changes under them, the tests fail rather than the documentation quietly going stale.

### `links` (object[])

Adds external links to the sidebar **and** the home launcher — e.g. a Discord invite or a wiki. Each entry:

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

Malformed entries (missing `label` / `href`, or an href scheme the browser opener won't open) are skipped; the rest still load.

**Icon names:** `discord`, `forum` / `forums`, `chat` / `message`, `globe` / `website` / `web`, `docs` / `book` / `wiki`, `news` / `blog`, `rss` / `feed`, `heart` / `donate`, `support` / `help`, `users` / `community`, `mail` / `email` / `contact`, `link`, `game` / `play`, `calendar` / `events`, `star`, `info`, `hash` / `channel`, `bell` / `updates`, `trophy`. Anything else falls back to a generic external-link icon. (lucide ships no brand marks, so `discord` uses a generic chat glyph.)

### `lobby` (object)

Controls the multiplayer **lobby-server** presets a distribution ships: a preferred "official" server, which stock presets appear, and the chat channels a player joins on login. It narrows and brands the Settings > Lobby servers list without ever locking the player out — they can still add their own servers and remove their own logins.

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

Or just promote and brand an existing built-in as official while keeping one other preset available:

```json
{
  "version": 1,
  "lobby": { "official": "recoil-official", "presets": ["bar"] }
}
```

Built-in ids: `recoil-official`, `spring-official`, `techa`, `bar`, `bar-ssl`. An unknown `official` id (or an inline object with no `host`) is ignored — the rest of the block still applies.

### `splash` (object)

Shows a brand splash over the whole window at startup: a centered image that fades in on a solid background, holds, then fades out. Plays on every launch; the user can turn it off (Settings > General > Display > "Startup splash") and can dismiss it early by clicking it or pressing Escape.

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

- `image` — the centered image. Either a path **relative to the `.coilbox/` folder** (read locally, so it works offline — put e.g. `logo.webp` next to `profile.json`), or an inline `data:` / `https:` URL used as-is. Paths can't escape `.coilbox/` (no `..` or absolute paths).
- `background` (optional) — solid backdrop CSS colour. Defaults to the profile's top-level [`background`](#background-string) if set, else the theme background.
- `duration` (optional) — total time in ms (fade in + hold + fade out). Defaults to `3000`.

Honours `prefers-reduced-motion` (skips the fades). If the image can't be loaded the splash is silently skipped — it never blocks startup.

### `background` (string)

A solid CSS colour painted behind everything from the first frame until the app has rendered. A dark distribution otherwise briefly flashes the default white page while it loads; setting this paints your colour instead. It's also the splash's default backdrop, so one colour covers the boot screen and the splash seamlessly.

```json
{ "version": 1, "mode": "dark", "background": "hsl(240 6% 7%)" }
```

The colour is cached so it applies before the first paint on subsequent launches (the very first launch of a fresh install still shows one brief flash). A vanilla install (no profile) is unaffected.

### `theme` (object)

Fine-grained override of Coilbox's colour tokens app-wide, for anything the named `accent` doesn't cover. Each key is a CSS custom property; each value is an HSL triple (`H S% L%`, no `hsl()` wrapper). These re-point picoframe's design tokens, so the whole shell recolours. For a simple brand accent, prefer `accent` above.

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

Common tokens: `--primary`, `--primary-foreground`, `--ring`, `--accent`, `--sidebar-primary`, `--background`, `--foreground`, `--border`. See `node_modules/@picoframe/frame/src/theme.css` for the full list and the light/dark defaults.

> Coilbox also ships built-in named [`accent`](#accent-string)s (neutral, blue,
> green, rose, orange, … — the full axis) selectable under Settings > Appearance.
> A `theme` override takes precedence over the user's accent choice.

### `release` (object)

Points Coilbox at a GitHub repository whose **releases** ship the game's archive (`.sdz` / `.sd7`) — for games distributed outside the rapid ecosystem (e.g. straight from GitHub). On launch Coilbox checks the repo's latest release; if none of that release's archives are already installed, a **Game updates** settings section and a topbar badge offer a one-click download that installs the archive and rescans content.

```json
{ "version": 1, "release": { "repo": "your-org/your-game" } }
```

- `repo` — the GitHub repository as `"owner/name"`.

"Latest" is whatever GitHub marks as the latest release. If that release also carries an asset named exactly `profile.json`, Coilbox installs it into `.coilbox/` alongside the game archive; because the profile is read once at startup, the app then prompts for a restart to apply the updated profile.

### `updater` (boolean)

Turns off Coilbox's check for new releases of **itself**. On by default. Set it to `false` when you ship and update the Coilbox binary yourself, so your players are never offered an upstream build you didn't test with your game.

```json
{ "version": 1, "updater": false }
```

With the updater off there's no check at launch, so no "Update available" pill in the top bar and no update toast. Settings > Updates still shows the running version (useful when a player reports a bug) but drops the check and install buttons. To remove that section from the settings nav as well, add `"hideSettings": ["updates"]`.

This is separate from [`release`](#release-object): your own game archive keeps updating from your repo either way.

### `hub` (boolean)

Turns off the Coilbox hub. On by default. Set it to `false` if you're shipping a modded game to your own community and don't want a button pointing players at a public gallery of other people's content.

```json
{ "version": 1, "hub": false }
```

Between off and everything there's [`gameFilter`](#gamefilter-object). A profile that sets one pins the hub to that game: the browse screen lists only items for it, plus items not tied to any game at all (some kinds carry no game name, and one that works anywhere works here too). The screen says which game it's pinned to, so a short list doesn't read as an empty hub, and it drops its own game filter box rather than offering a choice that's already been made.

The pin is applied to what the hub sends back, not asked for as a query, because the hub stores a game as a versioned name like `SplinterFaction 0.1.78` and a name pinned in a profile would go stale at the next release. That means a pinned Coilbox reads the hub's pages itself and counts what's left, so the item count and the page buttons are about the list on screen. It reads at most 20 pages and says so if there were more.

A `coilbox://` link can still point at an item for another game. Coilbox shows that item's page and still imports it, saying which game it's for: the pin narrows what Coilbox advertises, it isn't a permission check on a link somebody was handed deliberately.

### `hubUrl` (string)

Points the Coilbox hub at a server you run yourself, instead of the built-in `https://coilbox-hub.vercel.app`. Separate from [`hub`](#hub-boolean), which only turns the feature on or off.

```json
{ "version": 1, "hubUrl": "https://hub.example.com" }
```

A player can still override this with a setting of their own. This only changes the default they start from.

### `authoring` (boolean)

Removes the [profile authoring tools](#writing-and-iterating-on-a-profile) from Settings > Distribution profile. On by default. Set it to `false` in the profile you ship, so a player can't reload or replace your branding by accident.

```json
{ "version": 1, "authoring": false }
```

The rest of the section stays: a player reporting a problem can still see what the profile is changing, and still run the validation checks. Only the Reload and Create buttons go.

### `mapLists` (object[])

Curated **map packs** offered for bulk download on the Maps download page — a tournament set, a galactic-conquest galaxy, "space maps", etc. Each pack has an `id`, a `title`, an optional `blurb`, and a `maps[]` array; **Download all** queues every not-yet-present map in the pack through the normal download queue.

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

Each map's `download` is `{ "kind": "map", "springName", "searchUrl"? }` (fetched by springname via pr-downloader) or `{ "kind": "url", "url", "filename", "subdir"? }` (a direct mirror file); `filename` enables "already downloaded" detection. This is the same shape and mechanism the branding catalog's `suggested.mapLists` uses — see [Branding catalog](../README.md#branding-catalog); catalog packs are listed first, then a profile's, deduped by `id`.

A map may also carry `blurb`, a line of description, and `thumb`, an array of image URLs of which the first that loads wins. Neither is needed for the pack itself, which shows no pictures. Both are what the home page's suggested map card shows on the day it picks that map. A map with no `blurb` gets a stock line. A map with no `thumb` is never suggested at all: the card is a picture of one named map, and there is no honest substitute to draw, so the day's pick moves on to the next map that has one.

### `excludedMaps` (object[])

Keeps maps out of warpath and galactic conquest, the two modes that pick maps on the player's behalf. Adds to the branding catalog's own list rather than replacing it, so a distribution can exclude more maps than the catalog does and never fewer.

```json
{
  "version": 1,
  "excludedMaps": [
    {
      "id": "house-rules-banned",
      "match": { "names": ["Duck", "Comet Catcher Redux"] },
      "reason": "Not part of the league map pool."
    }
  ]
}
```

`match` is tested against the installed map's spring name: `regex` is case-insensitive, `names` are case-insensitive exact matches and win over `regex` within a rule. Prefer `regex` when you mean a family of maps, since a map's version is part of its spring name. `reason` is shown to the player on the map's detail page.

An excluded map stays visible in Content and stays playable in skirmish and multiplayer. A player can opt further maps out themselves on the map detail page, but cannot re-enable one your profile or the catalog excluded. Same shape as the branding catalog's `excludedMaps`, documented in [Branding catalog](branding-catalog.md#excluding-maps-from-warpath-and-conquest).

### `quit` (boolean)

Adds a **Quit** button to the bottom of the sidebar that closes Coilbox. Off by default. It's an escape hatch for fullscreen or kiosk (`fullscreenLocked`) builds, where a player may otherwise have no obvious way out — so unlike the fullscreen toggle, this button is **not** removed by the kiosk lock.

```json
{ "version": 1, "fullscreen": true, "quit": true }
```

For a fully branded exit instead of (or in addition to) the sidebar button, put a `data-coilbox-action="quit"` element in your [`welcome`](#welcome-object) HTML.

### `layout` (object)

Controls the app-frame chrome — the sidebar mode, the breadcrumb, the top-bar history/fullscreen buttons, the menu-button branding, and top-bar logos. These are **locks** (authoritative every launch, like `title`/`hide`, with no user toggle) except `sidebarCollapsed`, which is a **seed**. Omit `layout` and the chrome behaves as normal.

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

**`menu` (popover menu-button branding).** When the sidebar is in popover mode (`popover: true`) a menu button in the top bar opens it; this rebrands that button. It is **only visible in popover mode**.

| Field          | Type    | Meaning                                                                         |
| -------------- | ------- | ------------------------------------------------------------------------------- |
| `label`        | string  | The button's accessible name and tooltip.                                       |
| `labelVisible` | boolean | Show the label/logo beside the icon. Defaults to `true` when `label` or `image` is set; set `false` for an icon-only button that still has your `label` as its tooltip. |
| `icon`         | string  | Icon name (same list as [`links`](#links-object)) for the closed state.         |
| `iconOpen`     | string  | Icon name for the open state.                                                   |
| `image`        | string  | A logo shown in place of the label text. Same source rules as [`splash.image`](#splash-object) (`.coilbox`-relative path, or inline `data:`/`https:`). Wins over `label` as the visible content; `label` stays the accessible name. |

**`left` / `center` / `right` (top-bar logos).** Each places a logo or text in that top-bar slot. Same shape:

| Field   | Type   | Meaning                                                                          |
| ------- | ------ | -------------------------------------------------------------------------------- |
| `text`  | string | Text shown when no image resolves.                                               |
| `image` | string | Logo image. Same source rules as [`splash.image`](#splash-object). **Wins over `text`** when it resolves; falls back to `text` if it can't be loaded. |
| `href`  | string | Makes the logo a link opened in the system browser (`http(s)`/`mailto`/`tel`; other schemes are ignored). |

### `ai` (object)

Overrides the [branding catalog](branding-catalog.md#ai-rankings)'s per-game AI block: which AIs are hardest, which is standard, which must never play, which are mini-games, and which garrison a neutral conquest world.

```json
"ai": {
  "ranking": ["BARb", "CircuitAI", "AAI", "SimpleAI"],
  "standard": "AAI",
  "never": ["Sandbox", "NullAI"],
  "minigame": ["ChickensAI", "ScavengersAI"],
  "neutral": ["ChickensAI"]
}
```

See the [catalog documentation](branding-catalog.md#ai-rankings) for what each field does. The merge is per field: a field set here wins, a field left out falls through to the catalog entry, and anything neither sets falls back to the built-in defaults. An empty array counts as absent, so an override cannot blank a field.

Use this when you package a build and want your own difficulty curve, for example to hide a bot your players should never face, or to name the AI your tutorial expects.

### `conquest` (object)

Supplies system/faction names — and whole lore factions — for **[Galactic Conquest](conquest.md)** galaxies generated in this distribution, so they read as your game rather than generic space. Every field is optional and overrides the branding catalog's per-game defaults.

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

- `starNames` / `starPrefixes` / `starSuffixes` — full system names (used first), then syllables synthesized names are built from.
- `factionNames` — full faction names, used when no `factions` presets are given.
- `factions` — lore factions assigned in order (the player first); each is `{ name, color?, side?, aggression? }`.

See the [Names and factions](conquest.md#names-and-factions) section for how the pools are drawn and the full merge order (profile over catalog over built-ins).
