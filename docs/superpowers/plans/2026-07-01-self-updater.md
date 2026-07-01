# Coilbox Self-Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app detection and one-click installation of new Coilbox releases using Tauri v2's official updater plugin against GitHub Releases.

**Architecture:** A new frame-level `updater` picoframe plugin (`src/updater/`) wraps `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`. It contributes a `topbar.right` "update available" pill and an "Updates" settings section, and uses `FramePlugin.Provider` (the same startup hook the `content` plugin uses) to fire one background check on launch in release builds only. The Rust side registers the two Tauri plugins and grants their ACL permissions; CI signs artifacts and emits `latest.json` to the GitHub release.

**Tech Stack:** Tauri v2, React 19, picoframe frame/plugin-sdk, `tauri-plugin-updater`, `tauri-plugin-process`.

**Verification note (deviation from TDD default):** This project has no frontend test harness (no vitest) and the app crate has no unit tests; per `CLAUDE.md`, verification is `bun tauri dev` + the Tauri MCP. The updater is integration-shaped (network + bundle replacement) with no meaningful pure logic to unit-test. This plan therefore verifies via `bun run typecheck`, `bunx biome check .`, `cargo fmt`/`cargo clippy`, a `bun tauri dev` smoke through the Tauri MCP, and a real end-to-end release test (Task 10). Adding a test framework is intentionally out of scope.

---

## Spec reference

`docs/superpowers/specs/2026-07-01-self-updater-design.md`

## File map

- Create: `src/updater/updater.ts` — thin async wrapper over the Tauri updater/process/app APIs.
- Create: `src/updater/UpdaterProvider.tsx` — React context + provider holding shared state; fires the launch check.
- Create: `src/updater/UpdateBadge.tsx` — the `topbar.right` pill.
- Create: `src/updater/pages/UpdatesSettingsSection.tsx` — the "Updates" settings section UI.
- Create: `src/updater/index.ts` — the `FramePlugin` definition.
- Modify: `src/app.plugins.ts` — register the plugin.
- Modify: `src-tauri/Cargo.toml` — add the two Rust plugin crates.
- Modify: `src-tauri/src/main.rs` — register the two plugins.
- Modify: `src-tauri/capabilities/default.json` — grant updater/process permissions.
- Modify: `src-tauri/tauri.conf.json` — add `plugins.updater` (endpoint + pubkey).
- Modify: `.github/workflows/release.yml` — pass signing env to tauri-action.
- Modify: `package.json` — add the two JS packages (via `bun add`).

---

## Task 0: One-time signing key (HUMAN PREREQUISITE — blocking, not code)

This cannot be automated; a human must hold the private key. Do this before Task 2's build succeeds meaningfully.

- [ ] **Step 1: Generate the minisign keypair**

Run:
```bash
bunx tauri signer generate -w ~/.tauri/coilbox-updater.key
```
This prints a **public key** (a base64 blob) and writes the password-protected private key to `~/.tauri/coilbox-updater.key`. Record the password you set.

- [ ] **Step 2: Store the private key + password as GitHub Actions secrets**

In the `tomjn/coilbox` repo settings → Secrets and variables → Actions, add:
- `TAURI_SIGNING_PRIVATE_KEY` = the full contents of `~/.tauri/coilbox-updater.key`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password from Step 1.

Using `gh`:
```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/coilbox-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

- [ ] **Step 3: Keep the public key handy** — it goes into `tauri.conf.json` in Task 2. Losing the private key means future releases can't be signed to update older installs, so back it up securely.

---

## Task 1: Register the Rust plugins + grant permissions

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs:78-89`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the Rust dependencies**

In `src-tauri/Cargo.toml`, below the existing `tauri-plugin-opener = "2"` line (currently line 22), add:
```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Register the plugins in the builder**

In `src-tauri/src/main.rs`, the builder chain currently ends at:
```rust
    let mut builder = tauri::Builder::default()
        .plugin(picoframe_core::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
```
Change the last line and add the two plugins:
```rust
    let mut builder = tauri::Builder::default()
        .plugin(picoframe_core::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
```

- [ ] **Step 3: Grant the ACL permissions**

Plugin commands are runtime-blocked without a capability. In `src-tauri/capabilities/default.json`, change the permissions array to:
```json
  "permissions": [
    "core:default",
    "opener:default",
    "updater:default",
    "process:allow-restart"
  ]
```

- [ ] **Step 4: Verify it compiles**

Run:
```bash
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: builds successfully (new crates fetched). If it fails on a missing `plugins.updater.pubkey`, that's resolved in Task 2 — proceed there, then re-run.

- [ ] **Step 5: Commit**
```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/capabilities/default.json
git commit -m "feat(updater): register tauri updater + process plugins"
```

---

## Task 2: Configure the updater endpoint + public key

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add the `plugins.updater` block**

In `src-tauri/tauri.conf.json`, add a top-level `plugins` key (sibling of `bundle`). Paste the **public key** from Task 0 Step 1 as the `pubkey` value (it must be the key content, not a path):
```json
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/tomjn/coilbox/releases/latest/download/latest.json"
      ],
      "pubkey": "PASTE_PUBLIC_KEY_FROM_TASK_0_HERE"
    }
  }
```

- [ ] **Step 2: Verify config is valid and the app crate builds**

Run:
```bash
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: builds successfully with the pubkey present.

- [ ] **Step 3: Commit**
```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(updater): point updater at GitHub releases latest.json + pubkey"
```

---

## Task 3: Add the JS packages

**Files:**
- Modify: `package.json`, `bun.lock`

- [ ] **Step 1: Install**
```bash
bun add @tauri-apps/plugin-updater @tauri-apps/plugin-process
```
Expected: both appear under `dependencies` in `package.json`.

- [ ] **Step 2: Commit**
```bash
git add package.json bun.lock
git commit -m "feat(updater): add updater + process JS plugins"
```

---

## Task 4: The updater API wrapper module

**Files:**
- Create: `src/updater/updater.ts`

- [ ] **Step 1: Write the module**

Create `src/updater/updater.ts`:
```ts
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** Download progress for the settings-section progress bar. */
export type DownloadPhase =
  | { status: "idle" }
  | { status: "downloading"; downloaded: number; total?: number }
  | { status: "installed" };

/** Check GitHub for a newer release. Resolves null when up to date. */
export async function checkForUpdate(): Promise<Update | null> {
  return check();
}

/** The running app's version (from tauri.conf.json, injected from the git tag in CI). */
export async function currentVersion(): Promise<string> {
  return getVersion();
}

/**
 * Download + install an update, reporting progress. Accumulates chunk lengths
 * from the Tauri download events into a running byte count.
 */
export async function installUpdate(
  update: Update,
  onProgress: (phase: DownloadPhase) => void,
): Promise<void> {
  let total: number | undefined;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength;
        onProgress({ status: "downloading", downloaded: 0, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({ status: "downloading", downloaded, total });
        break;
      case "Finished":
        onProgress({ status: "installed" });
        break;
    }
  });
}

export { relaunch };
export type { Update };
```

- [ ] **Step 2: Typecheck**
```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add src/updater/updater.ts
git commit -m "feat(updater): API wrapper over tauri updater/process"
```

---

## Task 5: The provider + context (shared state + launch check)

**Files:**
- Create: `src/updater/UpdaterProvider.tsx`

- [ ] **Step 1: Write the provider**

Create `src/updater/UpdaterProvider.tsx`:
```tsx
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  checkForUpdate,
  currentVersion,
  type DownloadPhase,
  installUpdate,
  relaunch,
  type Update,
} from "./updater";

interface UpdaterContextValue {
  /** Running app version, or null before it loads. */
  version: string | null;
  /** Non-null when a newer release is available. */
  update: Update | null;
  checking: boolean;
  /** Epoch ms of the last completed check, or null. */
  lastChecked: number | null;
  error: string | null;
  progress: DownloadPhase;
  /** True once install finished; caller should offer a restart. */
  installed: boolean;
  runCheck: () => Promise<void>;
  runInstall: () => Promise<void>;
  restart: () => Promise<void>;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

/** Access updater state. Must be used within <UpdaterProvider>. */
export function useUpdater(): UpdaterContextValue {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdater must be used within UpdaterProvider");
  return ctx;
}

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadPhase>({ status: "idle" });
  const [installed, setInstalled] = useState(false);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const found = await checkForUpdate();
      setUpdate(found);
      setLastChecked(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  const runInstall = useCallback(async () => {
    if (!update) return;
    setError(null);
    try {
      await installUpdate(update, setProgress);
      setInstalled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress({ status: "idle" });
    }
  }, [update]);

  const restart = useCallback(() => relaunch(), []);

  // Load the current version once.
  useEffect(() => {
    currentVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  // Fire one background check on launch — release builds only. Dev builds ship
  // the 0.0.0 placeholder version and would treat every release as newer.
  useEffect(() => {
    if (!import.meta.env.DEV) void runCheck();
  }, [runCheck]);

  return (
    <UpdaterContext.Provider
      value={{
        version,
        update,
        checking,
        lastChecked,
        error,
        progress,
        installed,
        runCheck,
        runInstall,
        restart,
      }}
    >
      {children}
    </UpdaterContext.Provider>
  );
}
```

- [ ] **Step 2: Typecheck**
```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add src/updater/UpdaterProvider.tsx
git commit -m "feat(updater): provider with shared state + launch check"
```

---

## Task 6: The topbar pill

**Files:**
- Create: `src/updater/UpdateBadge.tsx`

- [ ] **Step 1: Write the badge**

Create `src/updater/UpdateBadge.tsx`. It renders nothing when up to date; otherwise a pill linking to the Updates settings section (`/settings/updates`):
```tsx
import { Download } from "lucide-react";
import { Link } from "react-router";
import { useUpdater } from "./UpdaterProvider";

/** topbar.right slot: an "Update available" pill, shown only when an update exists. */
export default function UpdateBadge() {
  const { update } = useUpdater();
  if (!update) return null;
  return (
    <Link
      to="/settings/updates"
      className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
    >
      <Download size={14} />
      Update available
    </Link>
  );
}
```

- [ ] **Step 2: Typecheck**
```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add src/updater/UpdateBadge.tsx
git commit -m "feat(updater): topbar update-available pill"
```

---

## Task 7: The Updates settings section

**Files:**
- Create: `src/updater/pages/UpdatesSettingsSection.tsx`

- [ ] **Step 1: Write the section**

Create `src/updater/pages/UpdatesSettingsSection.tsx`. In dev it shows the version and a disabled note (auto-check is off and installs can't verify); in release it exposes check/install/restart:
```tsx
import { Button } from "@picoframe/frame";
import { useUpdater } from "../UpdaterProvider";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Settings section at /settings/updates. */
export default function UpdatesSettingsSection() {
  const {
    version,
    update,
    checking,
    lastChecked,
    error,
    progress,
    installed,
    runCheck,
    runInstall,
    restart,
  } = useUpdater();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm text-muted-foreground">Current version</div>
        <div className="text-lg font-medium">{version ?? "…"}</div>
      </div>

      {import.meta.env.DEV ? (
        <p className="text-sm text-muted-foreground">
          Updates are disabled in development builds.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button onClick={() => void runCheck()} disabled={checking}>
              {checking ? "Checking…" : "Check for updates"}
            </Button>
            {lastChecked && (
              <span className="text-xs text-muted-foreground">
                Last checked {new Date(lastChecked).toLocaleTimeString()}
              </span>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {!update && lastChecked && !checking && (
            <p className="text-sm text-muted-foreground">You're up to date.</p>
          )}

          {update && (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="font-medium">Version {update.version} available</div>
              {update.body && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-sm text-muted-foreground">
                  {update.body}
                </pre>
              )}

              {installed ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm">Installed — restart to apply.</span>
                  <Button onClick={() => void restart()}>Restart now</Button>
                </div>
              ) : progress.status === "downloading" ? (
                <div className="text-sm text-muted-foreground">
                  Downloading… {formatBytes(progress.downloaded)}
                  {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
                </div>
              ) : (
                <Button onClick={() => void runInstall()}>Download &amp; install</Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**
```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add src/updater/pages/UpdatesSettingsSection.tsx
git commit -m "feat(updater): Updates settings section"
```

---

## Task 8: The plugin definition + registration

**Files:**
- Create: `src/updater/index.ts`
- Modify: `src/app.plugins.ts`

- [ ] **Step 1: Write the plugin**

Create `src/updater/index.ts`:
```ts
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Download } from "lucide-react";
import UpdateBadge from "./UpdateBadge";
import { UpdaterProvider } from "./UpdaterProvider";
import UpdatesSettingsSection from "./pages/UpdatesSettingsSection";

/**
 * Frame-level updater plugin. Wraps the Tauri updater/process plugins to detect
 * and install new GitHub releases. Contributes a topbar "update available" pill
 * and an "Updates" settings section at /settings/updates. The Provider fires one
 * background check on launch (release builds only).
 */
const updaterPlugin: FramePlugin = {
  id: "updater",
  version: "0.0.0",
  routes: [],
  Provider: UpdaterProvider,
  slots: [{ slot: "topbar.right", order: 0, Component: UpdateBadge }],
  settings: [
    {
      id: "updates",
      title: "Updates",
      icon: Download,
      Component: UpdatesSettingsSection,
    },
  ],
};

export default updaterPlugin;
```

- [ ] **Step 2: Register in `app.plugins.ts`**

In `src/app.plugins.ts`, add the import alongside the others (outside the `picoframe:imports` markers, since those are tool-managed):
```ts
import updaterPlugin from "./updater";
```
and add `updaterPlugin,` to the `plugins` array (e.g. after `playPlugin,`, outside the `picoframe:plugins` markers).

- [ ] **Step 3: Typecheck + lint**
```bash
bun run typecheck
bunx biome check .
```
Expected: both clean.

- [ ] **Step 4: Commit**
```bash
git add src/updater/index.ts src/app.plugins.ts
git commit -m "feat(updater): register updater plugin in the frame"
```

---

## Task 9: CI signing

**Files:**
- Modify: `.github/workflows/release.yml:101-108`

- [ ] **Step 1: Pass signing env to tauri-action**

In `.github/workflows/release.yml`, the tauri-action step's `env:` currently only sets `GITHUB_TOKEN`. Add the two signing secrets so tauri-action signs artifacts and uploads `latest.json`:
```yaml
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Coilbox ${{ github.ref_name }}"
          releaseDraft: true
          prerelease: false
```
(tauri-action generates and uploads `latest.json` automatically when a signing key is present; `releaseDraft: true` is unchanged — the updater endpoint only resolves once the draft is published.)

- [ ] **Step 2: Commit**
```bash
git add .github/workflows/release.yml
git commit -m "ci(updater): sign release artifacts + emit latest.json"
```

---

## Task 10: End-to-end validation

No automated test covers self-update; validate manually. Run the static checks first, then a dev smoke, then a real release round-trip.

- [ ] **Step 1: Full lint suite (CI parity, per CLAUDE.md)**
```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
bunx biome ci .
bun run typecheck
```
Expected: all pass.

- [ ] **Step 2: Dev smoke via the app**

Run `bun tauri dev`. Using the Tauri MCP:
- Navigate to `/settings/updates`; confirm the section renders, shows the current version, and shows "Updates are disabled in development builds."
- Confirm the topbar pill is absent (no update in dev).
Expected: no console errors from the updater plugin.

- [ ] **Step 3: Release round-trip (the real test)**

1. Cut a release tag at a base version (e.g. `0.4.0`), let CI build, then **publish** the drafted release. Confirm the release assets include `latest.json` and per-artifact `.sig` files.
2. Install that build. Then tag + build + publish a higher version (e.g. `0.4.1`).
3. Launch the `0.4.0` install. Verify: the topbar pill appears, `/settings/updates` shows `0.4.1` + release notes, "Download & install" shows progress, and "Restart now" relaunches into `0.4.1` (`getVersion()` / the version display now reads `0.4.1`).
- Validate on **macOS arm64** (the ad-hoc-signed, unnotarized `.app` must reopen cleanly past Gatekeeper after self-replacement — this is the flagged risk), **Linux AppImage**, and **Windows**.

- [ ] **Step 4: Offline / pre-publish behaviour**

With no network (or before the first `latest.json` is published), launch a release build. Verify the launch check fails silently (no error dialog, no pill), and that a manual "Check for updates" in the settings section surfaces the error inline.

---

## Self-review

- **Spec coverage:** package/plugin (Tasks 1,3,4,5,8) · topbar pill (Task 6) · Updates settings section (Task 7) · launch-check + dev guard (Task 5) · endpoint/pubkey (Task 2) · CI signing/latest.json (Task 9) · capabilities (Task 1) · key-gen prerequisite (Task 0) · macOS/Linux/offline risk validation (Task 10). All spec sections mapped.
- **Placeholders:** the only fill-in is the generated public key (Task 2 Step 1), which is a real human-produced value, not a deferred implementation.
- **Type consistency:** `DownloadPhase`, `Update`, `checkForUpdate`, `currentVersion`, `installUpdate`, `relaunch` defined in Task 4 and consumed unchanged in Task 5; `useUpdater` shape defined in Task 5 and consumed in Tasks 6–7; settings id `updates` ↔ pill link `/settings/updates` consistent.
