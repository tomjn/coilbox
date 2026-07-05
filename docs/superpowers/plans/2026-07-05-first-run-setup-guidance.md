# First-run Setup Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a first run with nothing set up, guide the user to create a content folder at the OS-standard location and download the newest engine, removing the incidental friction (manual path picking, the "Add anyway" click, the unset download destination).

**Architecture:** A new Rust command creates + registers the standard content folder. A frontend `useSetupStatus` hook drives a shared `SetupCard`, surfaced both on the home (via a `home` override, since picoframe has no home slot) and in the Content Folders settings empty state. The download destination auto-defaults to the first content root when unset, and the engine step reuses an extracted install helper.

**Tech Stack:** Rust (Tauri plugin), React + TypeScript, picoframe frame plugin API, vitest, cargo test.

Spec: `docs/superpowers/specs/2026-07-05-first-run-setup-guidance-design.md`

---

## File structure

- `crates/tauri-plugin-coilbox-content/src/paths.rs` — add pure `standard_root_path(os, &BaseDirs) -> Option<PathBuf>` (the `prd-default` candidate). **Testable.**
- `crates/tauri-plugin-coilbox-content/src/lib.rs` — add `content_create_standard_root` command + refactor `content_add_root` body into an `add_root_inner` helper.
- `crates/tauri-plugin-coilbox-content/build.rs` + `permissions/default.toml` — ACL for the new command.
- `src/content/bindings.ts` — add `contentCreateStandardRoot` binding.
- `src/content/config.ts` — add `deriveSetup` (pure) + `useSetupStatus` hook. **`deriveSetup` testable.**
- `src/content/ContentStartupProvider.tsx` — back-fill `downloads.config.writeRootId` when unset and roots exist.
- `src/downloads/engineInstall.ts` — **new**: `fetchNewestRecoil()` + `installRecoil(...)` shared helper.
- `src/downloads/pages/components/EngineInstaller.tsx` — use the shared helper for its recoil path (stay in sync).
- `src/content/pages/components/SetupCard.tsx` — **new**: the shared setup card.
- `src/content/pages/FoldersSection.tsx` — quick-create button in the empty state.
- `src/content/pages/SetupHome.tsx` — **new**: home override composing SetupCard + the underlying home.
- `src/main.tsx` — wire `home` to `SetupHome`.

---

## Task 1: Rust — pure `standard_root_path`

**Files:**
- Modify: `crates/tauri-plugin-coilbox-content/src/paths.rs`
- Test: same file (`#[cfg(test)]` module already present)

- [ ] **Step 1: Write the failing test** (append to the `tests` module in `paths.rs`)

```rust
#[test]
fn standard_root_path_is_prd_default() {
    let mut b = BaseDirs::default();
    b.home = Some(PathBuf::from("/home/u"));
    b.documents = Some(PathBuf::from("/home/u/Documents"));
    assert_eq!(
        standard_root_path(Os::Windows, &b),
        Some(PathBuf::from("/home/u/Documents/My Games/Spring"))
    );
    assert_eq!(
        standard_root_path(Os::Linux, &b),
        Some(PathBuf::from("/home/u/.spring"))
    );
}
```

Note: confirm `BaseDirs` is constructible in the test — it already has other fields; use `..Default::default()` if it derives `Default`, otherwise build it the way existing `paths.rs` tests do. Check the top of the existing `tests` module for the pattern and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p tauri-plugin-coilbox-content standard_root_path`
Expected: FAIL — `cannot find function standard_root_path`.

- [ ] **Step 3: Implement `standard_root_path`** (add above `candidate_roots` in `paths.rs`)

```rust
/// The single OS-standard content-root path to offer for quick-create: the
/// pr-downloader default write dir (Windows `Documents\My Games\Spring`,
/// otherwise `~/.spring`). Mirrors the `prd-default` candidate in `candidate_roots`.
pub fn standard_root_path(os: Os, b: &BaseDirs) -> Option<PathBuf> {
    candidate_roots(os, b)
        .into_iter()
        .find(|c| c.origin == "prd-default")
        .map(|c| c.path)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p tauri-plugin-coilbox-content standard_root_path`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-content/src/paths.rs
git commit -m "content: pure standard_root_path helper"
```

---

## Task 2: Rust — `content_create_standard_root` command

**Files:**
- Modify: `crates/tauri-plugin-coilbox-content/src/lib.rs` (refactor `content_add_root` ~:437-483; add new command after it)
- Modify: `crates/tauri-plugin-coilbox-content/build.rs`
- Modify: `crates/tauri-plugin-coilbox-content/permissions/default.toml`

- [ ] **Step 1: Extract `add_root_inner` from `content_add_root`.** Replace the body of `content_add_root` (lib.rs:443-482, the part after the signature) so the add logic lives in a reusable helper. New helper (place above `content_add_root`):

```rust
/// Add a root by canonical path: validate (unless `force`), record the user root
/// (relative when `portable`), recompute and persist, returning the new state.
fn add_root_inner<R: Runtime>(
    app: &AppHandle<R>,
    canon: &Path,
    label: Option<String>,
    force: bool,
    portable: bool,
) -> Result<ContentState, String> {
    let sp = store_path(app)?;
    let valid = canon.is_dir() && scan::classify(canon).is_some();
    if !valid && !force {
        return Err("That folder doesn't look like a Spring data root (no engine/games/maps/rapid \
             layout or portable install). Add it anyway to force."
            .into());
    }
    let stored = stored_root_path(portable, canon)?;
    let mut store = load_store(&sp)?;
    if !store
        .user_roots
        .iter()
        .any(|u| canonical(&resolve_stored(&u.path)) == *canon)
    {
        store.user_roots.push(UserRoot {
            path: stored,
            label,
            forced: force && !valid,
        });
    }
    let state = compute_state(app, &store, true, false);
    persist(&sp, store, &state)?;
    Ok(state)
}
```

Then rewrite `content_add_root`'s body to delegate:

```rust
#[tauri::command]
async fn content_add_root<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    label: Option<String>,
    force: Option<bool>,
    portable: Option<bool>,
) -> Result<CliResult, ()> {
    let canon = canonical(Path::new(&path));
    match add_root_inner(&app, &canon, label, force.unwrap_or(false), portable.unwrap_or(false)) {
        Ok(state) => Ok(CliResult::ok(json!({ "state": state }))),
        Err(e) => Ok(CliResult::err(e)),
    }
}
```

(If `store_path`/`stored_root_path`/`resolve_stored`/`compute_state`/`persist`/`canonical` are not already in scope at that location, they are module functions already used by `content_add_root`; keep the same imports.)

- [ ] **Step 2: Add the new command** (after `content_add_root`)

```rust
/// `content_create_standard_root` — create the OS-standard content folder on disk
/// and register it as a forced root (it is empty, so it fails the normal Spring
/// layout check). Returns the recomputed state, so the caller learns the new id.
#[tauri::command]
async fn content_create_standard_root<R: Runtime>(app: AppHandle<R>) -> Result<CliResult, ()> {
    let base = base_dirs(&app, false);
    let Some(path) = paths::standard_root_path(current_os(), &base) else {
        return Ok(CliResult::err(
            "No standard content location is known for this platform.",
        ));
    };
    if let Err(e) = std::fs::create_dir_all(&path) {
        return Ok(CliResult::err(format!(
            "Couldn't create {}: {e}",
            path.display()
        )));
    }
    let canon = canonical(&path);
    match add_root_inner(&app, &canon, None, true, false) {
        Ok(state) => Ok(CliResult::ok(json!({ "state": state }))),
        Err(e) => Ok(CliResult::err(e)),
    }
}
```

Confirm `paths::standard_root_path`, `base_dirs`, `current_os`, `canonical` are reachable (all already used in `content_candidates`). Add `use crate::paths;` only if `paths::` isn't already how the file refers to it — check existing `candidate_roots` import at the top and match it.

- [ ] **Step 3: Register the command in the invoke handler AND ACL.**
  - In `lib.rs`, add `content_create_standard_root` to the `tauri::generate_handler![...]` list (find the existing list containing `content_add_root`).
  - In `build.rs`, add `"content_create_standard_root",` to the `COMMANDS` array.
  - In `permissions/default.toml`, add `"allow-content-create-standard-root",` to the `permissions` list.

- [ ] **Step 4: Build to verify it compiles + ACL generates**

Run: `cargo build -p tauri-plugin-coilbox-content`
Expected: builds clean; `permissions/autogenerated/commands/content_create_standard_root.toml` now exists.

- [ ] **Step 5: Run existing content tests (no regressions)**

Run: `cargo test -p tauri-plugin-coilbox-content`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add crates/tauri-plugin-coilbox-content/src/lib.rs crates/tauri-plugin-coilbox-content/build.rs crates/tauri-plugin-coilbox-content/permissions
git commit -m "content: content_create_standard_root command"
```

---

## Task 3: Frontend — binding + `useSetupStatus`

**Files:**
- Modify: `src/content/bindings.ts`
- Modify: `src/content/config.ts`
- Test: `src/content/config.test.ts` (create if absent)

- [ ] **Step 1: Add the binding** (in `src/content/bindings.ts`, near `contentAddRoot`)

```ts
/** Create the OS-standard content folder on disk and register it (forced). */
export const contentCreateStandardRoot = defineCommand<
  undefined,
  { state: ContentState }
>("coilbox-content", "content_create_standard_root");
```

Use the same `ContentState` type import the other content bindings use (check the top of `bindings.ts`).

- [ ] **Step 2: Write the failing test for the pure derivation** (in `src/content/config.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { deriveSetup } from "./config";
import type { ContentState } from "./bindings";

const root = (engines: number) => ({
  id: "r1", path: "/p", source: "manual", kind: "data",
  origins: [], exists: true, valid: true, counts: { games: 0, maps: 0, engines, packages: 0 },
  engines: Array.from({ length: engines }, (_, i) => ({ id: `e${i}`, rootPath: "/p", path: "/p/engine/x", executable: "spring", version: "1" })),
});

describe("deriveSetup", () => {
  it("needsFolder when no roots", () => {
    const s = deriveSetup({ schemaVersion: 1, roots: [] } as ContentState, "/std");
    expect(s).toMatchObject({ needsFolder: true, needsEngine: false, complete: false, standardPath: "/std" });
  });
  it("needsEngine when roots but no engines", () => {
    const s = deriveSetup({ schemaVersion: 1, roots: [root(0)] } as unknown as ContentState, "/std");
    expect(s).toMatchObject({ needsFolder: false, needsEngine: true, complete: false });
  });
  it("complete when a root has an engine", () => {
    const s = deriveSetup({ schemaVersion: 1, roots: [root(1)] } as unknown as ContentState, "/std");
    expect(s).toMatchObject({ needsFolder: false, needsEngine: false, complete: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bunx vitest run src/content/config.test.ts`
Expected: FAIL — `deriveSetup` is not exported.

- [ ] **Step 4: Implement `deriveSetup` + `useSetupStatus`** (in `src/content/config.ts`)

```ts
import { contentCandidates } from "./bindings";

export interface SetupStatus {
  needsFolder: boolean;
  needsEngine: boolean;
  complete: boolean;
  standardPath?: string;
}

/** Pure: what's missing for a playable setup, given content state + standard path. */
export function deriveSetup(
  state: ContentState | null,
  standardPath?: string,
): SetupStatus {
  const roots = state?.roots ?? [];
  const needsFolder = roots.length === 0;
  const hasEngine = roots.some((r) => r.engines.length > 0);
  const needsEngine = !needsFolder && !hasEngine;
  return { needsFolder, needsEngine, complete: !needsFolder && hasEngine, standardPath };
}

/** Setup status driven by live content state + the OS-standard candidate path. */
export function useSetupStatus() {
  const { state, loading, refresh } = useContentState();
  const [standardPath, setStandardPath] = useState<string | undefined>();
  useEffect(() => {
    contentCandidates(undefined)
      .then(({ candidates }) => {
        setStandardPath(candidates.find((c) => c.origin === "prd-default")?.path);
      })
      .catch(() => setStandardPath(undefined));
  }, []);
  return { ...deriveSetup(state, standardPath), loading, refresh };
}
```

Ensure `ContentState` is imported in `config.ts` (it already imports from `./bindings` for other hooks — add `ContentState` to that import if not present). `contentCandidates` returns `{ candidates: RootCandidate[] }` per `bindings.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run src/content/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/content/bindings.ts src/content/config.ts src/content/config.test.ts
git commit -m "content: useSetupStatus + contentCreateStandardRoot binding"
```

---

## Task 4: Frontend — download-dir auto-default

**Files:**
- Modify: `src/content/ContentStartupProvider.tsx`

Rationale: this provider is already mounted app-wide and loads content state on launch; back-filling the download destination here avoids a second provider (and the single-`Provider`-slot constraint). It reads/writes the downloads setting via `useDownloadsConfig`.

- [ ] **Step 1: Add the back-fill effect.** In `ContentStartupProvider.tsx`, import the downloads config hook and content state loader, and add an effect that sets `writeRootId` to the first root when unset:

```ts
import { useDownloadsConfig } from "../downloads/config";
import { contentStateLoad } from "./bindings";
```

Inside the provider component body:

```ts
const [dlConfig, setDlConfig] = useDownloadsConfig();
useEffect(() => {
  if (dlConfig.writeRootId) return; // user/already set — never override
  contentStateLoad(undefined)
    .then(({ state }) => {
      const first = state.roots[0];
      if (first) setDlConfig({ ...dlConfig, writeRootId: first.id });
    })
    .catch(() => {});
  // Re-check when the destination becomes unset; roots changes trigger via the
  // existing warm-up rescan which updates state read on next mount/effect.
}, [dlConfig, setDlConfig]);
```

Note: `useDownloadsConfig` is `useSetting<DownloadsConfig>` — `setDlConfig` persists. Guard on `dlConfig.writeRootId` so existing installs are untouched. Place this effect alongside the existing `warmUp` logic; it must not interfere with it.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 3: Manual sanity (deferred to Task 8 full run).** No unit test — this is provider glue over `useSetting`; verified in the end-to-end run.

- [ ] **Step 4: Commit**

```bash
git add src/content/ContentStartupProvider.tsx
git commit -m "content: default download dir to first content root when unset"
```

---

## Task 5: Frontend — engine install helper

**Files:**
- Create: `src/downloads/engineInstall.ts`
- Modify: `src/downloads/pages/components/EngineInstaller.tsx` (use the helper for its recoil path)

- [ ] **Step 1: Create the helper** (`src/downloads/engineInstall.ts`)

```ts
import type { Channel } from "@tauri-apps/api/core";
import { contentRescan } from "../content/bindings";
import {
  type DownloadProgress,
  dlDownloadEngineRecoil,
  dlRecoilEngines,
  type EngineRelease,
} from "./bindings";

/** The newest Recoil release for this platform, or null when none is available
 * (e.g. macOS). `releases` is newest-first from the backend. */
export async function fetchNewestRecoil(): Promise<{
  release: EngineRelease | null;
  platform: string;
}> {
  const { releases, platform } = await dlRecoilEngines(undefined);
  return { release: releases[0] ?? null, platform };
}

/** Download + install a Recoil release into `writePath`, then rescan content so
 * the engine is picked up. Throws on download failure. */
export async function installRecoil(
  release: EngineRelease,
  writePath: string,
  onProgress: Channel<DownloadProgress>,
): Promise<string> {
  const { message } = await dlDownloadEngineRecoil({
    version: release.version,
    assetUrl: release.assetUrl,
    writePath,
    onProgress,
  });
  try {
    await contentRescan(undefined);
  } catch {
    // non-fatal: engine is installed; the list just won't auto-refresh
  }
  return message;
}
```

- [ ] **Step 2: Use it in `EngineInstaller.tsx`'s recoil branch.** Replace the inline `dlDownloadEngineRecoil(...)` + `contentRescan` in `download()` (:109-128) for `source === "recoil"` with a call to `installRecoil(...)`. Keep the springfiles branch as-is. (The recoil `EngineItem` already carries `assetUrl`/`key`; build an `EngineRelease` from the item or thread the release through — simplest: keep EngineInstaller calling `dlDownloadEngineRecoil` but route through `installRecoil` by constructing `{ version: item.key, assetUrl: item.assetUrl ?? "", size: 0, prerelease: !!item.prerelease }`.)

- [ ] **Step 3: Typecheck + biome**

Run: `bun run typecheck` then `bunx biome ci .`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/downloads/engineInstall.ts src/downloads/pages/components/EngineInstaller.tsx
git commit -m "downloads: extract installRecoil / fetchNewestRecoil helper"
```

---

## Task 6: Frontend — `SetupCard` component

**Files:**
- Create: `src/content/pages/components/SetupCard.tsx`

- [ ] **Step 1: Implement `SetupCard`.** It renders nothing when `complete` or (for the home variant) dismissed. Uses `useSetupStatus`, `useWriteRootPath`, `contentCreateStandardRoot`, `fetchNewestRecoil`/`installRecoil`, `useSetting`. Steps:

```tsx
import { Button, useSetting } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { CheckCircle2, Download, FolderPlus, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { contentCreateStandardRoot } from "../../bindings";
import { useSetupStatus } from "../../config";
import type { DownloadProgress } from "../../../downloads/bindings";
import { useWriteRootPath } from "../../../downloads/config";
import { fetchNewestRecoil, installRecoil } from "../../../downloads/engineInstall";
import { ProgressBar } from "../../../downloads/pages/components/ProgressBar";
import { errMessage } from "../../../downloads/pages/components/states";

export function SetupCard({ dismissible = false }: { dismissible?: boolean }) {
  const { needsFolder, needsEngine, complete, standardPath, refresh } = useSetupStatus();
  const writePath = useWriteRootPath();
  const [dismissed, setDismissed] = useSetting<boolean>("setup.dismissed", false);
  const [busy, setBusy] = useState<null | "folder" | "engine">(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [newest, setNewest] = useState<{ version: string; available: boolean; platform: string } | null>(null);

  useEffect(() => {
    if (!needsEngine) return;
    fetchNewestRecoil()
      .then(({ release, platform }) =>
        setNewest({ version: release?.version ?? "", available: !!release, platform }))
      .catch(() => setNewest({ version: "", available: false, platform: "" }));
  }, [needsEngine]);

  if (complete) return null;
  if (dismissible && dismissed) return null;

  async function createFolder() {
    setBusy("folder"); setError(null);
    try { await contentCreateStandardRoot(undefined); await refresh(); }
    catch (e) { setError(errMessage(e)); }
    finally { setBusy(null); }
  }

  async function downloadEngine() {
    if (!writePath) { setError("No download destination set."); return; }
    setBusy("engine"); setError(null); setProgress(null);
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = (p) => setProgress(p);
    try {
      const { release } = await fetchNewestRecoil();
      if (!release) return; // handled by the "not available" branch below
      await installRecoil(release, writePath, onProgress);
      await refresh();
    } catch (e) { setError(errMessage(e)); }
    finally { setBusy(null); setProgress(null); }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Set up Coilbox</h2>
        <p className="text-xs text-muted-foreground">
          To play, Coilbox needs a content folder and a game engine.
        </p>
      </div>

      {needsFolder && (
        <Button onClick={createFolder} disabled={busy !== null}>
          {busy === "folder" ? <Loader2 className="animate-spin" /> : <FolderPlus />}
          {standardPath ? `Create folder at ${standardPath}` : "Create content folder"}
        </Button>
      )}

      {needsEngine && (
        newest?.available ? (
          <div className="space-y-2">
            <Button onClick={downloadEngine} disabled={busy !== null || !writePath}>
              {busy === "engine" ? <Loader2 className="animate-spin" /> : <Download />}
              {busy === "engine" ? "Installing…" : `Download newest engine${newest.version ? ` (${newest.version})` : ""}`}
            </Button>
            {busy === "engine" && progress && <ProgressBar progress={progress} />}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            An engine is required to play. No automatic download is available for
            your platform{newest?.platform ? ` (${newest.platform})` : ""} — install
            one from the <Link className="underline" to="/settings/engines">Engines page</Link>.
          </p>
        )
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {dismissible && (
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      )}
    </section>
  );
}
```

Confirm `useSetting` supports a `boolean` default (it's generic over the stored value; the settings cache serializes JSON — booleans round-trip). Confirm `ProgressBar` + `errMessage` import paths from `EngineInstaller.tsx` (they're `./ProgressBar` and `./states` there → from this file they are `../../../downloads/pages/components/...`).

- [ ] **Step 2: Typecheck + biome**

Run: `bun run typecheck` then `bunx biome ci .`
Expected: clean (biome may reorder imports — run `bunx biome check --write src/content/pages/components/SetupCard.tsx` if so).

- [ ] **Step 3: Commit**

```bash
git add src/content/pages/components/SetupCard.tsx
git commit -m "content: SetupCard component"
```

---

## Task 7: Frontend — Folders settings quick-create + home mount

**Files:**
- Modify: `src/content/pages/FoldersSection.tsx` (empty state ~:217-232)
- Create: `src/content/pages/SetupHome.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Folders empty-state quick-create.** In `FoldersSection.tsx`, in the empty-state block (the dashed box with the "Add folder" button, ~:217-232), add a primary quick-create button beside it. Reuse the existing `useSetupStatus` for `standardPath`, and call `contentCreateStandardRoot` then the section's existing refresh (the component already has an `onAdded`/`setState`/refresh path used by `pickAndAdd` — reuse it):

```tsx
// near the other imports
import { contentCreateStandardRoot } from "../bindings";
import { useSetupStatus } from "../config";

// inside the component
const { standardPath } = useSetupStatus();
async function createStandard() {
  const { state } = await contentCreateStandardRoot(undefined);
  setState(state); // same setter pickAndAdd uses to apply an add result
}

// in the empty-state JSX, before/beside the existing "Add folder" button:
{standardPath && (
  <Button onClick={createStandard}>Create folder at {standardPath}</Button>
)}
```

Match the exact setter/refresh name the file already uses after `contentAddRoot` (look at `pickAndAdd`, ~:65-83 — it applies `state` via `setState` or similar; reuse that exact call). Do not introduce a new refresh mechanism.

- [ ] **Step 2: Create `SetupHome`** (`src/content/pages/SetupHome.tsx`) — the home override that shows the card above the underlying home. picoframe has no home slot and does not export the default launcher, so this becomes the `/` page.

```tsx
import { SetupCard } from "./components/SetupCard";
import BrandedWelcome from "../../profile/BrandedWelcome";
import { getProfile } from "../../profile/profile";

/** The `/` page: a first-run setup card above the (branded or default) welcome. */
export default function SetupHome() {
  const hasWelcome = !!getProfile().welcome;
  return (
    <div className="flex flex-col gap-4 p-4">
      <SetupCard dismissible />
      {hasWelcome ? (
        <BrandedWelcome />
      ) : (
        <div className="text-sm text-muted-foreground">
          Welcome to Coilbox. Use the sidebar to browse content, host or join
          battles, and manage engines.
        </div>
      )}
    </div>
  );
}
```

Confirm `getProfile()` and `BrandedWelcome` import paths against `src/main.tsx` (it imports `BrandedWelcome from "./profile/BrandedWelcome"` and `loadProfile` from `./profile/profile`; `getProfile` is used elsewhere e.g. `game-updates`). If `getProfile` isn't exported from `profile/profile`, use the same accessor `game-updates/GameUpdatesProvider.tsx` uses.

- [ ] **Step 3: Wire `main.tsx`.** Replace the current `home` computation (main.tsx:80-82):

```tsx
// before:
const home: HomeOverride | undefined = profile.welcome
  ? { Component: BrandedWelcome }
  : undefined;
// after:
const home: HomeOverride = { Component: SetupHome };
```

Add `import SetupHome from "./content/pages/SetupHome";`. `SetupHome` internally renders `BrandedWelcome` when the profile has a welcome, so the existing `BrandedWelcome` import in `main.tsx` may become unused — if so, remove it (and only it).

- [ ] **Step 4: Typecheck + biome**

Run: `bun run typecheck` then `bunx biome ci .`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/content/pages/FoldersSection.tsx src/content/pages/SetupHome.tsx src/main.tsx
git commit -m "content: quick-create in Folders empty state + setup-aware home"
```

---

## Task 8: Full verification (manual, in-app)

**Files:** none.

- [ ] **Step 1: Full static suite**

Run each; all must pass:
```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test -p tauri-plugin-coilbox-content
bunx biome ci .
bun run typecheck
bunx vitest run src/content/config.test.ts
```

- [ ] **Step 2: Live E2E via `bun tauri dev`.** With NO content roots configured (move/rename `~/Library/Application Support/com.tomjn.coilbox/content/state.json` aside first to simulate a clean install), verify:
  1. Home shows the "Set up Coilbox" card with "Create folder at `<standard path>`".
  2. Click it → folder is created on disk, appears as a content root, and the card advances to the engine step. Confirm Downloads settings now shows a download destination WITHOUT having set one.
  3. Engine step shows "Download newest engine (v…)"; click → downloads with progress → rescan → card shows complete / hides.
  4. Content Folders settings empty state (with state.json aside again) shows the same "Create folder at …" button.
  5. Dismiss on the home card hides it and it stays hidden after reload; the Folders quick-create button remains.
  6. On a machine/platform with no auto engine (or by temporarily forcing `fetchNewestRecoil` to return none), the engine step clearly states an engine is required + links to Engines.

- [ ] **Step 3: Restore your real `state.json`** if you moved it.

---

## Notes / consequences to flag at review

- **Home replacement:** picoframe exposes no home slot and does not export its default launcher, so `SetupHome` becomes coilbox's `/` page for all users (setup card when incomplete; a one-line welcome or the branded welcome otherwise). This is a deliberate, minimal home — the sidebar nav is unchanged.
- **Provider slot / Group A:** this plan puts the download-dir default in `ContentStartupProvider` (not a new downloads `Provider`), so it does not collide with the `EngineDirsProvider` that PR #121 (Group A) adds as the downloads plugin's `Provider`.
