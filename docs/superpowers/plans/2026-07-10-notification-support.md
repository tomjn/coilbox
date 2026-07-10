# Notification Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app toasts (sonner) and native OS notifications to Coilbox, routed by window focus, with a settings toggle and three wired triggers (download complete/failed, app update available, game update available).

**Architecture:** A new `src/notify/` frame plugin exposes an imperative `notify()` helper that any code (React or plain modules) can call. A pure `route()` function decides toast-vs-OS from focus + settings + permission. A module-level prefs bridge lets the imperative helper read the enable-toggle and permission state that the React Provider pushes in. Triggers call `notify()`; the download trigger wraps the download-start bindings so all call sites are covered from one file.

**Tech Stack:** React 19, Tauri v2, `@tauri-apps/plugin-notification`, sonner (shadcn component), picoframe frame plugin SDK, vitest (node env).

---

## File Structure

**Create:**
- `src/notify/route.ts` — pure `route(focused, osEnabled, permGranted)` decision. No Tauri/sonner imports (node-testable).
- `src/notify/route.test.ts` — unit tests for `route()`.
- `src/notify/prefs.ts` — module-level in-memory bridge: OS-enabled flag + cached permission, get/set. Seeded by the React Provider.
- `src/notify/notify.ts` — imperative `notify()` IO helper + re-export of sonner `toast`.
- `src/notify/NotifyProvider.tsx` — mounts `<Toaster/>`, seeds prefs from `useSetting`, queries OS permission on mount.
- `src/notify/NotificationsSettings.tsx` — settings section (toggle, permission status/grant, test button).
- `src/notify/index.ts` — the `FramePlugin` (Provider + settings section).
- `src/components/ui/sonner.tsx` — shadcn sonner `Toaster`, adapted to picoframe's `useTheme`.
- `src/downloads/downloadNotify.ts` — `withDownloadNotify` wrapper factory.
- `src/downloads/downloadNotify.test.ts` — wrapper unit tests (notify module mocked).

**Modify:**
- `package.json` — add `@tauri-apps/plugin-notification` and `sonner`.
- `src-tauri/Cargo.toml` — add `tauri-plugin-notification`.
- `src-tauri/src/main.rs` — register the notification plugin.
- `src-tauri/capabilities/default.json` — add `notification:default`.
- `src/app.plugins.ts` — register `notifyPlugin`.
- `src/downloads/bindings.ts` — wrap the 5 download-start exports with `withDownloadNotify`.
- `src/updater/UpdaterProvider.tsx` — `notify()` when an update is found.
- `src/game-updates/GameUpdatesProvider.tsx` — `notify()` when `updateAvailable` flips true.

---

## Task 1: Install sonner (shadcn component) and adapt to picoframe theme

**Files:**
- Modify: `package.json` (adds `sonner`)
- Create: `src/components/ui/sonner.tsx`

- [ ] **Step 1: Pull the sonner component from the shadcn registry**

Run:
```bash
bunx shadcn@latest add sonner
```
Expected: adds `sonner` to dependencies and writes `src/components/ui/sonner.tsx`. If the CLI prompts or fails (offline/interactive), instead run `bun add sonner` and create the file in Step 2 by hand — Step 2 is the authoritative end-state either way.

- [ ] **Step 2: Adapt `src/components/ui/sonner.tsx` to picoframe's theme**

The shadcn default imports `useTheme` from `next-themes`, which this app does not use. Replace the whole file with picoframe's theme wiring (`useTheme().resolved` is `"light" | "dark"`):

```tsx
import { useTheme } from "@picoframe/frame";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App-wide toast host. Mounted once by the notify plugin's Provider. Themed from
 * picoframe's resolved appearance so toasts follow the app's light/dark mode.
 */
function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-right"
      richColors
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
```

- [ ] **Step 3: Verify the package is present and typechecks**

Run: `bun run typecheck`
Expected: PASS (no errors from `src/components/ui/sonner.tsx`).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb src/components/ui/sonner.tsx
git commit -m "feat(notify): add sonner toast component themed to picoframe"
```

---

## Task 2: Wire the OS notification backend plugin

**Files:**
- Modify: `package.json` (adds `@tauri-apps/plugin-notification`)
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs:82-85`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the JS and Rust packages**

Run:
```bash
bun add @tauri-apps/plugin-notification
```
Then add to `src-tauri/Cargo.toml` after the `tauri-plugin-process = "2"` line (around line 30):
```toml
tauri-plugin-notification = "2"
```

- [ ] **Step 2: Register the plugin in `src-tauri/src/main.rs`**

After the `.plugin(tauri_plugin_process::init())` line (line 84), add:
```rust
        .plugin(tauri_plugin_notification::init())
```

- [ ] **Step 3: Grant the capability**

In `src-tauri/capabilities/default.json`, add `"notification:default"` to the `permissions` array (after `"process:allow-exit"`):
```json
    "process:allow-exit",
    "notification:default"
```

- [ ] **Step 4: Verify the Rust crate compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS (downloads and compiles `tauri-plugin-notification`).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lockb src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/capabilities/default.json
git commit -m "feat(notify): register the tauri notification plugin and capability"
```

---

## Task 3: Pure focus/permission routing (`route`)

**Files:**
- Create: `src/notify/route.ts`
- Create: `src/notify/route.test.ts`

- [ ] **Step 1: Write the failing test**

`src/notify/route.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { route } from "./route";

describe("route", () => {
  it("uses a toast when the window is focused", () => {
    expect(route(true, true, true)).toBe("toast");
  });

  it("uses the OS when unfocused, enabled, and permission granted", () => {
    expect(route(false, true, true)).toBe("os");
  });

  it("falls back to a toast when OS notifications are disabled", () => {
    expect(route(false, false, true)).toBe("toast");
  });

  it("falls back to a toast when permission is not granted", () => {
    expect(route(false, true, false)).toBe("toast");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/notify/route.test.ts`
Expected: FAIL with "Cannot find module './route'".

- [ ] **Step 3: Implement `src/notify/route.ts`**

```ts
/** Where a notification should be delivered. */
export type NotifyChannel = "toast" | "os";

/**
 * Decide the delivery channel for a notification. Pure so it can be unit-tested
 * without Tauri or sonner. An OS banner is only used when the window is NOT
 * focused (an in-app toast is enough when the user is already looking), the user
 * has enabled OS notifications, and the OS permission has been granted. Every
 * other case falls back to an in-app toast.
 */
export function route(
  focused: boolean,
  osEnabled: boolean,
  permGranted: boolean,
): NotifyChannel {
  if (focused) return "toast";
  if (osEnabled && permGranted) return "os";
  return "toast";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/notify/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notify/route.ts src/notify/route.test.ts
git commit -m "feat(notify): pure focus/permission routing decision"
```

---

## Task 4: Prefs bridge and the `notify()` IO helper

**Files:**
- Create: `src/notify/prefs.ts`
- Create: `src/notify/notify.ts`

- [ ] **Step 1: Implement the prefs bridge `src/notify/prefs.ts`**

```ts
/**
 * A module-level bridge for state the imperative `notify()` helper needs but that
 * lives in React / Tauri. `main.tsx` owns the settings cache privately and the
 * frame's `useSetting` is React-only, so the NotifyProvider pushes the current
 * values in here; `notify()` (which may run outside React, e.g. from a download
 * binding) reads them synchronously. Defaults are safe pre-seed values.
 */
const prefs = {
  /** User toggle for OS notifications. Default on. */
  osEnabled: true,
  /** Cached OS permission grant. Assume not-granted until the Provider checks. */
  permGranted: false,
};

export function setOsEnabled(v: boolean): void {
  prefs.osEnabled = v;
}

export function setPermGranted(v: boolean): void {
  prefs.permGranted = v;
}

export function getOsEnabled(): boolean {
  return prefs.osEnabled;
}

export function getPermGranted(): boolean {
  return prefs.permGranted;
}
```

- [ ] **Step 2: Implement `src/notify/notify.ts`**

```ts
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { getOsEnabled, getPermGranted } from "./prefs";
import { route } from "./route";

/** Severity of a notification, mapped to a sonner toast style. */
export type NotifyLevel = "info" | "success" | "error";

export interface NotifyInput {
  title: string;
  body?: string;
  level?: NotifyLevel;
}

function showToast({ title, body, level = "info" }: NotifyInput): void {
  const opts = body ? { description: body } : undefined;
  if (level === "success") toast.success(title, opts);
  else if (level === "error") toast.error(title, opts);
  else toast(title, opts);
}

/**
 * Deliver a notification, routed by window focus. Focused -> in-app toast.
 * Unfocused (and OS notifications enabled + permission granted) -> native OS
 * banner plus a dock-bounce / taskbar-flash. Never throws: any failure in the OS
 * path is caught and downgraded to a toast so callers (including download
 * bindings) can fire-and-forget.
 */
export async function notify(input: NotifyInput): Promise<void> {
  let focused = true;
  try {
    focused = await getCurrentWindow().isFocused();
  } catch {
    focused = true; // best-effort; a toast is the safe default
  }

  if (route(focused, getOsEnabled(), getPermGranted()) === "toast") {
    showToast(input);
    return;
  }

  try {
    sendNotification({ title: input.title, body: input.body });
    await getCurrentWindow()
      .requestUserAttention(UserAttentionType.Informational)
      .catch(() => {});
  } catch {
    showToast(input);
  }
}

// Re-export sonner's imperative toast for foreground-only callers (e.g. the
// settings "test" button, or success/error feedback that never needs a banner).
export { toast };
```

- [ ] **Step 3: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS. (No test here — the IO helper is exercised manually in Task 9; its logic core `route` is already tested.)

- [ ] **Step 4: Commit**

```bash
git add src/notify/prefs.ts src/notify/notify.ts
git commit -m "feat(notify): imperative focus-aware notify() helper and prefs bridge"
```

---

## Task 5: Provider, settings section, and plugin registration

**Files:**
- Create: `src/notify/NotifyProvider.tsx`
- Create: `src/notify/NotificationsSettings.tsx`
- Create: `src/notify/index.ts`
- Modify: `src/app.plugins.ts`

- [ ] **Step 1: Implement `src/notify/NotifyProvider.tsx`**

Mounts the toast host and keeps the prefs bridge in sync with the React setting + OS permission.

```tsx
import { useSetting } from "@picoframe/frame";
import {
  isPermissionGranted,
} from "@tauri-apps/plugin-notification";
import { type ReactNode, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { setOsEnabled, setPermGranted } from "./prefs";

export const NOTIFY_OS_ENABLED_KEY = "notifications.os.enabled";

/**
 * App-wide: mounts the sonner toast host and mirrors the user's OS-notification
 * toggle and the current OS permission grant into the prefs bridge, so the
 * imperative notify() helper can read them synchronously from anywhere.
 */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [osEnabled] = useSetting<boolean>(NOTIFY_OS_ENABLED_KEY, true);

  useEffect(() => {
    setOsEnabled(osEnabled);
  }, [osEnabled]);

  useEffect(() => {
    isPermissionGranted()
      .then(setPermGranted)
      .catch(() => setPermGranted(false));
  }, []);

  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
```

- [ ] **Step 2: Implement `src/notify/NotificationsSettings.tsx`**

```tsx
import { Button, useSetting } from "@picoframe/frame";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { notify } from "./notify";
import { NOTIFY_OS_ENABLED_KEY } from "./NotifyProvider";
import { setPermGranted } from "./prefs";

/** Settings section at /settings/notifications. */
export default function NotificationsSettings() {
  const [osEnabled, setOsEnabled] = useSetting<boolean>(
    NOTIFY_OS_ENABLED_KEY,
    true,
  );
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    isPermissionGranted()
      .then(setGranted)
      .catch(() => setGranted(false));
  }, []);

  const grant = async () => {
    const result = await requestPermission();
    const ok = result === "granted";
    setGranted(ok);
    setPermGranted(ok);
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-sm font-medium">Desktop notifications</span>
          <span className="text-xs text-muted-foreground">
            Show a native notification when the app is in the background.
          </span>
        </span>
        <Switch checked={osEnabled} onCheckedChange={setOsEnabled} />
      </label>

      <div className="flex items-center gap-3">
        {granted === null ? (
          <span className="text-sm text-muted-foreground">
            Checking permission…
          </span>
        ) : granted ? (
          <span className="text-sm text-muted-foreground">
            Permission granted.
          </span>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              Permission not granted.
            </span>
            <Button onClick={() => void grant()}>Grant permission</Button>
          </>
        )}
      </div>

      <div>
        <Button
          onClick={() =>
            void notify({
              title: "Coilbox",
              body: "Test notification",
              level: "success",
            })
          }
        >
          Send test notification
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/notify/index.ts`**

```ts
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Bell } from "lucide-react";
import NotificationsSettings from "./NotificationsSettings";
import { NotifyProvider } from "./NotifyProvider";

/**
 * Frame-level notifications plugin. Mounts the app-wide sonner toast host and
 * contributes a "Notifications" settings section (OS toggle + permission grant +
 * test). Notification triggers live at their event sources and call the
 * imperative `notify()` helper directly.
 */
const notifyPlugin: FramePlugin = {
  id: "notify",
  version: "0.0.0",
  routes: [],
  Provider: NotifyProvider,
  settings: [
    {
      id: "notifications",
      title: "Notifications",
      icon: Bell,
      Component: NotificationsSettings,
    },
  ],
};

export default notifyPlugin;
```

- [ ] **Step 4: Register the plugin in `src/app.plugins.ts`**

Add the import next to the other frame-level plugins (after the `import updaterPlugin` line, line 16):
```ts
import notifyPlugin from "./notify";
```
Add it to the `plugins` array after `gameUpdatesPlugin` (line 37):
```ts
  gameUpdatesPlugin,
  notifyPlugin,
```

- [ ] **Step 5: Verify typecheck and lint**

Run: `bun run typecheck && bunx biome check src/notify src/app.plugins.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/notify/NotifyProvider.tsx src/notify/NotificationsSettings.tsx src/notify/index.ts src/app.plugins.ts
git commit -m "feat(notify): toast host, notifications settings section, plugin registration"
```

---

## Task 6: Trigger — download complete / failed

**Files:**
- Create: `src/downloads/downloadNotify.ts`
- Create: `src/downloads/downloadNotify.test.ts`
- Modify: `src/downloads/bindings.ts`

- [ ] **Step 1: Write the failing test `src/downloads/downloadNotify.test.ts`**

The notify module is mocked so the test stays in the node env (no sonner/Tauri load).

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn();
vi.mock("../notify/notify", () => ({ notify }));

import { withDownloadNotify } from "./downloadNotify";

describe("withDownloadNotify", () => {
  beforeEach(() => notify.mockClear());

  it("notifies success and resolves with the original value", async () => {
    const inner = vi.fn().mockResolvedValue({ ok: 1 });
    const wrapped = withDownloadNotify(inner, (a: { tag: string }) => a.tag);
    await expect(wrapped({ tag: "byar:test" })).resolves.toEqual({ ok: 1 });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ level: "success", body: "byar:test" }),
    );
  });

  it("notifies error and re-throws on failure", async () => {
    const boom = new Error("disk full");
    const inner = vi.fn().mockRejectedValue(boom);
    const wrapped = withDownloadNotify(inner, (a: { tag: string }) => a.tag);
    await expect(wrapped({ tag: "byar:test" })).rejects.toThrow("disk full");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", body: "byar:test" }),
    );
  });

  it("does not notify when the download was cancelled", async () => {
    const inner = vi.fn().mockRejectedValue(new Error("download cancelled"));
    const wrapped = withDownloadNotify(inner, (a: { tag: string }) => a.tag);
    await expect(wrapped({ tag: "byar:test" })).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/downloads/downloadNotify.test.ts`
Expected: FAIL with "Cannot find module './downloadNotify'".

- [ ] **Step 3: Implement `src/downloads/downloadNotify.ts`**

```ts
import { notify } from "../notify/notify";

/** Cancellations are intentional — never surface them as a failure. */
function isCancellation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /cancel/i.test(msg);
}

/**
 * Wrap a download-start binding so it fires a notification when the download
 * settles: a success toast/banner on resolve, a failure one on reject (except
 * cancellations, which are user-intended). `label` derives a human-readable name
 * from the call's args (tag / springname / filename / version). The original
 * result is returned and the original error re-thrown, so callers' progress UIs
 * and catch blocks are unaffected — the notification is a pure side effect.
 */
export function withDownloadNotify<A, D>(
  fn: (args: A) => Promise<D>,
  label: (args: A) => string,
): (args: A) => Promise<D> {
  return async (args: A) => {
    try {
      const result = await fn(args);
      void notify({
        title: "Download complete",
        body: label(args),
        level: "success",
      });
      return result;
    } catch (e) {
      if (!isCancellation(e)) {
        void notify({
          title: "Download failed",
          body: label(args),
          level: "error",
        });
      }
      throw e;
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/downloads/downloadNotify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wrap the download-start exports in `src/downloads/bindings.ts`**

Add the import at the top (after the existing imports, around line 2):
```ts
import { withDownloadNotify } from "./downloadNotify";
```

Then wrap the five start commands. For each, keep the export name but pass the `defineCommand(...)` result and a label extractor through `withDownloadNotify`. Replace the existing `export const dlDownload = defineCommand<...>(...)` at line 61 with:

```ts
export const dlDownload = withDownloadNotify(
  defineCommand<
    {
      tag: string;
      masterUrl?: string;
      writePath?: string;
      opId?: string;
      onProgress: Channel<DownloadProgress>;
    },
    { message: string; tag: string }
  >("coilbox-downloads", "dl_download"),
  (a) => a.tag,
);
```

Apply the same treatment to the other four (their `defineCommand<...>(...)` bodies are unchanged — only the `withDownloadNotify(..., label)` wrapper and label are added). Exact arg field names, confirmed against the definitions in this file:
- `dlDownloadMap` (arg key `springName: string`) → label `(a) => a.springName`.
- `dlDownloadFile` (arg key `filename: string`) → label `(a) => a.filename`.
- `dlDownloadEngineRecoil` (arg key `version: string`) → label `(a) => \`Engine ${a.version}\``.
- `dlDownloadEngineSpring` (arg key `version: string`) → label `(a) => \`Engine ${a.version}\``.

Do not change the `defineCommand` type arguments or ACL ids — only wrap the returned function.

- [ ] **Step 6: Verify typecheck, lint, and the full test run**

Run: `bun run typecheck && bunx vitest run && bunx biome check src/downloads`
Expected: PASS. Confirm no caller of the wrapped bindings broke (the wrapper preserves the `(args) => Promise<Data>` shape).

- [ ] **Step 7: Commit**

```bash
git add src/downloads/downloadNotify.ts src/downloads/downloadNotify.test.ts src/downloads/bindings.ts
git commit -m "feat(notify): notify on download completion and failure"
```

---

## Task 7: Trigger — app update available

**Files:**
- Modify: `src/updater/UpdaterProvider.tsx:53-65`

- [ ] **Step 1: Add the notify import**

At the top of `src/updater/UpdaterProvider.tsx`, add:
```ts
import { notify } from "../notify/notify";
```

- [ ] **Step 2: Fire the notification when an update is found**

In `runCheck`, after `setUpdate(found);` (line 58), add a guarded notify so it only fires when a newer release actually exists:
```ts
      setUpdate(found);
      if (found) {
        void notify({
          title: "Update available",
          body: `Coilbox ${found.version} is ready to install.`,
          level: "info",
        });
      }
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS. (`found` is `Update | null`; `found.version` is valid inside the guard.)

- [ ] **Step 4: Commit**

```bash
git add src/updater/UpdaterProvider.tsx
git commit -m "feat(notify): notify when an app update is available"
```

---

## Task 8: Trigger — game update available

**Files:**
- Modify: `src/game-updates/GameUpdatesProvider.tsx`

`updateAvailable` is a derived `useMemo` boolean. Fire once when it transitions false→true, using a ref to avoid re-notifying on every re-render.

- [ ] **Step 1: Add imports**

At the top of `src/game-updates/GameUpdatesProvider.tsx`, extend the React import to include `useRef` and add the notify import:
```ts
import { notify } from "../notify/notify";
```
Ensure `useRef` is in the existing `react` import list (it currently imports `createContext, useCallback, useContext, useEffect, useMemo, useState`).

- [ ] **Step 2: Notify on the false→true transition**

After the `updateAvailable` `useMemo` block (ends line 121), add:
```ts
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (updateAvailable && !notifiedRef.current) {
      notifiedRef.current = true;
      void notify({
        title: "Game update available",
        body: "A newer game version is available to download.",
        level: "info",
      });
    }
    if (!updateAvailable) notifiedRef.current = false;
  }, [updateAvailable]);
```

- [ ] **Step 3: Verify typecheck and lint**

Run: `bun run typecheck && bunx biome check src/game-updates`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/game-updates/GameUpdatesProvider.tsx
git commit -m "feat(notify): notify when a game update is available"
```

---

## Task 9: Full verification and manual test

**Files:** none (verification only)

- [ ] **Step 1: Run the exact CI checks**

Run:
```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
bunx biome ci .
bun run typecheck
bun run test
```
Expected: all PASS. Fix any failures before proceeding (run `cargo fmt --all` if the fmt check fails).

- [ ] **Step 2: Manual test via the running app**

Run: `bun tauri dev`

Verify:
1. Settings → Notifications section exists; toggle + "Grant permission" + "Send test notification" render.
2. Click "Send test notification" with the window focused → an in-app toast appears (no OS banner).
3. Click "Grant permission", accept the OS prompt → status shows "Permission granted."
4. Background the window, then trigger a real download (Downloads → Games/Maps) → on completion an OS banner appears and the dock icon bounces / taskbar flashes.
5. With the window focused, trigger a download → a success toast appears (no OS banner).
6. Toggle "Desktop notifications" off, background the window, complete a download → only a toast is queued, no OS banner.

Report the actual observed result for each numbered check. Do not claim success for any check not actually observed.

- [ ] **Step 3: Final commit (if manual testing required any fixes)**

```bash
git add -p
git commit -m "fix(notify): address manual test findings"
```

---

## Self-Review Notes

- **Spec coverage:** infra (toast host + notify helper + settings) = Tasks 1,3,4,5; OS backend = Task 2; focus-aware routing = Task 3/4; three triggers = Tasks 6,7,8. All spec sections mapped.
- **Type consistency:** `notify(NotifyInput)`, `route(boolean,boolean,boolean)`, `withDownloadNotify(fn,label)`, `NOTIFY_OS_ENABLED_KEY`, prefs get/set names are used identically across tasks.
- **Known limitation (from spec):** automatic/background downloads (branding prefetch, conquest mid-battle map) also fire a toast; focus-aware routing keeps them to a toast (never an OS banner). Gate later only if noisy.
- **Cancellation guard:** the download wrapper suppresses `/cancel/i` errors so user-cancelled downloads don't show "Download failed".
```
