## Before Creating PRs

 - Make sure to give the user an opportunity to test via `bun tauri dev`
 - ensure any new GUIs are actually wired into the GUI and can be reached by the user
 - This is not a website so the chrome MCP will not be useful to you. There is a Tauri MCP

## PR's

Before pushing, run the **full** check suite locally and confirm it passes. CI (`.github/workflows/lint.yml`) runs **three jobs and seven commands**, and a green subset is not a green PR. Run all seven even when you only touched one surface, and run the **same commands CI runs**, not a narrower subset (a single-crate clippy or `biome check` without `ci` will miss failures):

- Frontend job: `bunx biome ci .`, `bun run typecheck`, `bun run test`
- Lua job: `scripts/mission-tests.sh`
- Rust job: `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`

The two easiest to miss are `scripts/mission-tests.sh` and `cargo test --workspace`. The Lua job is a whole third job with no lint in it at all: the mission runtime and the blueprint widget are Lua the engine runs, so neither of the other jobs compiles them and a break would otherwise reach a game. `cargo test --workspace` is tucked inside the Rust job because clippy compiles `#[cfg(test)]` modules but never runs them, so a wrong Rust test would otherwise pass forever.

Both Lua suites need `luajit` on PATH (`brew install luajit`), as do two vitest files that shell out to it to check the Lua they generate compiles. Without the binary they fail on the missing dependency rather than on a real error.

Let rustfmt own formatting — run `cargo fmt --all` rather than hand-formatting. CI's clippy compiles the Tauri app crate, so externalBin sidecars must exist; the unitsync worker is built in CI and locally via `bun run sidecar:unitsync`.

Both `apt-get install` steps in CI fail from time to time on the runner rather than on your diff. A red job whose failing step is `Install LuaJIT` or `Linux build dependencies` is an infrastructure flake, so re-run the job rather than changing code.

## Driving the app

Verifying a change on screen is expected for anything visual, and every step below has cost somebody real time. Read this before starting an instance.

**A portable instance has no games until you seed it.** Running your own coilbox is the safe way to avoid disturbing one already open, and portable mode keeps it out of the user's app data: a `.coilbox/profile.json` beside the binary redirects `data_dir` to `.coilbox/data` and `cache_dir` to `.coilbox/cache`. But a fresh portable profile has **no content roots**, because the auto-detection that finds the Spring data directory does not apply there. The game picker comes up empty and every screenshot is of an app with nothing in it. Seed it first:

```sh
mkdir -p <app-dir>/.coilbox/data <app-dir>/.coilbox/cache
cp -R "$HOME/Library/Application Support/com.tomjn.coilbox/." <app-dir>/.coilbox/data/
```

Copy rather than point at the real directory, so you get the games and settings and still write nothing to the user's own profile. The copy carries their existing projects too, so delete only what you create. An empty game picker means an unseeded profile, not a bug in your change.

**The Tauri MCP socket is pinned.** `.mcp.json` fixes it at one path and the app binds that path. If another app already holds it, your MCP calls **drive that app instead of failing**, with nothing in the response saying so. An agent resized somebody else's window that way. Run on your own port with your own socket path, revert those local edits before committing, and confirm which app you are driving before believing what you see.

Giving your app its own socket is only half of it, because the session's MCP server is still pointed at the pinned path, so the tools stay aimed at whatever holds that. **Spawn a second MCP server pointed at your own socket and drive it over stdio**, rather than trying to repoint the session's. That leaves the running app completely alone and gives you full control of yours. `~/dev/tauri-plugin-mcp/mcp-server-ts/build/index.js` is the server. Issues #2726 and #1597 cover making the path an environment variable, which would remove the source edit entirely.

**A window nobody can see still paints, but does not animate.** If the user is full screen in another app your window stays occluded and `document.visibilityState` is `hidden`. Screenshots are genuine, but CSS transitions never run, so anything that slides in sits at its start position and appears in no shot. Read the DOM for those and say so, rather than taking the screen off the user for a prettier picture.

**`execute_js` is effectively read-only.** Monkey-patching renderer internals wedges the JS bridge, and so does something as ordinary as setting `window.location.hash` to navigate: both have taken the app down with a SIGTERM. Use the MCP's own `navigate` tool, and reach for `execute_js` only to read.

**Anchor any `pkill` to your own path.** `pkill -f "tauri dev"` matches every checkout on the machine, not yours. Use the absolute path of your own binary and your own vite.

**A `tauri dev` app does not use the sidecar you just built.** `bun run sidecar:unitsync` writes `src-tauri/binaries/coilbox-unitsync-worker-<triple>`, which is what a bundled build uses. A dev app resolves `target/debug/coilbox-unitsync-worker`, refreshed only by `cargo build`. After changing the worker, do both, then check the flag directly rather than trusting the build's success message.

## Worktrees and branches

**Give every worktree its own `CARGO_TARGET_DIR`.** Sharing one between checkouts has produced a stale sidecar binary that answered "unknown argument" for a mode that had just merged, and crates whose build scripts pointed into a worktree that no longer existed. The disk saving is not worth the hour.

**Do not `git rebase`.** The `git-safe` hook blocks it and offers `allow: rebase` in `.git-safe` as the escape. Do not take it: editing the guard configuration is the user's call. Update a conflicting branch by merging `origin/main` into it, which needs no force push either.

**Never run `git checkout` or `git pull` in a checkout somebody else is working in.** It switches the shared working tree out from under them, and a commit made in that window lands on the wrong branch. `gh pr merge` and `git fetch` do the job without touching the tree.

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