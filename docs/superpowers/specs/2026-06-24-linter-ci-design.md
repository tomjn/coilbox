# Linter CI — Design

**Issue:** [#1 Set up linter CI](https://github.com/tomjn/coilbox/issues/1)
**Date:** 2026-06-24

## Problem

The repo has no automated lint or format checking on pull requests. The only
quality gate is `tsc --noEmit` inside the build script, and it never runs in CI.
There are no linter configs at all: no ESLint/Biome, no rustfmt/clippy config.
The two source surfaces — a React 19 + TypeScript + Vite frontend (`src/`, 31
files) and a 4-crate Rust workspace (`src-tauri/` + `crates/`, 17 files) — are
unchecked.

## Goal

A CI workflow that runs on pull requests (and pushes to `main`) and fails when
code is unformatted, fails lint rules, or fails to typecheck — across both the
TypeScript and Rust surfaces. The first run must land **green**: existing
violations are cleared (auto-fix or targeted rule relaxation) as part of this
work, not left as red CI.

Out of scope: commit-message / Conventional-Commits linting (explicitly
deferred).

## Tooling decisions

| Surface | Tool | Notes |
|---------|------|-------|
| TS/React lint + format | **Biome** | One Rust-based binary, one `biome.json`, recommended ruleset. Formatting **is enforced**. |
| TS typecheck | **tsc** | Reuse existing `tsc --noEmit`; run as its own CI step. |
| Rust lint | **clippy** | `cargo clippy --all-targets -- -D warnings` — warnings fail CI. |
| Rust format | **rustfmt** | `cargo fmt --all --check`. Default style, no `rustfmt.toml`. |

## Components

### 1. `biome.json` (repo root)
- `extends`/recommended ruleset enabled for lint **and** formatter.
- Scope to the frontend (`src/`, plus root `vite.config.ts` etc.); ignore
  `dist/`, `target/`, `node_modules/`, `src-tauri/`, generated files.
- React rules (react-hooks correctness) are part of Biome's recommended set.

### 2. `package.json` scripts
- `"lint": "biome check ."` — lint + format check (no writes).
- `"format": "biome format --write ."` — local convenience.
- Add `@biomejs/biome` to `devDependencies` (pinned), via `bun add -D`.

### 3. `.github/workflows/lint.yml`
Triggers: `pull_request`, and `push` to `main`.

Two parallel jobs, both on `ubuntu-22.04`:

- **frontend**
  1. `actions/checkout@v4`
  2. `oven-sh/setup-bun@v2`
  3. `bun install --frozen-lockfile`
  4. `bunx biome ci .` (CI-optimised: lint + format check, non-writing)
  5. `bun run tsc --noEmit` (typecheck gate)

- **rust**
  1. `actions/checkout@v4`
  2. `dtolnay/rust-toolchain@stable` with `components: clippy, rustfmt`
  3. Install Linux build deps (mirror `release.yml`: `libwebkit2gtk-4.1-dev
     libappindicator3-dev librsvg2-dev patchelf libdevil-dev`) — clippy must
     *compile* the Tauri crate before it can lint it.
  4. `rust-cache` (Swatinem/rust-cache) to keep clippy compile times sane.
  5. `cargo fmt --all --check`
  6. `cargo clippy --all-targets --all-features -- -D warnings`

The lint job does **not** fetch the SpringMapConvNG sidecars or set a version —
those are release-only concerns; clippy compiles source, it doesn't bundle.

## First-run cleanup (the real work)

Setting a linter on never-linted code surfaces a backlog. Plan:

1. **Format:** run `biome format --write .` once → commit the reformat (may touch
   many of the 31 frontend files). One-time clean baseline.
2. **Biome lint:** run `biome check --write` for safe auto-fixes; for anything
   left, either fix it or relax that *specific* rule in `biome.json` (documented
   inline). No blanket disabling.
3. **rustfmt:** run `cargo fmt --all` → commit any reformatting.
4. **clippy:** run `cargo clippy --all-targets -- -D warnings` locally; fix each
   warning. Only `#[allow(...)]` with an inline justification if a lint is a
   genuine false positive.

Success criterion: locally, `biome ci .`, `tsc --noEmit`, `cargo fmt --check`,
and `cargo clippy -- -D warnings` all pass before the workflow is pushed.

## Risks / notes

- **Clippy CI cost.** Compiling the Tauri workspace on every PR is the heaviest
  step; `rust-cache` mitigates it. Acceptable for now.
- **Reformat diff size.** Enforcing Biome formatting produces a one-time noisy
  commit; kept isolated from logic changes.
- **Biome version drift.** Pin the Biome version so local and CI agree (a newer
  Biome can introduce new violations).
