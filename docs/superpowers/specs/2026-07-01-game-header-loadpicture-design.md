# Game detail header image (loadpicture hero banner)

## Problem

The Game detail page (`src/content/pages/GameDetailPage.tsx`) is a plain text
header: name, version, description, a metadata table. Games ship loading-screen
art in their archive that the engine uses as loading backgrounds, but coilbox
shows none of it. We want a Steam-library-style hero banner at the top of the
page for visual identity, reusing that loading art since dedicated per-game
branding doesn't exist. The resolved image should be cached durably so it is
instant to load and reusable elsewhere (e.g. a games-grid hero, the launcher).

## Sources of art (in priority order)

Spring/Recoil games expose loading art two ways:

1. **`modinfo.lua` `loadpicture` field** - a single designated image, surfaced as
   `game.info.loadpicture` (a slash-separated path within the primary archive).
   The game author's deliberate choice, so it is used **first**.
2. **`bitmaps/loadpictures/` folder** - a directory of images the engine samples
   at random on load. Used as a **fallback** when `loadpicture` is unset or fails.

If neither yields a usable image, the banner shows a generated colored gradient
(see Rendering) so **every game has a hero** - there is no art-less code path that
regresses to the old plain header.

## Baseline

Build on `origin/main` (`e61f759` "feat(content): add Play button to game
detail"), which added a **Play** button to the header title row. This worktree is
on a detached HEAD one merge behind, so the implementation branch must be based on
`origin/main` to include that button.

## Architecture

Two layers: a new Rust command that resolves + persistently caches the image, and
a frontend `GameHeader` component that renders the hero.

### Rust: resolve + disk cache (worker-owned, new command)

New command `unitsync_game_header` in `tauri-plugin-coilbox-unitsync`, backed by a
new `game_header` resolver in `coilbox-unitsync-worker/src/archive.rs`. Caching is
**worker-owned**, exactly like minimaps/thumbnails: the plugin resolves the app
cache dir and passes it to the worker via `--cache-dir`; the worker does the
read-before-open / write-after logic. The plugin command mirrors
`unitsync_minimap` (spawn worker, return the JSON in a `CliResult`); it holds no
cache logic of its own.

```
unitsync_game_header({ enginePath, dataDir, archive, checksum?, loadpicture? })
  -> GameHeaderResult { dataUrl?: string, errors: string[] }
```

The return is deliberately minimal: `dataUrl` present = show that art; `dataUrl`
absent = show the gradient placeholder. The frontend needs nothing more, so there
is no `source`/`cached` field.

Cache directory: `app.path().app_cache_dir()/coilbox-unitsync-headers/` (a
dedicated sibling of the existing `coilbox-unitsync-thumbs` dir; add a
`header_cache_dir()` helper mirroring `thumb_cache_dir()`).

Cache key: `game.checksum` (hex CRC string from the scan; unique per installed
game, changes when archive content changes -> free invalidation). If `checksum` is
empty/absent, caching is skipped for that game (same "unknown checksum disables
caching" behaviour as minimaps) and the archive is resolved live each time.

The cache stores the **resolved `data:` URL as text** in `<checksum>.dataurl`
(plus a `<checksum>.none` empty negative marker). Storing the response string
verbatim avoids re-encoding and preserves each image's real MIME type - important
because the worker's `image` crate only enables `png`+`tga` features and cannot
decode jpg/gif/bmp, while `encode_preview_image` already passes those formats
through as-is. The ~33% base64 inflation is negligible for a per-game cache.

Worker `game_header(lib, archive, loadpicture, checksum, cache_dir)` flow:

1. **Positive hit** - `<checksum>.dataurl` exists: read the string, return it as
   `dataUrl`. No archive open.
2. **Negative hit** - `<checksum>.none` exists: return `{ dataUrl: None }`. No
   archive open.
3. **Miss** - open the archive's VFS once (reusing `resolve_open_path` +
   `open_archive`) and resolve a candidate:
   - `loadpicture` first (if the passed path is non-empty and reads as an image
     via `read_archive_member` + `encode_preview_image`).
   - else list members (`list_archive_files`), keep those whose lowercased path
     starts with `bitmaps/loadpictures/` and ends in
     `.jpg/.jpeg/.png/.gif/.bmp/.tga`, and pick one. The pick index is
     `SystemTime` nanos mod count (adequate one-time randomness; no `rand` dep).
   On the first candidate that encodes: write `<checksum>.dataurl`, return the
   `data:` URL. If no candidate encodes: write `<checksum>.none`, return
   `{ dataUrl: None }`.

Because the resolved URL is frozen on disk, the random folder pick is **stable
across launches** until the archive (hence checksum) changes.

Eviction is **deferred** (follow-up): the cache is unbounded, matching the
existing (also unbounded) thumbnail cache. It is keyed per game, so it holds on
the order of tens of small entries, not the hundreds a per-map cache would.

ACL: the new command needs its entry in the plugin `build.rs` `COMMANDS` list and
an `allow-unitsync-game-header` line in `permissions/default.toml`, or it is
blocked at runtime.

### Frontend: shared hook + component

- Binding `unitsyncGameHeader` + `GameHeaderResult` type in
  `src/content/bindings.ts`.
- Hook `useGameHeaderImage(enginePath, dataDir, archive, checksum, loadpicture)`
  in `src/content/config.ts`, following the existing
  `useUnitsyncArchiveFile`/`useUnitsyncArchiveTree` shape: a module-level
  `Map<checksum, GameHeaderResult>` session cache over the Rust command, no-ops
  when `archive`/`checksum` is undefined. This is the reuse point - any component
  (detail hero, future grid, launcher) calls the hook and shares the cache.
- Component `src/content/pages/components/GameHeader.tsx`:
  `GameHeader({ game, selected, onPlay })`. `GameDetailPage` replaces its current
  `<header>` block with `<GameHeader … />`, passing its existing `play` handler.
  Everything below the header is unchanged; `shortname`, `checksum`, and
  `description` continue to render below the banner.

Two-tier cache overall: Rust disk cache (cross-launch, keyed by checksum) +
frontend module `Map` (within-session, avoids re-invoking the command per mount).

## Rendering

Full-bleed Steam-style hero, always present:

- Container breaks out of the page's `p-4` with `-mx-4 -mt-4`, `h-48` (192px),
  `w-full`, `relative`, `overflow-hidden`.
- **Base layer (always):** a colored gradient placeholder. Two hues derived from a
  hash of `game.name` produce a diagonal `linear-gradient` (inline style, dark-ish
  so overlaid white text stays AA-legible). Shown immediately and whenever the
  resolved `dataUrl` is absent.
- **Art layer (when `dataUrl` present):** `<img>` absolutely filling the
  container, `object-cover object-center` so the full-screen source art crops to a
  wide, short strip (center-anchored - top/bottom trimmed, matching Steam).
  `alt={`${game.name} loading screen`}`. Fades in over the placeholder on load;
  the fade is wrapped in `@media (prefers-reduced-motion: reduce)` to disable it.
- **Scrim:** an absolutely-positioned `bg-gradient-to-t from-background` overlay
  fading the image into the page background along the bottom, guaranteeing
  contrast for the overlaid controls.
- **Back-link:** "← Games" floats top-left over the image with a small dark scrim
  behind it for AA contrast.
- **Title + version:** bottom-left overlay - `h1` game name (with `SddBadge` when
  applicable) and version, white with a text-shadow.
- **Play button:** bottom-right overlay, the primary CTA (same `Play` icon +
  `onPlay` handler moved from the merged header). `shrink-0`.

All spacing on the 8pt/4pt grid. Touch targets >= 24px.

## Behaviour notes

- No skeleton: the placeholder is the base layer, so there is never a blank banner
  and no layout shift; real art fades in when/if it arrives.
- Broken/missing `loadpicture` silently falls back to a folder image, then to the
  placeholder - no error surfaced to the user.
- Selection/engine not chosen (`selected` undefined): hook no-ops, placeholder
  hero renders with title + Play.

## Success criteria

- A game with a `loadpicture` shows that image cropped into the 192px banner with
  title + version + Play overlaid.
- A game with no `loadpicture` but `bitmaps/loadpictures/*` shows one of those
  images, stable across navigation and across relaunches (frozen on disk).
- A game with neither shows a gradient placeholder hero (never the old plain
  header, never a blank strip), and does not re-open its archive on later launches
  (`.none` negative marker).
- Second launch renders cached heroes from `<checksum>.dataurl` without opening
  the archive VFS.
- The Play button retains its exact merged behaviour (seeds skirmish draft, routes
  to `/play/skirmish`).
- Lint/type/build green with the same commands CI runs:
  `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D
  warnings`, `bunx biome ci .`, `bun run typecheck`.
- Verified live via `bun tauri dev` + Tauri MCP screenshots of: a game with
  loadpicture art, a game showing the placeholder, and a relaunch hitting the
  cache.
