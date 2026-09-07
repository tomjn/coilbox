## Before Creating PRs

 - Make sure to give the user an opportunity to test via `bun tauri dev`
 - ensure any new GUIs are actually wired into the GUI and can be reached by the user
 - This is not a website so the chrome MCP will not be useful to you. There is a Tauri MCP

## PR's

Before pushing, run the **full** check suite locally and confirm it passes. CI (`.github/workflows/lint.yml`) runs **three jobs and seven commands**, and a green subset is not a green PR. Run all seven even when you only touched one surface, and run the **same commands CI runs**, not a narrower subset (a single-crate clippy or `biome check` without `ci` will miss failures):

- Frontend job: `bunx biome ci .`, `bun run typecheck`, `bun run test`
- Lua job: `scripts/mission-tests.sh`
- Rust job: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --workspace`

The two easiest to miss are `scripts/mission-tests.sh` and `cargo test --workspace`. The Lua job is a whole third job with no lint in it at all: the mission runtime and the blueprint widget are Lua the engine runs, so neither of the other jobs compiles them and a break would otherwise reach a game. `cargo test --workspace` is tucked inside the Rust job because clippy compiles `#[cfg(test)]` modules but never runs them, so a wrong Rust test would otherwise pass forever.

Both Lua suites need `luajit` on PATH (`brew install luajit`), as do two vitest files that shell out to it to check the Lua they generate compiles. Without the binary they fail on the missing dependency rather than on a real error.

Let rustfmt own formatting — run `cargo fmt --all` rather than hand-formatting. CI's clippy compiles the Tauri app crate, so externalBin sidecars must exist; the unitsync worker is built in CI and locally via `bun run sidecar:unitsync`.

Both `apt-get install` steps in CI fail from time to time on the runner rather than on your diff. A red job whose failing step is `Install LuaJIT` or `Linux build dependencies` is an infrastructure flake, so re-run the job rather than changing code.

## UI components

Prefer picoframe's components over native elements or hand-rolled ones. picoframe ships UI through **two channels**:

- **`@picoframe/frame` (npm)** exports only `Button`, `Input`, and `cn` - the primitives importable directly in plugin code. By design it will never export the other inputs.
- **`@picoframe` shadcn registry** provides everything else (`select`, `checkbox`, `textarea`, `label`, `radio-group`, `switch`, `slider`, `form`, `dialog`, `tooltip`, `popover`, `collapsible`). These are shadcn *source* components: pull them with `bunx shadcn@latest add @picoframe/<name>`, which copies the file into `src/components/ui/`. `components.json` is already wired to the registry; the `@/` alias resolves to `src/`.

So: import `Button`/`Input` from `@picoframe/frame`; add anything else from the registry. Don't reach for native `<select>`/`<input type=checkbox>`/`<textarea>` or restyle your own. `src/components/OptionSelect.tsx` is a thin wrapper that composes the registry `Select` for the simple options-list case, and `src/components/Field.tsx` is the shared labelled-form-row wrapper (plus `CheckField` for a checkbox and label row). Both live beside `src/components/ui/` rather than inside it, so a future `bunx shadcn@latest add @picoframe/<name>` can never overwrite them.

## Releases

The release version comes from the git tag, not from source. CI (`.github/workflows/release.yml`) writes the pushed tag (e.g. `0.2.0`) into `tauri.conf.json` at build time via `jq`; in source the version stays a `0.0.0` placeholder. To cut a release, push a `N.N` or `N.N.N` tag at the release commit — no manual version bump is needed. (`package.json` / Cargo versions are not used for the artifact version.)

## Reports

Write reports to `docs/reports/`, never the repo root. That covers anything you produce to be read once and then thrown away: investigation write-ups, audit results, HTML summaries of a run. The folder is gitignored and excluded from the docs site, so nothing there ships or needs reviewing.

Working notes from the orchestrate-milestone skill stay in the root as `ORCHESTRATION-<n>.md` and are gitignored there.

## Disk Space

Be mindful that work trees can contain large amounts of data that can fill up the disk with build artefacts. Make sure that when work is done and a PR is created that you offer to clean up the build artefacts, and that the build folder does not inflate out of control to multiple tens of GB.