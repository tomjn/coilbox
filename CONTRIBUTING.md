# Contributing to Coilbox

Thanks for helping out. Coilbox is a [Tauri](https://tauri.app) v2 desktop app for playing and building games on the [Recoil](https://github.com/beyond-all-reason/RecoilEngine) and Spring RTS engines, built on [picoframe](https://github.com/tomjn/picoframe). This guide covers how to get set up, the project layout, and what a mergeable change looks like.

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

### macOS keychain prompts in dev

Logging in to the lobby reads a saved password out of the keychain, and macOS keys your "Always Allow" answer to the calling binary's code signature. A dev build is re-signed on every rebuild, so without a workaround you are asked again every time you touch a Rust file.

Debug builds on macOS therefore read the secret by shelling out to `/usr/bin/security`, which is Apple-signed and never changes, so the grant holds. Release builds always use the in-process keychain API. The detail lives in `read_via_security_tool` in `crates/tauri-plugin-coilbox-lobby-servers/src/lib.rs`.

Signing dev builds with a self-signed certificate does not work as an alternative. macOS only derives the stable `teamid:` grant from an Apple-issued certificate, and falls back to the per-build code hash for anything else.

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
- Everything else (`select`, `checkbox`, `textarea`, `switch`, `dialog`, `tooltip`, …) comes from the `@picoframe` shadcn registry: `bunx shadcn@latest add @picoframe/<name>` copies the source component into `src/components/ui/`.

Don't reach for native `<select>` / `<input type=checkbox>` / `<textarea>`.

## Before you open a PR

Run the **full** lint and test suite locally. CI (`.github/workflows/lint.yml`) runs three jobs and seven commands, so run all seven even if you only touched one surface. Use the same commands CI runs, not a narrower subset:

**Frontend**

```sh
bunx biome ci .
bun run typecheck
bun run test
```

**Lua**

```sh
scripts/mission-tests.sh
```

**Rust**

```sh
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
```

Let rustfmt own formatting — run `cargo fmt --all` rather than hand-formatting. Clippy compiles the app crate, so the sidecars must exist first (`bun run sidecar:all`).

Both Lua suites need `luajit` on your PATH (`brew install luajit` on macOS), as do two vitest files that shell out to it to check the Lua they generate compiles. Without the binary they fail on the missing dependency rather than on a real error.

The two easiest checks to forget are `scripts/mission-tests.sh` and `cargo test --workspace`. The Lua job is a whole third CI job with no lint in it: the mission runtime and the blueprint widget are Lua the engine runs, so neither of the other jobs compiles them and a break would otherwise reach a game. `cargo test --workspace` sits at the end of the Rust job because clippy compiles `#[cfg(test)]` modules but never runs them, so a wrong Rust test would otherwise pass forever.

If a CI job fails on a step called `Install LuaJIT` or `Linux build dependencies`, that is an apt failure on the runner rather than your diff. Re-run the job.

### Testing a React hook

Tests run in Node by default, because most of the suite has no React in it and a DOM costs about 150ms per file to stand up. A file that needs one asks for it on its own first line:

```tsx
// @vitest-environment happy-dom
```

Then `renderHook` from `@testing-library/react` runs the hook, `waitFor` waits for an effect's answer to arrive, and `act` wraps anything that sets state. `src/hub/assets/useMapPicture.test.tsx` is the worked example, including the wrapper a hook needs when it reads a setting through the frame's store. Call `cleanup()` in an `afterEach`, because this repo doesn't enable Vitest's globals and the library can't register its own.

Prefer this over asserting a hook is correct by reading it. The wiring inside a hook is exactly where a feature is switched on or off, and nothing else in the suite covers it.

## Pull requests

- Keep commits atomic and prefer several small commits over one large one; it keeps history readable and changes easy to extract.
- Write the PR description for a technical reviewer who will read the diff: spend the words on *why* and on context the diff can't show, not on restating the changes.
- If you add a GUI, make sure it's actually reachable in the running app and give reviewers a way to test it (`bun run tauri dev`).

## Releases

The release version comes from the git tag, not from source — CI writes the pushed tag into `tauri.conf.json` at build time, and the in-source version stays a `0.0.0` placeholder. To cut a release, push an `N.N` or `N.N.N` tag at the release commit; no manual version bump is needed.

`scripts/build-windows-icon.sh` and `scripts/build-windows-nsis-images.sh` regenerate committed Windows icon assets (`icon-windows.ico`, `nsis-header.bmp`, `nsis-sidebar.bmp`) from `src-tauri/icons/icon.png`. Run one by hand, with ImageMagick installed, whenever that source artwork changes. Each script's own header explains the details. Release builds don't call either script.

## Licensing

Coilbox's own code is MIT (see [LICENSE](LICENSE)). It bundles `pr-downloader`, which is GPL-2.0-or-later; that source is at <https://github.com/beyond-all-reason/pr-downloader>. By contributing you agree your contribution is licensed under the repository's MIT license.

## Security

Please don't file security issues as public GitHub issues. See [SECURITY.md](SECURITY.md) for how to report a vulnerability.
