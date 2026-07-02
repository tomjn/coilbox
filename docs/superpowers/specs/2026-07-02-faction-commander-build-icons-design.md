# Faction commander build icons — design

**Date:** 2026-07-02
**Branch:** `feat/faction-commander-build-icons`
**Status:** Approved design, ready for implementation plan

## Goal

Show each faction's commander (start unit) build icon next to the faction name in
the game detail page's Sides section. One icon per faction.

## Background / current state

- `unitsync_game_info` (worker `game::render`, `crates/coilbox-unitsync-worker/src/game.rs:16`)
  already returns each side's `startUnit` internal name (e.g. `armcom`) and a
  human-readable `startUnitName`. These render in `GameDetailPage.tsx:120-148`.
- unitsync's unit FFI exposes only name/count — **no buildpic accessor**. Build pics
  live in the game archive VFS under `unitpics/`, named either by the unitdef's
  `buildpic` field or, by default, by the unit's internal name.
- Proven pattern to mirror: the loadpicture **header cache** (worker-owned, under
  `app_cache_dir/coilbox-unitsync-headers`, cheap file-identity key, `.dataurl` /
  `.none` marker files) in `crates/coilbox-unitsync-worker/src/archive.rs`.
- The worker's `image` crate is built with png/tga/jpeg/bmp/gif only — **no DDS**.
  Spring/Recoil build pics are frequently `.dds` (DXT/BCn compressed).

## Decisions

- **Scope:** commander (start unit) only — one icon per faction.
- **DDS:** add a decoder dependency. Candidates: `ddsfile = "0.6.0"` (container/format
  parse) + `texpresso = "2.0.2"` (pure-Rust BC1/2/3 decompress); alternative
  `image_dds = "0.7.2"` (single crate, heavier — pulls an encode toolchain with a C
  dep). Recommend the `ddsfile` + `texpresso` pair, decode-only, pure Rust, slots into
  the existing `image::RgbaImage` pipeline. Final pick confirmed at plan time.
- **DDS decode is a shared helper**, not buildpics-only, so archive preview and
  header/load-screen art can adopt it. This PR wires it into the buildpics path;
  extending archive preview (`.dds` in the IMAGE list) and header art are noted as
  cheap opt-in follow-ons, out of scope here to keep the PR focused.
- **Icon encoding:** PNG **with alpha preserved** (build pics have transparent
  backgrounds), unlike the header path which flattens to opaque JPEG.
- **Approach A** (dedicated worker mode) over reusing lua-exec + archive-file (Approach
  B, multi-mount, no cache) or embedding in `game_info` (Approach C, bloats the
  response, couples concerns).

## Architecture

New worker mode `--unit-buildpics`. Input: game archive + list of start-unit internal
names. In a **single `AddAllArchives` session**:

1. **Resolve buildpic filename** — run the restricted Lua parser once to collect each
   requested unit's explicit `buildpic` field from its unitdef (handles games that
   override it). Candidate basename = explicit `buildpic` if present, else the unit's
   internal name.
2. **Locate + read texture** — for each unit, try `unitpics/<basename>.<ext>` for ext
   in `[dds, png, tga, bmp]` (engine resolution order), reading the first that exists
   from the already-mounted VFS (`read_archive_member`).
3. **Decode + encode** — shared texture-decode helper (adds DDS/BCn) → downscale to
   icon size (~128px, preserve aspect) → encode PNG with alpha → `data:` URL.
4. **Cache** — write `.dataurl` / `.none` markers; hit/negative skips the mount.

One mount, queried twice (Lua + file reads), avoiding Approach B's repeated mounts.

## Caching

- New subdir: `app_cache_dir/coilbox-unitsync-buildpics` (new constant in the plugin,
  alongside the existing header/thumb subdir constants).
- One marker file per (game-identity, unit): reuse the existing cheap `game_cache_key`
  (version salt + primary archive path + size + mtime) suffixed with the unit's
  internal name.
- Own version salt (`BUILDPIC_CACHE_VERSION`) so the icon cache invalidates
  independently of the header cache.
- `.dataurl` = resolved icon; `.none` = no usable buildpic; miss = mount + resolve.

## Plugin + bindings

- New command `unitsync_unit_buildpics(engine_path, data_dir, game_archive, units)`
  → `{ buildpics: Record<unitName, dataUrl | null>, errors }`.
- Wire end-to-end: `sidecar.rs` arg builder (`build_unit_buildpics_args`), the
  `#[tauri::command]` + handler entry in the plugin `lib.rs`, the command name in
  `build.rs` `COMMANDS`, `permissions/default.toml`, and a TS binding in
  `src/content/bindings.ts`. (Missing the COMMANDS entry or the permission toml =
  runtime ACL block.)

## UI

- `GameDetailPage` collects the sides' `startUnit` names, calls a new session-cached
  `useUnitsyncUnitBuildpics(enginePath, dataDir, gameArchive, units)` hook (mirroring
  `useUnitsyncGameInfo`'s session cache in `src/content/config.ts`).
- Render an `<img>` icon next to each side name in the existing Sides section
  (`GameDetailPage.tsx:120-148`).
- **Fallback:** buildpic null → render the side with no icon (no placeholder box),
  matching current behaviour.
- Human-readable name unchanged — `startUnitName` already comes from `game_info`.

## Error handling

- Per-unit resolution failures are isolated: a null entry for that unit, never a
  whole-call failure. Worker collects `errors` like existing modes.
- Unresolvable / unsupported texture → `.none` negative cache, `<img>` omitted.
- Decode failure (corrupt/odd DDS variant) → treated as unresolved (negative), logged
  in `errors`.

## Testing

- Worker unit tests (following `archive.rs` test style):
  - extension-resolution order picks the first existing candidate,
  - DDS decode of a small fixture `.dds` yields a non-empty `RgbaImage`,
  - negative-cache marker written when no candidate exists.
- Manual live smoke via `bun tauri dev` on a real game (BAR / BA): commander icons
  appear next to factions, screenshots captured. The LuaParser path needs a live
  libunitsync, so it can't be fully unit-tested.

## Out of scope (noted follow-ons)

- All-units-per-faction icon grids.
- Adopting the shared DDS decoder in archive preview (`.dds` in the IMAGE list) and
  header/load-screen art — cheap once the shared helper lands, deferred to keep this
  PR focused.

## Lint / CI reminder (from CLAUDE.md)

Before the PR: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features
-- -D warnings`, `bunx biome ci .`, `bun run typecheck`. Give the user a chance to
test via `bun tauri dev` first.
