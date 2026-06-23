# Coilbox

Desktop tooling for the [Recoil RTS](https://github.com/beyond-all-reason/RecoilEngine)
engine / Beyond All Reason community, built on [picoframe](https://github.com/tomjn/picoframe).

Coilbox is a [Tauri](https://tauri.app) v2 app that composes picoframe plugins. Its
first tool is **pr-downloader**: browse the Spring/Recoil rapid content repositories
and download a tag through a bundled `pr-downloader` sidecar.

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

> **Note:** macOS is arm64-only (Apple Silicon) by design. The committed
> `aarch64-apple-darwin` binary is a local build that links Homebrew dylibs, so
> for distribution it needs a static/self-contained build (the release CI rebuilds
> it from source).

## Licensing

Coilbox's own code is MIT. It bundles **`pr-downloader`**, which is licensed
**GPL-2.0-or-later** (© the Spring/Recoil authors). `pr-downloader` is invoked as a
separate process (a sidecar), i.e. mere aggregation — but redistributing the
binary carries the GPL obligation to make its corresponding source available. The
source is at <https://github.com/beyond-all-reason/pr-downloader>.
