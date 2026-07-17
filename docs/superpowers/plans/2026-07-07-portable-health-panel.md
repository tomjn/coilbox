# Portable-mode Health Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a health-checklist to Settings > Distribution profile that surfaces the state and misconfigurations of a portable Coilbox distribution (8 checks).

**Architecture:** A pure `deriveHealthChecks(inputs) → HealthCheck[]` core (unit-tested, no React/Tauri), a thin `useHealthChecks()` hook that fetches async inputs, and a dumb `HealthChecklist` renderer dropped into `ProfileSettings`. One new Rust command (`dl_path_writable`) and one new profile getter (`getProfileError()`) supply the two inputs not already available; everything else composes existing bindings.

**Tech Stack:** React + TypeScript frontend (Vitest tests), Rust Tauri plugin (`tauri-plugin-coilbox-downloads`), picoframe UI primitives.

---

## File structure

**Create:**
- `src/profile/health.ts` — types + pure `deriveHealthChecks(inputs): HealthCheck[]`.
- `src/profile/health.test.ts` — Vitest tests for the pure core.
- `src/profile/useHealthChecks.ts` — hook assembling async inputs → `HealthCheck[]`.
- `src/profile/HealthChecklist.tsx` — dumb renderer.

**Modify:**
- `src/profile/profile.ts` — retain + expose `getProfileError()`.
- `src/profile/SettingsSection.tsx` — render `<HealthChecklist>` under the facts `<dl>`.
- `src/downloads/bindings.ts` — add `dlPathWritable` binding.
- `crates/tauri-plugin-coilbox-downloads/src/lib.rs` — add `dl_path_writable` command + register it.
- `crates/tauri-plugin-coilbox-downloads/build.rs` — add `"dl_path_writable"` to `COMMANDS`.
- `crates/tauri-plugin-coilbox-downloads/permissions/default.toml` — add `"allow-dl-path-writable"`.

---

## Task 1: Rust `dl_path_writable` command

**Files:**
- Modify: `crates/tauri-plugin-coilbox-downloads/src/lib.rs`
- Modify: `crates/tauri-plugin-coilbox-downloads/build.rs`
- Modify: `crates/tauri-plugin-coilbox-downloads/permissions/default.toml`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `crates/tauri-plugin-coilbox-downloads/src/lib.rs`, inside (or adding) a `#[cfg(test)] mod tests`:

```rust
#[cfg(test)]
mod writable_tests {
    use super::probe_writable;

    #[test]
    fn writable_dir_reports_true() {
        let dir = std::env::temp_dir();
        let (writable, err) = probe_writable(dir.to_str().unwrap());
        assert!(writable, "temp dir should be writable, got err: {err:?}");
        assert!(err.is_none());
    }

    #[test]
    fn missing_dir_reports_false() {
        let (writable, err) = probe_writable("/no/such/path/coilbox-xyz");
        assert!(!writable);
        assert!(err.is_some());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p tauri-plugin-coilbox-downloads writable_tests` Expected: FAIL — `cannot find function probe_writable`.

- [ ] **Step 3: Implement the probe helper + command**

Add near the other `#[tauri::command]` fns in `lib.rs`. `probe_writable` is a plain fn (testable without Tauri); the command wraps it. Follow the existing `CliResult` envelope pattern used by `dl_installed_content`.

```rust
/// Try to create and remove a temp file inside `dir`, reporting whether it's
/// writable. A read-only folder silently blocks downloads and release updates, so
/// the health panel probes the write root and the portable `.coilbox/data` dir.
fn probe_writable(dir: &str) -> (bool, Option<String>) {
    let path = std::path::Path::new(dir);
    if !path.is_dir() {
        return (false, Some("folder does not exist".into()));
    }
    // Unique-enough name without pulling in rand: pid + nanos since the probe file
    // is created and deleted immediately.
    let probe = path.join(format!(".coilbox-write-probe-{}", std::process::id()));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            (true, None)
        }
        Err(e) => (false, Some(e.to_string())),
    }
}

/// `dl_path_writable` — report whether `path` can be written to.
#[tauri::command]
async fn dl_path_writable(path: String) -> CliResult {
    let (writable, error) = probe_writable(&path);
    CliResult::ok(json!({ "writable": writable, "error": error }))
}
```

- [ ] **Step 4: Register the command in the handler**

In `lib.rs`, add `dl_path_writable` to the `tauri::generate_handler![...]` list in `init()` (after `dl_set_engine_dirs`):

```rust
            dl_installed_content,
            dl_set_engine_dirs,
            dl_path_writable
        ])
```

- [ ] **Step 5: Add the ACL command + permission**

In `crates/tauri-plugin-coilbox-downloads/build.rs`, add to `COMMANDS`:

```rust
    "dl_set_engine_dirs",
    "dl_path_writable",
];
```

In `crates/tauri-plugin-coilbox-downloads/permissions/default.toml`, add to `permissions`:

```toml
  "allow-dl-set-engine-dirs",
  "allow-dl-path-writable",
]
```

- [ ] **Step 6: Run tests + clippy to verify pass**

Run: `cargo test -p tauri-plugin-coilbox-downloads writable_tests` Expected: PASS (both tests). Run: `cargo clippy -p tauri-plugin-coilbox-downloads --all-targets -- -D warnings` Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/tauri-plugin-coilbox-downloads/src/lib.rs crates/tauri-plugin-coilbox-downloads/build.rs crates/tauri-plugin-coilbox-downloads/permissions/default.toml
git commit -m "feat: dl_path_writable command for folder-writability checks"
```

---

## Task 2: `dlPathWritable` frontend binding

**Files:**
- Modify: `src/downloads/bindings.ts`

- [ ] **Step 1: Add the binding**

After `dlSetEngineDirs` in `src/downloads/bindings.ts`:

```ts
/** Report whether a folder can be written to. A read-only write root or portable
 * data dir silently blocks downloads and release updates. */
export const dlPathWritable = defineCommand<
  { path: string },
  { writable: boolean; error: string | null }
>("coilbox-downloads", "dl_path_writable");
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/downloads/bindings.ts
git commit -m "feat: dlPathWritable binding"
```

---

## Task 3: `getProfileError()` in profile.ts

**Files:**
- Modify: `src/profile/profile.ts`

- [ ] **Step 1: Add the module singleton + getter, populated in loadProfile()**

In `src/profile/profile.ts`, add a singleton beside the existing `loadedRoot`:

```ts
let loadedError: string | null = null;
```

In `loadProfile()`, set it in both the parse `catch` and the transport `catch`, and clear it on success. The `.then` body becomes:

```ts
      .then((res) => {
        try {
          loaded = JSON.parse(res.json) as Profile;
          loadedError = null;
        } catch (e) {
          console.warn("profile: failed to parse profile.json", e);
          loaded = EMPTY_PROFILE;
          loadedError = e instanceof Error ? e.message : String(e);
        }
        loadedSource = (res.source as ProfileSource) ?? "default";
        loadedRoot = res.root ?? "";
        return { profile: loaded, source: loadedSource };
      })
      .catch((e) => {
        console.warn("profile: load failed", e);
        loadedError = e instanceof Error ? e.message : String(e);
        return { profile: EMPTY_PROFILE, source: "default" as ProfileSource };
      });
```

Add the getter beside `getProfileRoot()`:

```ts
/**
 * The error from the last profile load, or `null` when it loaded (or was absent)
 * cleanly. A non-null value with source `"file"` means a `profile.json` was found
 * but couldn't be parsed — surfaced by the health panel so the failure isn't silent.
 */
export function getProfileError(): string | null {
  return loadedError;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/profile/profile.ts
git commit -m "feat: retain and expose profile load error"
```

---

## Task 4: Pure `deriveHealthChecks` core + types

**Files:**
- Create: `src/profile/health.ts`
- Test: `src/profile/health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/profile/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveHealthChecks, type HealthInputs } from "./health";

function base(): HealthInputs {
  return {
    portableRoot: "/pkg/.coilbox",
    profileSource: "file",
    profileError: null,
    gameFilter: undefined,
    roots: [{ path: "/pkg/game", portable: true, engineCount: 1 }],
    installedGames: ["splinter_1.3.sdz"],
    writeRootPath: "/pkg/game",
    campaignFailures: { bundled: 0, local: 0 },
    writable: { writeRoot: { writable: true }, dataDir: { writable: true } },
  };
}

function byId(inputs: HealthInputs, id: string) {
  const c = deriveHealthChecks(inputs).find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
}

describe("deriveHealthChecks", () => {
  it("reports portable mode active with the path in the label", () => {
    expect(byId(base(), "portable").status).toBe("ok");
    expect(byId(base(), "portable").label).toContain("/pkg/.coilbox");
  });

  it("flags a profile parse error", () => {
    const c = byId({ ...base(), profileError: "Unexpected token }" }, "profile");
    expect(c.status).toBe("error");
    expect(c.hint).toContain("Unexpected token");
  });

  it("warns when the game filter matches zero installed games", () => {
    const c = byId(
      { ...base(), gameFilter: { regex: "^Nope" } },
      "gameFilter",
    );
    expect(c.status).toBe("warn");
    expect(c.label).toContain("0");
  });

  it("errors on an invalid game filter regex", () => {
    const c = byId({ ...base(), gameFilter: { regex: "(" } }, "gameFilter");
    expect(c.status).toBe("error");
    expect(c.hint).toContain("regex");
  });

  it("warns when portable but no root is portable", () => {
    const c = byId(
      { ...base(), roots: [{ path: "/x", portable: false, engineCount: 1 }] },
      "roots",
    );
    expect(c.status).toBe("warn");
  });

  it("warns when the write root is outside the package", () => {
    const c = byId({ ...base(), writeRootPath: "/home/user/.spring" }, "writeRoot");
    expect(c.status).toBe("warn");
  });

  it("errors when a folder is read-only", () => {
    const c = byId(
      { ...base(), writable: { writeRoot: { writable: false, error: "denied" }, dataDir: { writable: true } } },
      "writable",
    );
    expect(c.status).toBe("error");
    expect(c.hint).toContain("read-only");
  });

  it("warns when a bundled campaign failed to load", () => {
    const c = byId(
      { ...base(), campaignFailures: { bundled: 2, local: 0 } },
      "campaigns",
    );
    expect(c.status).toBe("warn");
    expect(c.label).toContain("2");
  });

  it("warns when the package has no engine or no games", () => {
    const c = byId(
      { ...base(), roots: [{ path: "/pkg/game", portable: true, engineCount: 0 }] },
      "content",
    );
    expect(c.status).toBe("warn");
  });

  it("returns unknown for a check whose input is absent", () => {
    const c = byId({ ...base(), writeRootPath: undefined }, "writeRoot");
    expect(c.status).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/profile/health.test.ts` Expected: FAIL — cannot resolve `./health`.

- [ ] **Step 3: Implement `health.ts`**

Create `src/profile/health.ts`:

```ts
import type { GameFilter, ProfileSource } from "./profile";

export type HealthStatus = "ok" | "warn" | "error" | "unknown";

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  hint?: string;
}

/** A writability probe result for one folder (from `dlPathWritable`). */
export interface WritableResult {
  writable: boolean;
  error?: string | null;
}

/** A content root reduced to what the checks need. */
export interface RootInput {
  path: string;
  portable: boolean;
  engineCount: number;
}

/** Everything the checks derive from. Assembled by `useHealthChecks`. */
export interface HealthInputs {
  /** `<app_dir>/.coilbox`, or "" when not portable. */
  portableRoot: string;
  profileSource: ProfileSource;
  profileError: string | null;
  gameFilter: GameFilter | undefined;
  roots: RootInput[];
  installedGames: string[];
  writeRootPath: string | undefined;
  campaignFailures: { bundled: number; local: number };
  writable: { writeRoot?: WritableResult; dataDir?: WritableResult };
}

/** Strip the trailing `.coilbox` segment to get the app dir the package sits in. */
function appDirOf(portableRoot: string): string {
  return portableRoot.replace(/[/\\]\.coilbox\/?$/, "");
}

function countFilterMatches(
  filter: GameFilter,
  games: string[],
): { count: number; regexError?: string } {
  let re: RegExp | undefined;
  if (filter.regex) {
    try {
      re = new RegExp(filter.regex, "i");
    } catch (e) {
      return { count: 0, regexError: e instanceof Error ? e.message : String(e) };
    }
  }
  const names = filter.names?.map((n) => n.toLowerCase()) ?? [];
  const count = games.filter((g) => {
    const lower = g.toLowerCase();
    return names.includes(lower) || (re?.test(g) ?? false);
  }).length;
  return { count };
}

export function deriveHealthChecks(i: HealthInputs): HealthCheck[] {
  const portable = i.portableRoot !== "";
  const checks: HealthCheck[] = [];

  // 1. Portable mode
  checks.push(
    portable
      ? { id: "portable", status: "ok", label: `Portable mode active — ${i.portableRoot}` }
      : { id: "portable", status: "unknown", label: "Not portable (standard per-user install)" },
  );

  // 2. Profile source / parse error
  if (i.profileError && i.profileSource === "file") {
    checks.push({
      id: "profile",
      status: "error",
      label: "profile.json failed to parse",
      hint: i.profileError,
    });
  } else if (i.profileError) {
    checks.push({
      id: "profile",
      status: "error",
      label: "Profile failed to load",
      hint: i.profileError,
    });
  } else {
    checks.push({
      id: "profile",
      status: i.profileSource === "default" ? "unknown" : "ok",
      label:
        i.profileSource === "default"
          ? "No distribution profile loaded"
          : `Profile loaded from ${i.profileSource}`,
    });
  }

  // 3. Content roots (portable coverage)
  if (i.roots.length === 0) {
    checks.push({ id: "roots", status: "warn", label: "No content folders configured", hint: "Add a Content Folder so Coilbox can find the game." });
  } else {
    const portableRoots = i.roots.filter((r) => r.portable).length;
    const label = `${i.roots.length} content folder(s), ${portableRoots} portable`;
    checks.push(
      portable && portableRoots === 0
        ? { id: "roots", status: "warn", label, hint: "No content folder is portable — nothing would ship with the package. Tick Portable on the bundled folder." }
        : { id: "roots", status: "ok", label },
    );
  }

  // 4. Game filter reality check
  if (!i.gameFilter || (!i.gameFilter.regex && !i.gameFilter.names?.length)) {
    checks.push({ id: "gameFilter", status: "unknown", label: "No game filter set" });
  } else {
    const { count, regexError } = countFilterMatches(i.gameFilter, i.installedGames);
    if (regexError) {
      checks.push({ id: "gameFilter", status: "error", label: "Game filter regex is invalid", hint: `Invalid regex: ${regexError}` });
    } else {
      checks.push({
        id: "gameFilter",
        status: count === 0 ? "warn" : "ok",
        label: `Game filter matches ${count} installed game(s)`,
        hint: count === 0 ? "Check the regex/names, or install the game." : undefined,
      });
    }
  }

  // 5. Write root portable
  if (!portable) {
    checks.push({ id: "writeRoot", status: "unknown", label: "Write root portability n/a (not portable)" });
  } else if (i.writeRootPath === undefined) {
    checks.push({ id: "writeRoot", status: "unknown", label: "No download write root set" });
  } else {
    const inside = i.writeRootPath.startsWith(appDirOf(i.portableRoot));
    checks.push(
      inside
        ? { id: "writeRoot", status: "ok", label: "Download write root is inside the package" }
        : { id: "writeRoot", status: "warn", label: "Download write root is outside the package", hint: "Downloads and release updates would land outside the package. Point the write root at a bundled folder." },
    );
  }

  // 6. Bundled campaign load errors
  {
    const total = i.campaignFailures.bundled + i.campaignFailures.local;
    checks.push(
      total === 0
        ? { id: "campaigns", status: "ok", label: "All campaigns loaded" }
        : { id: "campaigns", status: "warn", label: `${total} campaign(s) failed to load`, hint: "Check the JSON in .coilbox/campaigns/." },
    );
  }

  // 7. Playable content present
  {
    const engines = i.roots.reduce((n, r) => n + r.engineCount, 0);
    const games = i.installedGames.length;
    if (engines === 0) {
      checks.push({ id: "content", status: "warn", label: "No engine found", hint: "Install or bundle an engine — the game can't launch without one." });
    } else if (games === 0) {
      checks.push({ id: "content", status: "warn", label: "No games found", hint: "Bundle or download the game archive (.sdz/.sd7)." });
    } else {
      checks.push({ id: "content", status: "ok", label: `${engines} engine(s), ${games} game(s) found` });
    }
  }

  // 8. Folders writable
  {
    const probes = [i.writable.writeRoot, i.writable.dataDir].filter(
      (p): p is WritableResult => p !== undefined,
    );
    if (probes.length === 0) {
      checks.push({ id: "writable", status: "unknown", label: "Folder writability not checked" });
    } else {
      const bad = probes.find((p) => !p.writable);
      checks.push(
        bad
          ? { id: "writable", status: "error", label: "A folder is read-only", hint: `Downloads and updates will fail (${bad.error ?? "not writable"}). Move the package somewhere writable — not a mounted disk image or a protected system folder.` }
          : { id: "writable", status: "ok", label: "Download + data folders are writable" },
      );
    }
  }

  return checks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/profile/health.test.ts` Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/profile/health.ts src/profile/health.test.ts
git commit -m "feat: pure deriveHealthChecks core + tests"
```

---

## Task 5: `useHealthChecks` hook

**Files:**
- Create: `src/profile/useHealthChecks.ts`

- [ ] **Step 1: Implement the hook**

Create `src/profile/useHealthChecks.ts`. It fetches the async inputs (content state, installed content, campaign list, writable probes) and feeds them + the synchronous profile getters into `deriveHealthChecks`. Returns `{ checks, loading }`.

`useDownloadsConfig` is a hook, so `writeRootId` is read at the top level of `useHealthChecks` (never inside the async effect), then threaded into the effect and used to resolve the write-root path from the already-fetched content state — no second fetch, no hook-order violation.

```ts
import { useEffect, useState } from "react";
import { campaignList } from "../campaign/bindings";
import { parseCampaignJson } from "../campaign/model";
import { contentStateLoad } from "../content/bindings";
import { dlInstalledContent, dlPathWritable } from "../downloads/bindings";
import { useDownloadsConfig } from "../downloads/config";
import { deriveHealthChecks, type HealthCheck, type HealthInputs } from "./health";
import { getProfile, getProfileError, getProfileRoot, getProfileSource } from "./profile";

/** Assemble health-check inputs and derive the checklist. Fails soft: any input
 * that can't be read falls back to an empty/neutral value, so the affected check
 * renders "unknown" rather than throwing. */
export function useHealthChecks(): { checks: HealthCheck[]; loading: boolean } {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  // Hook read at top level; feeds the effect (and re-runs it if the write root changes).
  const [cfg] = useDownloadsConfig();
  const writeRootId = cfg.writeRootId;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const portableRoot = getProfileRoot();

      const state = await contentStateLoad(undefined)
        .then((r) => r.state)
        .catch(() => null);
      const roots = (state?.roots ?? []).map((r) => ({
        path: r.path,
        portable: r.portable,
        engineCount: r.engines.length,
      }));
      const rootPaths = roots.map((r) => r.path);
      const writeRootPath = writeRootId
        ? state?.roots.find((r) => r.id === writeRootId)?.path
        : undefined;

      const installedGames = rootPaths.length
        ? await dlInstalledContent({ paths: rootPaths })
            .then((r) => r.games)
            .catch(() => [] as string[])
        : [];

      const campaignFailures = await campaignList({})
        .then((r) => {
          const acc = { bundled: 0, local: 0 };
          for (const item of r.items) {
            if (parseCampaignJson(item.json) === null) acc[item.source] += 1;
          }
          return acc;
        })
        .catch(() => ({ bundled: 0, local: 0 }));

      const probe = (path: string | undefined) =>
        path
          ? dlPathWritable({ path })
              .then((r) => ({ writable: r.writable, error: r.error }))
              .catch(() => undefined)
          : Promise.resolve(undefined);

      const dataDirPath = portableRoot ? `${portableRoot}/data` : undefined;
      const [writeRootProbe, dataDirProbe] = await Promise.all([
        probe(writeRootPath),
        probe(dataDirPath),
      ]);

      if (cancelled) return;

      const inputs: HealthInputs = {
        portableRoot,
        profileSource: getProfileSource(),
        profileError: getProfileError(),
        gameFilter: getProfile().gameFilter,
        roots,
        installedGames,
        writeRootPath,
        campaignFailures,
        writable: { writeRoot: writeRootProbe, dataDir: dataDirProbe },
      };
      setChecks(deriveHealthChecks(inputs));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [writeRootId]);

  return { checks, loading };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` Expected: PASS. Fix any hook-order / unused-var issues flagged (see the implementer note above).

- [ ] **Step 3: Commit**

```bash
git add src/profile/useHealthChecks.ts
git commit -m "feat: useHealthChecks hook assembling health inputs"
```

---

## Task 6: `HealthChecklist` renderer

**Files:**
- Create: `src/profile/HealthChecklist.tsx`

- [ ] **Step 1: Implement the renderer**

Create `src/profile/HealthChecklist.tsx`. Dumb component: maps `HealthCheck.status` to a lucide icon + colour, renders label and hint. Uses the same spacing/typography as `SettingsSection`.

```tsx
import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import type { HealthCheck, HealthStatus } from "./health";
import { useHealthChecks } from "./useHealthChecks";

const ICONS: Record<HealthStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  unknown: CircleHelp,
};

const COLOURS: Record<HealthStatus, string> = {
  ok: "text-green-600 dark:text-green-500",
  warn: "text-amber-600 dark:text-amber-500",
  error: "text-destructive",
  unknown: "text-muted-foreground",
};

export default function HealthChecklist() {
  const { checks, loading } = useHealthChecks();

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Health
      </h3>
      {loading && checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Running checks…</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {checks.map((c) => (
            <Row key={c.id} check={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ check }: { check: HealthCheck }) {
  const Icon = ICONS[check.status];
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <Icon size={16} className={`mt-0.5 shrink-0 ${COLOURS[check.status]}`} />
      <div className="min-w-0">
        <p className="font-medium">{check.label}</p>
        {check.hint && (
          <p className="text-muted-foreground">{check.hint}</p>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck` Expected: PASS. Run: `bunx biome check src/profile/HealthChecklist.tsx` Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/profile/HealthChecklist.tsx
git commit -m "feat: HealthChecklist renderer"
```

---

## Task 7: Wire the checklist into ProfileSettings

**Files:**
- Modify: `src/profile/SettingsSection.tsx`

- [ ] **Step 1: Render `<HealthChecklist>` in both branches**

In `src/profile/SettingsSection.tsx`, import it and render it below the existing content. The section renders health in BOTH the "no profile loaded" branch (writability/content checks still matter for a vanilla install) and the loaded branch.

Add the import:

```tsx
import HealthChecklist from "./HealthChecklist";
```

In the `if (!loaded)` branch, add `<HealthChecklist />` after the `<p>`:

```tsx
    return (
      <div className="space-y-8">
        <Header />
        <p className="text-sm text-muted-foreground">
          No distribution profile loaded — standard Coilbox.
        </p>
        <HealthChecklist />
      </div>
    );
```

In the main `return`, add `<HealthChecklist />` after the closing `</section>` of the facts block (before the outer `</div>`):

```tsx
      </section>
      <HealthChecklist />
    </div>
  );
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck` Expected: PASS. Run: `bunx biome check src/profile/SettingsSection.tsx` Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/profile/SettingsSection.tsx
git commit -m "feat: show health checklist in Distribution profile settings"
```

---

## Task 8: Full lint suite + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full lint suite CI runs**

Run: `cargo fmt --all --check` Run: `cargo clippy --all-targets --all-features -- -D warnings` Run: `bunx biome ci .` Run: `bun run typecheck` Run: `bunx vitest run src/profile/health.test.ts` Expected: all pass.

- [ ] **Step 2: Manual smoke test**

Run: `bun tauri dev`
- Open Settings > Distribution profile. Confirm the **Health** section renders with 8 rows and sensible statuses for the current (non-portable dev) environment.
- Create `target/debug/.coilbox/` with a deliberately malformed `profile.json` (e.g. `{ "title": }`), relaunch, and confirm the **profile.json failed to parse** row shows the parse error.
- Confirm no console errors from the health panel.

> This step is a checkpoint for the user to run `bun tauri dev` before a PR (per CLAUDE.md). Report what was observed; do not claim it passed without running it.

- [ ] **Step 3: Commit any fmt-only changes**

```bash
git add -u
git commit -m "chore: fmt"
```

(Skip if there's nothing to commit.)

---

## Self-review notes

- **Spec coverage:** all 8 checks map to Task 4 branches; placement (both settings branches) = Task 7; `getProfileError` = Task 3; writable probe = Task 1–2; campaign-failure counting = Task 5 (frontend-only, per revised spec). Fail-soft/"unknown" = Task 4 + hook `.catch`es. Testing = Task 4 (pure core) + Task 1 (Rust probe).
- **Hook-order safety (Task 5):** `useDownloadsConfig` is read at the top level of `useHealthChecks` and `writeRootId` is threaded into the effect (in its dependency array), so no hook is called inside the async body. The write-root path is resolved from the already-fetched content state — no second fetch.
- **Types:** `HealthCheck`, `HealthInputs`, `WritableResult`, `RootInput` defined in Task 4 and consumed unchanged in Tasks 5–6. `dlPathWritable` result `{writable, error}` matches the Rust `json!` envelope in Task 1.
