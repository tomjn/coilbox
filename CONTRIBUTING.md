# Contributing to Coilbox

Thanks for helping out. Coilbox is a [Tauri](https://tauri.app) v2 desktop app for the [Recoil RTS](https://github.com/beyond-all-reason/RecoilEngine) engine / Beyond All Reason community, built on [picoframe](https://github.com/tomjn/picoframe). This guide covers how to get set up, the project layout, and what a mergeable change looks like.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

You don't need to build the app to help:

- **Branding a game** (banners, logos, screenshots, links) is a single-file edit — see [Branding catalog](README.md#branding-catalog) in the README. No app release is needed; catalog edits merged to `main` reach users at runtime.
- **Bug reports and feature requests** go through the issue templates. Pick the closest one when opening an issue.
- **Code** — read on.

## Prerequisites

- [Bun](https://bun.sh) (frontend tooling and scripts)
- A Rust toolchain (`rustup`, stable)
- The [Tauri v2 system dependencies](https://tauri.app/start/prerequisites/) for your OS (WebKit, etc.)

macOS builds are arm64-only (Apple Silicon) by design.

## Setup and running

```sh
bun install
bun run tauri dev
```

`bun run tauri dev` assembles the bundled sidecars (`pr-downloader`, the unitsync worker) automatically before launching. If you only want the sidecars built (for example to run clippy without a full dev launch):

```sh
bun run sidecar:all
```

## Project layout

Coilbox is a picoframe host: `src/app.plugins.ts` composes an array of plugins, and most features are a matched pair.

- `src/` — the React + TypeScript frontend. Each feature has its own directory (`src/content/`, `src/mapconv/`, `src/multiplayer/`, …) holding its nav, routes, views, and typed IPC bindings. `src/components/` and `src/lib/` are shared.
- `crates/tauri-plugin-coilbox-<name>/` — the Rust half of a plugin. This is where a feature shells out to sidecars, touches the filesystem, or calls native libraries.
- `crates/coilbox-*` — supporting Rust crates that aren't Tauri plugins (`coilbox-unitsync-worker`, `coilbox-springlua`, `coilbox-portable`, …).
- `src-tauri/` — the app crate: `tauri.conf.json`, bundled binaries, and bundle-resource folders.
- `scripts/` — build/assembly helpers (sidecars, cleanup, test fixtures).

The frame, CLI, and plugin contract come from the published `@picoframe/*` packages.

### Adding a plugin

Prefer `picoframe add <plugin>` over editing `src/app.plugins.ts` by hand — the `// picoframe:*-start/end` marker comments in that file are codegen anchors the CLI manages.

Two gotchas when adding Rust plugin commands:

- **ACL registration.** A new plugin command must be listed in the crate's `build.rs` `COMMANDS` array *and* granted in `permissions/default.toml`, or it's blocked at runtime by Tauri's ACL. This is silent until you hit the command.
- **Wire it into the GUI.** A plugin the user can't reach isn't done. Confirm any new screen is reachable in `bun run tauri dev` before opening a PR.

### UI components

Prefer picoframe's components over native elements or hand-rolled ones:

- Import `Button`, `Input`, and `cn` directly from `@picoframe/frame`.
- Everything else (`select`, `checkbox`, `textarea`, `switch`, `dialog`, `tooltip`, …) comes from the `@picoframe` shadcn registry: `npx shadcn@latest add @picoframe/<name>` copies the source component into `src/components/ui/`.

Don't reach for native `<select>` / `<input type=checkbox>` / `<textarea>`.

## Before you open a PR

Run the **full** lint and test suite locally — CI (`.github/workflows/lint.yml`) checks both the Rust and frontend surfaces, so run both even if you only touched one. Use the same commands CI runs, not a narrower subset:

**Frontend**

```sh
bunx biome ci .
bun run typecheck
```

**Rust**

```sh
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
```

Let rustfmt own formatting — run `cargo fmt --all` rather than hand-formatting. Clippy compiles the app crate, so the sidecars must exist first (`bun run sidecar:all`).

The lint CI covers the two surfaces above. Tests aren't part of that workflow, but if your change touches tested code, run the frontend suite too:

```sh
bun run test
```

## Pull requests

- Keep commits atomic and prefer several small commits over one large one; it keeps history readable and changes easy to extract.
- Write the PR description for a technical reviewer who will read the diff: spend the words on *why* and on context the diff can't show, not on restating the changes.
- If you add a GUI, make sure it's actually reachable in the running app and give reviewers a way to test it (`bun run tauri dev`).

## Releases

The release version comes from the git tag, not from source — CI writes the pushed tag into `tauri.conf.json` at build time, and the in-source version stays a `0.0.0` placeholder. To cut a release, push an `N.N` or `N.N.N` tag at the release commit; no manual version bump is needed.

## Licensing

Coilbox's own code is MIT (see [LICENSE](LICENSE)). It bundles `pr-downloader`, which is GPL-2.0-or-later; that source is at <https://github.com/beyond-all-reason/pr-downloader>. By contributing you agree your contribution is licensed under the repository's MIT license.

## Security

Please don't file security issues as public GitHub issues. See [SECURITY.md](SECURITY.md) for how to report a vulnerability.
