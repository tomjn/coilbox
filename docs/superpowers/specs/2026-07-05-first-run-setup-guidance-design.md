# First-run setup guidance

## Problem

A first run of Coilbox on a clean machine drops the user into a dead end. During
a Windows first-run the user had to, in order and unaided: discover the Content
Folders settings page, add a content folder manually with a native picker, click
"Add anyway" past a validation warning (the empty folder has no engine/games),
open Downloads settings and manually pick that folder as the download
destination, then find the Engines page to download an engine. Nothing offered to
create a folder at the standard location, nothing defaulted the download
destination, and nothing joined these steps into a flow.

## Goal

On first launch with nothing set up, guide the user through the minimum to play:
create a content folder at the OS-standard location, and download the newest
engine into it. Remove the incidental friction (manual path picking, the "Add
anyway" click, the unset download destination) along the way.

Non-goals: a multi-page wizard; configuring lobby accounts, maps, or games;
changing how existing (already-set-up) installs behave beyond the download-dir
default.

## Shape

Hybrid: a first-run **card** surfaced in two places (the launcher home and the
Content Folders settings empty state), backed by shared logic. The card links
into / drives the existing settings surfaces rather than replacing them. It
appears only while setup is incomplete and auto-hides once complete.

## Components

### 1. Setup-status signal — `useSetupStatus()`

A frontend hook (content plugin) deriving, from content state + downloads config:

- `needsFolder: boolean` — no content roots exist (`roots.length === 0`).
- `needsEngine: boolean` — roots exist but no engine is found in any
  (`roots.every(r => r.engines.length === 0)`).
- `complete: boolean` — at least one root AND at least one engine.
- `standardPath: string | undefined` — the OS-standard candidate path to offer
  (see command below), for the button label.

Setup is "incomplete" while `!complete`. This is the single source of truth for
card visibility and which step to show.

### 2. Quick-create content folder — new Rust command

`content_add_root` today requires the folder to already exist (`canon.is_dir()`)
and never creates it, and a brand-new empty folder fails `scan::classify` (no
engine/games/maps layout), forcing the "Add anyway" path.

Add `content_create_standard_root` to the content plugin
(`crates/tauri-plugin-coilbox-content`):

1. Compute the OS-standard candidate via the existing `paths::candidate_roots`,
   selecting the `origin == "prd-default"` entry (Windows
   `Documents\My Games\Spring`, macOS/Linux `~/.spring`).
2. `std::fs::create_dir_all` that path.
3. Add it as a root with `force: true` (it is the known-standard location, so the
   empty-folder validation must not block it; it records `forced` like today).
4. Return the updated `ContentState` (same shape `content_add_root` returns), so
   the caller learns the new root's `id`.

ACL: add the command to `build.rs` `COMMANDS` and `permissions/default.toml`
(new plugin commands are ACL-blocked otherwise).

Frontend binding `contentCreateStandardRoot` in `src/content/bindings.ts`. The
standard path for display comes from the already-defined-but-unused
`contentCandidates` command (pick the `prd-default` candidate's `path`).

### 3. Download-dir auto-default (standalone behavior)

Independent of onboarding: when `downloads.config.writeRootId` is unset **and**
content roots exist, auto-select and persist the first root's `id`. This makes
the download destination "not need setting". Implemented as an effect (a small
app-wide provider in the downloads plugin, or folded into an existing one) that
runs whenever content roots or the config change and back-fills `writeRootId`
when empty. Existing installs with a set `writeRootId` are untouched.

### 4. Download newest engine

The card's engine step performs a one-click install, reusing EngineInstaller's
existing logic (extracted into a shared helper module so the card and the
installer do not drift):

1. `dlRecoilEngines()` → releases for the platform; newest is the first entry.
2. `dlDownloadEngineRecoil({ version, assetUrl, writePath })` into the resolved
   write root, streaming progress.
3. `contentRescan()` so the new engine is picked up (mirrors EngineInstaller).

Edge case — no auto-installable engine for the platform (e.g. macOS, where no
official Recoil build exists and `dlRecoilEngines` returns empty): the engine
step must **still clearly state that an engine is required and that manual action
is needed** — the requirement is never hidden or silently dropped. Instead of the
one-click button it shows an explicit message ("An engine is required to play. No
automatic download is available for your platform — install one from the Engines
page") with a link to the Engines settings page (which hosts the full
EngineInstaller, including the springfiles Spring fallback). Primary path
(Windows/Linux) is the one-click newest Recoil.

### 5. UI surfaces

Both render a shared `SetupCard` component (content plugin), whose contents are
driven by `useSetupStatus()`:

- **Home card.** Shown on the launcher home while `!complete`. Mounting
  mechanism to be confirmed against picoframe's API during planning: either a
  home slot if one exists, or the `home`/`HomeOverride` hook in `src/main.tsx`
  (which today is used only for `profile.welcome`). If a home override is
  required, it must compose with — not clobber — the profile welcome override.
- **Content Folders settings.** The existing empty state
  (`src/content/pages/FoldersSection.tsx`) gains a primary "Create folder at
  `<standardPath>`" button beside the existing "Add folder"; the same guidance
  copy as the card.

Card steps (advance as each completes):

1. `needsFolder` → "Create folder at `<standardPath>`" → runs
   `contentCreateStandardRoot`, which also triggers the download-dir default.
2. `needsEngine` → "Download newest engine (v`<latest>`)" → downloads + rescans,
   showing progress. When no engine is auto-installable for the platform, this
   step instead states plainly that an engine is required and action is needed,
   linking to the Engines page (the requirement is never hidden).
3. `complete` → brief "You're all set" confirmation, then the card hides.

Dismissible: a dismiss control sets a persisted flag (`setup.dismissed` via
`useSetting`) that permanently hides the home card even if setup is still
incomplete — it does not reappear on later launches. The Content Folders
quick-create button and guidance are always present in that page's empty state
regardless of dismissal, so a dismissed user can still finish setup there.

## Flow

First launch, nothing set up → home card → "Create folder at ~/.spring" → folder
created on disk, added as a root, auto-set as the download destination → card
advances → "Download newest engine (v0.x)" → engine downloads with progress +
rescan → "You're all set" → card hides. Total: two clicks.

## Error handling

- Folder creation failure (permissions) → inline error on the card, folder not
  added, user can retry or fall back to manual "Add folder".
- Engine download failure → inline error + retry, mirroring EngineInstaller.
- macOS / empty `dlRecoilEngines` → link-to-installer fallback (not an error).
- `contentCreateStandardRoot` when the standard root already exists → treated as
  success (idempotent add), no duplicate root.

## Testing

- Rust: unit-test `content_create_standard_root` — creates the dir, adds a forced
  root, is idempotent when the root already exists.
- Frontend: `useSetupStatus` derivation (needsFolder / needsEngine / complete)
  from representative content-state + config inputs; download-dir auto-default
  effect back-fills `writeRootId` only when unset.

## Open implementation questions (resolve during planning)

1. picoframe home mounting: is there a home slot, or is a `HomeOverride` required
   (and how does it compose with `profile.welcome`)?
2. Where the download-dir auto-default effect lives (new tiny provider vs. an
   existing app-wide provider in the downloads plugin).
