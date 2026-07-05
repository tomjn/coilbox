# Coilbox

Desktop tooling for the [Recoil RTS](https://github.com/beyond-all-reason/RecoilEngine)
engine / Beyond All Reason community, built on [picoframe](https://github.com/tomjn/picoframe).

Coilbox is a [Tauri](https://tauri.app) v2 app that composes picoframe plugins. Its
first tool is **pr-downloader**: browse the Spring/Recoil rapid content repositories
and download a tag through a bundled `pr-downloader` sidecar.

## Install

Download the build for your OS from [Releases](https://github.com/tomjn/coilbox/releases).

**macOS:** the app is ad-hoc signed but **not notarized** (no Apple Developer
account), so Gatekeeper blocks it on first launch. After copying Coilbox to
Applications, clear the download quarantine:

```sh
xattr -dr com.apple.quarantine /Applications/Coilbox.app
```

(or right-click the app → Open, then confirm in System Settings → Privacy &
Security). This is a one-time step per download.

## Develop

```sh
bun install
bun run tauri dev
```

Requires [Bun](https://bun.sh), a Rust toolchain, and the Tauri system
dependencies for your OS.

## Architecture

- `src/` — the React frontend. `app.plugins.ts` lists the picoframe plugins.
- `src/prdownloader/` — the pr-downloader plugin's frontend (nav, routes, the
  rapid explorer view, typed IPC bindings).
- `crates/tauri-plugin-coilbox-prdownloader/` — the plugin's Rust half: shells out
  to the bundled `pr-downloader` sidecar and fetches/parses the rapid index. ACL
  identifier `coilbox-prdownloader`.
- `src-tauri/binaries/` — the `pr-downloader` sidecar binaries, one per target
  triple (Tauri `externalBin`).

The frame, CLI, and plugin contract come from the published `@picoframe/*` packages.

## The pr-downloader sidecar

`pr-downloader` is sourced from the
[RecoilEngine](https://github.com/beyond-all-reason/RecoilEngine) releases
(Linux/Windows) and built from source for macOS (no official macOS build exists).
The binaries are committed under `src-tauri/binaries/pr-downloader-<target-triple>`.

It is bundled as a Tauri **resource folder** (`prdownloader/`), not an
`externalBin`: the Windows build is MinGW and loads `libcurl.dll` / `zlib1.dll` /
`libwinpthread-1.dll` from its own directory, so those DLLs (committed under
`src-tauri/binaries/pr-downloader-win-dll/`, a matched set from one engine
release) must ship beside it. `scripts/assemble-prdownloader.sh` builds the
per-platform folder from the committed prebuilts (run automatically by
`bun tauri dev` and in CI); the assembled folder is gitignored. For dev, set
`PRD_SIDECAR` if the sidecar isn't found via the resource dir.

> **Note:** macOS is arm64-only (Apple Silicon) by design. The committed
> `aarch64-apple-darwin` binary links Homebrew dylibs, so the bundled sidecar
> needs those at runtime; a portable distribution needs a static/self-contained
> build — a future step.

## Branding catalog

Coilbox brands game detail/grid views (banners, logos, screenshots, external
links) from a community-maintainable catalog, overriding the game's own
loading-screen art when an entry matches. Games increasingly ship a Lua-rendered
loading screen (or dead `modinfo` links), so the catalog is how you supply
current art/links without touching already-published game archives.

**The catalog is a single file:** `src-tauri/branding/catalog.json`. That one
file is both the source the app fetches at runtime (from the `main`-branch raw
URL) and the copy bundled into the app as an offline/first-run seed. Because it's
fetched at runtime, catalog edits merged to `main` reach users **without an app
release** — no version bump, no rebuild. The fetch URL is currently fixed to
this repo's `main` copy (`DEFAULT_BRANDING_CATALOG_URL` in
`src/content/branding.ts`).

### Editing it

Edit `src-tauri/branding/catalog.json` and open a PR against `main`. Validate the
JSON before pushing (`jq . src-tauri/branding/catalog.json`). Each `entries[]`
item brands exactly one game:

```jsonc
{
  "id": "splinter-faction",                 // required, unique slug
  "match": { "regex": "^Splinter *Faction" }, // required, see below
  "title": "Splinter Faction",              // optional display-name override
  "banner": ["https://.../banner.png"],     // ordered URL fallbacks
  "logo":   ["https://.../logo.webp"],
  "screenshots": [{ "urls": ["https://..."], "caption": "…" }],
  "videos": [{ "kind": "youtube", "id": "…", "title": "…" }],
  "links":  [{ "label": "Website", "url": "https://…" }]
}
```

- Everything except `id` and `match` is optional — an entry can be pure link
  backfill (only `links`) for a game whose `modinfo` site is dead.
- `banner`, `logo`, and each screenshot's `urls` are **ordered fallback arrays**:
  candidates are tried in order until one fetches. Image URLs must be **https**.
  URLs may point anywhere (project sites, itch.io, imgur, GitHub) — the catalog
  stores only URLs, hosts no binaries, and the app proxies images so no CSP
  host-allowlisting is needed.

### Matching (narrow, per-project)

`match` is tested against the installed game's identity (`game.name`, with
`game.info.shortname` as a secondary target for `names`):

- `regex` — case-insensitive, tested against `game.name`.
- `names` — case-insensitive exact matches against `game.name` /
  `game.info.shortname`; these take precedence over `regex` within an entry.
- Entries are evaluated top-to-bottom and the **first** match wins, so order
  most-specific first.
- An invalid regex skips only that entry, not the whole catalog.

Keep matchers tight and per-project: games that share ancestry (e.g. Balanced
Annihilation, Beyond All Reason, Splinter Faction) are **distinct** projects, and
a broad ancestral pattern would misbrand siblings. Verify every pattern against
the real installed `game.name` (which usually embeds a version) before landing
it.

### Caches

Resolved catalog and images are cached under the app cache dir
(`coilbox-branding/catalog.json` and `coilbox-branding-images/`). On network
failure the app falls back to that disk cache, then the bundled seed, so branding
degrades gracefully rather than hard-failing.

## Licensing

Coilbox's own code is MIT. It bundles **`pr-downloader`**, which is licensed
**GPL-2.0-or-later** (© the Spring/Recoil authors). `pr-downloader` is invoked as a
separate process (a sidecar), i.e. mere aggregation — but redistributing the
binary carries the GPL obligation to make its corresponding source available. The
source is at <https://github.com/beyond-all-reason/pr-downloader>.
