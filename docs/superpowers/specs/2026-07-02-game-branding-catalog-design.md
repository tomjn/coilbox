# Game branding catalog

## Problem

Coilbox brands game detail pages by repurposing the game's own loading-screen art (`game-header-loadpicture`). That art is decaying as a signal:

- Many games moved to **LuaIntro**, a Lua-rendered loading screen, and no longer ship a static `loadpicture` for coilbox to lift.
- Older games ship **outdated** loading art, or `modinfo.lua` metadata that points at **websites that no longer exist**.

We can never add assets to already-shipped game archives. So we want an **external, community-maintainable catalog** that coilbox references to supply branding (banners, logos, screenshots) and backfill metadata (homepage/repo links, video links) for games, matched by their identity. No server and no CMS: a static `catalog.json` on GitHub plus curated asset URLs.

Maps are **out of scope** - their minimap already serves as branding, as noted in `game-header-loadpicture`.

## Goals / non-goals

Goals:

- A static JSON catalog on GitHub, fetched at runtime, that maps a game identity to branding assets and links.
- Catalog-supplied banner/logo **override** the archive's loading art when an entry matches ("catalog wins").
- Backfill links (website, repo, Discord) for games whose `modinfo` references are dead, plus optional screenshots and video links.
- Robust fallbacks: multiple URLs per asset, disk-cached catalog, bundled seed for offline/first-run.

Non-goals:

- No server, CMS, or write path from the app. Contributions are GitHub PRs.
- No map branding (minimaps already cover it).
- No embedded/inline video playback. Videos and external links open in the system browser.
- No relaxing of the app CSP to allow arbitrary remote `<img>` hosts (see CSP).

## Matching: narrow, per-project, verified

Distinct projects that share ancestry (Balanced Annihilation -> Beyond All Reason (a.k.a. BAR), Splinter Faction, ...) are **separate projects**. Matching MUST be narrow and per-project; a broad ancestral regex that swept siblings together would misbrand them and cause offence. Each catalog entry owns a tight matcher for exactly one project.

Each entry carries a `match` object tested against the installed game's identity (`game.name`, with `game.info.shortname` as a secondary target):

```jsonc
"match": {
  "regex": "^Splinter Faction",        // case-insensitive, tested against game.name
  "names": ["Splinter Faction 1.2.3"]  // optional exact game.name / shortname pins
}
```

Resolution rules:

- Entries are evaluated **top-to-bottom**; the **first** entry that matches wins.
- `names` (exact, case-insensitive equality against `game.name` or `game.info.shortname`) take precedence over `regex` within an entry.
- `regex` is compiled in a `try/catch` at catalog load; an invalid pattern **skips that entry** rather than breaking the whole catalog.
- Regex-DoS is a non-concern: the catalog is curated and each pattern runs against only the handful of installed game names.
- The matched entry id is logged per game (`branding: game "<name>" -> entry "<id>"`) so catalog authors can debug why a game did or didn't match.

Authoring note: every `regex`/`names` value must be verified against the **real** installed `game.name` for that project (which usually embeds a version) before it lands in the catalog. Narrow beats clever.

## Catalog schema

```jsonc
{
  "version": 1,
  "updated": "2026-07-02",
  "entries": [
    {
      "id": "splinter-faction",
      "match": { "regex": "^Splinter Faction" },
      "title": "Splinter Faction",
      "banner":  ["https://img.itch.zone/aW1nLzIxNjg5NTc3LnBuZw==/original/W1YpP9.png"],
      "logo":    ["https://splinterfaction.info/images/logo.webp"],
      "screenshots": [
        { "urls": ["https://img.itch.zone/aW1nLzIxNjg5NTc3LnBuZw==/original/W1YpP9.png"],
          "caption": "Splinter Faction" }
      ],
      "videos": [
        { "kind": "youtube", "id": "xxxxxxxxxxx", "title": "Trailer" },
        { "kind": "link", "url": "https://example.com/clip.mp4", "title": "Gameplay" }
      ],
      "links": [
        { "label": "Website", "url": "https://splinterfaction.info/" },
        { "label": "itch.io", "url": "https://frozenyak.itch.io/splinterfaction" }
      ]
    }
  ]
}
```

Field semantics:

- Everything except `id` and `match` is **optional**. An entry may be pure link-backfill (only `links`) for a dead-site game with no art.
- `banner`, `logo`, and each screenshot's `urls` are **ordered URL fallback arrays**: candidates tried in order until one fetches successfully.
- `videos[].kind`: `"youtube"` (open `https://youtu.be/<id>`) or `"link"` (open `url`). Both open externally; never embedded.
- `title` overrides the display name in branded UI when present (the game's own `game.name` remains the source of truth for matching and elsewhere).

## Hosting and maintenance

- `catalog.json` lives at `branding/catalog.json` in the **main coilbox repo**.
- The app fetches it at **runtime** from the `main`-branch raw URL, so catalog edits ship independently of app releases (no version bump, no rebuild).
- A copy is **bundled** in the app as a seed for first-run / offline use.
- The raw URL is a configurable setting (default = coilbox's), mirroring `DownloadsConfig.rapidRepos`, so it can be overridden or pointed at a fork.
- Splitting the catalog into a dedicated `coilbox-branding` repo is a future option if community contribution volume justifies separate PR governance; the runtime fetch + configurable URL make that a one-line change later.

Asset URLs are **absolute and may point anywhere** (other GitHub repos, project sites, itch.io, CDNs). The catalog only stores URLs; it hosts no binaries itself.

## Architecture

Two Rust commands (remote fetch + durable cache, following the `game-header-loadpicture` worker-cache precedent) and a frontend branding layer that resolves entries and overrides the existing art hook.

```
GitHub raw catalog.json ──fetch──▶ disk cache ──▶ bundled seed (offline)
                                        │
                          useBrandingCatalog() -> matcher
                                        │
                     resolveBranding(game) -> BrandingEntry | null
                                        │
        ┌───────────────────────────────┼──────────────────────────────┐
   banner / logo URLs             screenshots / videos                links[]
        │                              │                                │
  brandingImage(urls[])   thumbnails via brandingImage;    buttons -> shell.open
  (Rust: try each URL,     videos/links -> shell.open
   cache to disk, -> data URL)
        │
  GameHeader / GameCard / GameArt  (catalog banner/logo win over unitsync art)
```

### Rust: catalog fetch + cache (new command)

`branding_catalog({ url, force? }) -> BrandingCatalogResult { json: string, source: "network" | "cache" | "seed", errors: string[] }`

- Fetches `url` with the app's existing HTTP mechanism (consistent with the downloads/replay remote fetches). On 200, writes the body to `app_cache_dir/coilbox-branding/catalog.json` and returns it (`source: "network"`).
- On network failure, returns the disk-cached copy (`source: "cache"`) if present, else the bundled seed (`source: "seed"`). `errors` records why the fetch fell back. The catalog fetch **never hard-fails** - branding degrades to whatever art the game already had.
- A short TTL / ETag check avoids refetching on every launch (mirror the downloads plugin's in-memory session cache; disk copy is the durable layer).

Doing the JSON fetch in Rust (not `fetch()` in the webview) keeps the network->cache->seed fallback in one place and avoids any CSP/scope concern for the JSON request.

### Rust: image proxy + disk cache (new command)

`branding_image({ urls: string[] }) -> BrandingImageResult { dataUrl?: string, errors: string[] }`

This is the **only** path remote images take, and it exists to (a) defeat CSP and (b) fetch each image **exactly once**.

- Cache dir: `app_cache_dir/coilbox-branding-images/` (sibling of the catalog cache, mirroring the `coilbox-unitsync-headers` layout).
- Cache key: a hash of the **URL string** (e.g. hex sha256), stored as `<hash>.dataurl` holding the resolved `data:` URL verbatim (preserves the real MIME type, same rationale as the header cache). A `<hash>.none` negative marker records a URL that failed so it is not retried every render.
- Flow: for each URL in order - **positive hit** returns the cached data URL with no network; **negative hit** on that URL moves to the next candidate; **miss** fetches, and on a successful image response writes `<hash>.dataurl` and returns it. If every candidate fails, return `{ dataUrl: None }` (UI falls back to the game's own art / gradient).
- Cache key is the URL, not the game, so the same asset shared across entries is stored once, and a changed catalog URL naturally misses and refetches.
- Eviction is **deferred** (unbounded, matching the existing header/thumb caches); the set is small (a few assets per branded game).

CSP: because images are returned as `data:` URLs, `img-src` needs `data:` (already required by the existing header hero) and **not** a per-host allowlist - the whole point of proxying is that catalog URLs can point anywhere without CSP edits.

ACL: both new commands need their entries in the owning plugin's `build.rs` `COMMANDS` list and `allow-branding-catalog` / `allow-branding-image` lines in `permissions/default.toml`, or they are blocked at runtime.

### Frontend: catalog hook + branding resolution

- Bindings `brandingCatalog`, `brandingImage`, and the `BrandingEntry` / `BrandingCatalog` / result types in `src/content/bindings.ts`.
- `useBrandingCatalog()` in `src/content/config.ts`: fetches once per session (module-level cache over `branding_catalog`), parses the JSON, precompiles each entry's regex (skipping invalid ones), and exposes `resolveBranding(game): BrandingEntry | null` applying the matching rules above.
- `useBrandingImage(urls?: string[])`: module-level `Map<urlsKey, BrandingImageResult>` session cache over `branding_image`; no-ops when `urls` is empty/undefined. This is where the two-tier cache (Rust disk + session `Map`) matches the header hook pattern.

### Frontend: rendering integration

- **Banner** - in `GameArt`/`GameHeader`, when `resolveBranding(game)` yields an entry with `banner`, resolve it via `useBrandingImage(entry.banner)` and prefer that data URL over the `useGameHeaderImage` (unitsync) result. Catalog wins; the loadpicture result is the fallback when no entry/banner matches. Placeholder gradient remains the final fallback, so no game regresses to a blank hero.
- **Logo** - `GameCard` (and optionally the header title area) uses `entry.logo` via the same hook.
- **Links** - `GameDetailPage` renders `entry.links` as a compact row of buttons (picoframe `Button`) that `shell.open` their URLs. This is the dead-`modinfo`-site backfill.
- **Screenshots** - a small `BrandingScreenshots` strip (thumbnails via `useBrandingImage` per screenshot) with a click-to-open lightbox, rendered in `GameDetailPage` when `entry.screenshots` is present.
- **Videos** - thumbnail/button per `entry.videos` item that `shell.open`s the YouTube/direct URL. No embedding.

## Precedence (art resolution, updated)

```
catalog banner (entry matched + banner resolves)   <- new, wins
  -> loadpicture (unitsync game header)
  -> bitmaps/loadpictures/* (unitsync fallback)
  -> gradient placeholder
```

## Privacy / security note

Proxying arbitrary catalog URLs means the app makes requests to third-party hosts, revealing the user's IP to those hosts. Mitigations: the catalog is curated by maintainers, and `branding_image` should accept **https URLs only**. This is a one-line caveat for the report, not a blocker.

## Phasing

- **P1 (core value):** schema + `branding_catalog` + `branding_image` + ACL + `useBrandingCatalog`/`useBrandingImage` + banner/logo wired in (catalog wins) + bundled seed catalog containing Splinter Faction (and 2-4 other actively branded games). Verifies the whole fetch -> match -> proxy -> cache -> render path.
- **P2:** `links` row + `videos` (open external) in `GameDetailPage`.
- **P3:** `screenshots` strip + lightbox.

P2/P3 are schema-compatible additions requiring no changes to P1 infrastructure.

## Success criteria

- A game matching a catalog entry shows the catalog **banner** in the hero, overriding any loadpicture art; a non-matching game still shows its loadpicture / gradient (no regression).
- Splinter Faction (seed entry) shows its itch.io banner and `splinterfaction.info` logo, and a Website + itch.io link row.
- Each remote image is fetched from the network **once**: a relaunch renders from `coilbox-branding-images/<hash>.dataurl` with no network request; a failed URL is recorded (`.none`) and the next fallback URL is used.
- With no network on first run, the **bundled seed** catalog still brands its games; with a prior successful fetch, the **disk-cached** catalog is used.
- An entry with an invalid regex is skipped without breaking other entries.
- Distinct sibling projects are **not** cross-branded (verified: an installed Balanced Annihilation is not branded by the Splinter Faction entry).
- Lint/type/build green with the same commands CI runs: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `bunx biome ci .`, `bun run typecheck`.
- Verified live via `bun tauri dev` + Tauri MCP screenshots: a catalog-branded game hero, its links row, and a relaunch hitting the image cache.
