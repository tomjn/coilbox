# Game Branding Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let coilbox brand game detail/grid views from an external, GitHub-hosted `catalog.json` (banners, logos, screenshots, links, video links) matched to installed games, overriding decayed/LuaIntro loading art.

**Architecture:** Two new Rust commands in the existing `tauri-plugin-coilbox-content` plugin — `branding_catalog` (fetch remote JSON over HTTPS, disk-cache, fall back to a bundled seed) and `branding_image` (fetch a remote image over HTTPS, cache once as a `data:` URL keyed by URL hash, to beat CSP). A frontend branding layer (`src/content/branding.ts`) parses the catalog, matches entries to games (narrow, per-project, catalog-wins), and feeds banner/logo/links/screenshots/videos into the existing `GameHeader`/`GameArt`/`GameCard`/`GameDetailPage`.

**Tech Stack:** Rust (`reqwest` 0.12 rustls, `serde_json`, `std` hashing), Tauri v2 plugin ACL, React + TypeScript, picoframe `Button`, `@tauri-apps/plugin-opener`.

**Spec:** `docs/superpowers/specs/2026-07-02-game-branding-catalog-design.md`

---

## File Structure

**Rust (in `crates/tauri-plugin-coilbox-content/`):**
- Create `src/branding.rs` — pure helpers (`url_key`, `base64_encode`, `data_url`, `image_content_type`) + async fetch/cache functions. Owns all branding I/O + unit tests.
- Modify `src/lib.rs` — add `mod branding;`, the two `#[tauri::command]`s, and register them in `generate_handler!`.
- Modify `Cargo.toml` — add `reqwest` dep.
- Modify `build.rs` — add the two commands to `COMMANDS`.
- Modify `permissions/default.toml` — add the two `allow-*` permissions to the default set.

**App shell:**
- Create `src-tauri/branding/catalog.json` — the canonical, GitHub-fetchable catalog **and** the bundled seed (single source of truth).
- Modify `src-tauri/tauri.conf.json` — bundle `branding/catalog.json` as a resource.

**Frontend (in `src/content/`):**
- Create `branding.ts` — catalog types, `defineCommand` bindings, the pure `resolveBranding` matcher, and the `useBrandingCatalog` / `useBrandingEntry` / `useBrandingImage` hooks.
- Modify `pages/components/GameHeader.tsx` — banner/logo/title override (catalog wins).
- Modify `pages/components/GameCard.tsx` — self-resolve catalog banner/logo override.
- Modify `pages/GameDetailPage.tsx` — links row, screenshots strip, video links.
- Create `pages/components/BrandingLinks.tsx` — links + video buttons (P2).
- Create `pages/components/BrandingScreenshots.tsx` — thumbnail strip + lightbox (P3).

**Matching rule (locked):** entries are evaluated **top-to-bottom; first entry that matches wins**. Within an entry, `names` (case-insensitive exact equality vs `game.name` or `game.info.shortname`) is checked before `regex` (compiled case-insensitive; invalid patterns skip that entry). Authors order entries **most-specific-first**; sibling projects (Balanced Annihilation vs Beyond All Reason/BAR vs Splinter Faction) get narrow per-project patterns and are never cross-branded.

---

## Task 1: Rust pure helpers (`branding.rs`) with unit tests

**Files:**
- Create: `crates/tauri-plugin-coilbox-content/src/branding.rs`
- Modify: `crates/tauri-plugin-coilbox-content/src/lib.rs` (add `mod branding;` near the other `mod` lines, ~top of file)

- [ ] **Step 1: Write `branding.rs` with pure helpers + failing tests**

```rust
//! Game-branding catalog + image proxy support.
//!
//! Two concerns live here: fetching/caching the remote `catalog.json`, and
//! fetching remote branding images and caching them once as `data:` URLs (which
//! sidestep CSP host-allowlisting — the catalog can reference any host).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

/// Stable filesystem-safe key for a URL (hex of the std hasher). Used to name the
/// per-URL image cache files; a changed catalog URL naturally misses and refetches.
pub(crate) fn url_key(url: &str) -> String {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Standard base64 (RFC 4648, with padding). Small hand-rolled encoder so we don't
/// add a crate just to build `data:` URLs.
pub(crate) fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// Build a `data:` URL from a content type and image bytes.
pub(crate) fn data_url(content_type: &str, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", content_type, base64_encode(bytes))
}

/// Pick a usable image content type: trust an `image/*` response header, else
/// guess from the URL extension, else default to `image/png`. Anything not
/// `image/*` returns `None` so non-image responses are rejected.
pub(crate) fn image_content_type(header: Option<&str>, url: &str) -> Option<String> {
    if let Some(h) = header {
        let ct = h.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        if ct.starts_with("image/") {
            return Some(ct);
        }
        if !ct.is_empty() {
            return None; // an explicit non-image type: reject
        }
    }
    let lower = url.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "png" => Some("image/png".into()),
        "jpg" | "jpeg" => Some("image/jpeg".into()),
        "gif" => Some("image/gif".into()),
        "webp" => Some("image/webp".into()),
        "svg" => Some("image/svg+xml".into()),
        "bmp" => Some("image/bmp".into()),
        _ => Some("image/png".into()),
    }
}

/// A cache-dir subpath helper, mirroring the header/thumb cache layout.
pub(crate) fn image_cache_files(cache_dir: &std::path::Path, url: &str) -> (PathBuf, PathBuf) {
    let key = url_key(url);
    (cache_dir.join(format!("{key}.dataurl")), cache_dir.join(format!("{key}.none")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn data_url_has_prefix() {
        assert_eq!(data_url("image/png", b"foo"), "data:image/png;base64,Zm9v");
    }

    #[test]
    fn url_key_is_stable_and_differs() {
        assert_eq!(url_key("https://a/x.png"), url_key("https://a/x.png"));
        assert_ne!(url_key("https://a/x.png"), url_key("https://a/y.png"));
    }

    #[test]
    fn content_type_prefers_image_header_then_extension() {
        assert_eq!(image_content_type(Some("image/webp"), "u"), Some("image/webp".into()));
        assert_eq!(image_content_type(Some("image/jpeg; charset=x"), "u"), Some("image/jpeg".into()));
        assert_eq!(image_content_type(Some("text/html"), "u.png"), None);
        assert_eq!(image_content_type(None, "https://x/logo.WEBP"), Some("image/webp".into()));
        assert_eq!(image_content_type(None, "https://x/noext"), Some("image/png".into()));
    }
}
```

Then add the module declaration to `src/lib.rs` next to the other `mod` statements (search for `mod demo;` / `mod scan;` and add alongside):

```rust
mod branding;
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-content branding` Expected: PASS (4 tests). The `mod branding;` line makes the module compile; helpers are `pub(crate)` so `dead_code` may warn until Task 2 uses them — that is fine mid-task, but if clippy runs with `-D warnings` add `#[allow(dead_code)]` on `image_cache_files` temporarily; it is used in Task 2.

- [ ] **Step 3: Commit**

```bash
git add crates/tauri-plugin-coilbox-content/src/branding.rs crates/tauri-plugin-coilbox-content/src/lib.rs
git commit -m "feat(content): branding.rs pure helpers (base64, url key, content-type)"
```

---

## Task 2: Rust async fetch/cache + the two commands

**Files:**
- Modify: `crates/tauri-plugin-coilbox-content/Cargo.toml` (add `reqwest`)
- Modify: `crates/tauri-plugin-coilbox-content/src/branding.rs` (add async fns)
- Modify: `crates/tauri-plugin-coilbox-content/src/lib.rs` (add two commands + register)

- [ ] **Step 1: Add the reqwest dependency**

In `crates/tauri-plugin-coilbox-content/Cargo.toml`, under `[dependencies]` (after `flate2 = "1"`):

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
```

- [ ] **Step 2: Add async fetch/cache functions to `branding.rs`**

Append to `crates/tauri-plugin-coilbox-content/src/branding.rs` (above `#[cfg(test)]`):

```rust
/// Fetch the catalog JSON text over HTTP. Errors carry the reqwest message.
pub(crate) async fn fetch_catalog_text(url: &str) -> Result<String, String> {
    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// Result of resolving the catalog: the raw JSON text plus where it came from.
/// The frontend parses/validates the JSON, so Rust stays schema-agnostic.
#[derive(serde::Serialize)]
pub(crate) struct CatalogResult {
    pub json: String,
    pub source: String, // "network" | "cache" | "seed" | "error"
    pub errors: Vec<String>,
}

/// Fetch → cache → seed. Never hard-fails: on network error, returns the disk
/// cache, then the bundled seed, then an empty catalog with the errors attached.
pub(crate) async fn resolve_catalog(
    url: &str,
    cache_file: Option<PathBuf>,
    seed_file: Option<PathBuf>,
) -> CatalogResult {
    match fetch_catalog_text(url).await {
        Ok(text) => {
            if let Some(f) = &cache_file {
                if let Some(dir) = f.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                let _ = std::fs::write(f, &text);
            }
            CatalogResult { json: text, source: "network".into(), errors: vec![] }
        }
        Err(e) => {
            if let Some(f) = &cache_file {
                if let Ok(text) = std::fs::read_to_string(f) {
                    return CatalogResult { json: text, source: "cache".into(), errors: vec![e] };
                }
            }
            if let Some(f) = &seed_file {
                if let Ok(text) = std::fs::read_to_string(f) {
                    return CatalogResult { json: text, source: "seed".into(), errors: vec![e] };
                }
            }
            CatalogResult {
                json: r#"{"version":1,"entries":[]}"#.into(),
                source: "error".into(),
                errors: vec![e],
            }
        }
    }
}

/// Fetch the first URL that yields an image, cache it once as a `data:` URL, and
/// return it. `.dataurl` positive hits and `.none` negative markers avoid refetch.
/// Only `https` URLs are attempted (privacy/security).
pub(crate) async fn resolve_image(urls: &[String], cache_dir: Option<PathBuf>) -> Option<String> {
    for url in urls {
        if !url.starts_with("https://") {
            continue;
        }
        let files = cache_dir.as_ref().map(|d| image_cache_files(d, url));
        if let Some((pos, neg)) = &files {
            if let Ok(text) = std::fs::read_to_string(pos) {
                return Some(text);
            }
            if neg.exists() {
                continue;
            }
        }
        match fetch_image(url).await {
            Some(data_url) => {
                if let Some((pos, _)) = &files {
                    if let Some(dir) = pos.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    let _ = std::fs::write(pos, &data_url);
                }
                return Some(data_url);
            }
            None => {
                if let Some((_, neg)) = &files {
                    if let Some(dir) = neg.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    let _ = std::fs::write(neg, b"");
                }
            }
        }
    }
    None
}

/// Fetch one image URL → `data:` URL, or `None` on any failure / non-image.
async fn fetch_image(url: &str) -> Option<String> {
    let resp = reqwest::get(url).await.ok()?.error_for_status().ok()?;
    let header = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let content_type = image_content_type(header.as_deref(), url)?;
    let bytes = resp.bytes().await.ok()?;
    Some(data_url(&content_type, &bytes))
}
```

- [ ] **Step 3: Add the two commands + registration in `lib.rs`**

In `crates/tauri-plugin-coilbox-content/src/lib.rs`, add both commands (place them just before `pub fn init`, near `content_demo_info` at ~line 581). They reuse the crate's existing `CliResult`, `json!`, `AppHandle`, `Manager`, `Runtime` imports:

```rust
/// `branding_catalog` — fetch the remote branding catalog JSON, disk-cache it, and
/// fall back to the cache then the bundled seed on network failure. Returns the
/// raw JSON text; the frontend parses/matches it (Rust stays schema-agnostic).
#[tauri::command]
async fn branding_catalog<R: Runtime>(app: AppHandle<R>, url: String) -> Result<CliResult, ()> {
    let cache_file = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join("coilbox-branding").join("catalog.json"));
    let seed_file = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("branding").join("catalog.json"));
    let res = branding::resolve_catalog(&url, cache_file, seed_file).await;
    Ok(CliResult::ok(json!(res)))
}

/// `branding_image` — fetch the first working image URL (https only), cache it
/// once as a `data:` URL keyed by URL hash, and return it. Empty `dataUrl` = the
/// UI falls back to the game's own art / gradient.
#[tauri::command]
async fn branding_image<R: Runtime>(app: AppHandle<R>, urls: Vec<String>) -> Result<CliResult, ()> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join("coilbox-branding-images"));
    let data_url = branding::resolve_image(&urls, cache_dir).await;
    Ok(CliResult::ok(json!({ "dataUrl": data_url })))
}
```

Then add both to the `generate_handler!` list in `init` (after `content_demo_info` — remember to add a comma after `content_demo_info`):

```rust
            content_demo_info,
            branding_catalog,
            branding_image
```

- [ ] **Step 4: Build + run the existing tests**

Run: `cargo test -p tauri-plugin-coilbox-content` Expected: PASS (compiles with reqwest; Task 1 tests still green; no `dead_code` now that helpers are used — remove any temporary `#[allow(dead_code)]`).

- [ ] **Step 5: Clippy the crate**

Run: `cargo clippy -p tauri-plugin-coilbox-content --all-targets --all-features -- -D warnings` Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add crates/tauri-plugin-coilbox-content/Cargo.toml crates/tauri-plugin-coilbox-content/src/branding.rs crates/tauri-plugin-coilbox-content/src/lib.rs
git commit -m "feat(content): branding_catalog + branding_image commands"
```

---

## Task 3: ACL wiring (build.rs + default.toml)

Without this the commands are ACL-blocked at runtime even though they compile.

**Files:**
- Modify: `crates/tauri-plugin-coilbox-content/build.rs`
- Modify: `crates/tauri-plugin-coilbox-content/permissions/default.toml`

- [ ] **Step 1: Add the commands to `build.rs` COMMANDS**

Append to the `COMMANDS` array (after `"content_demo_info",`):

```rust
    "branding_catalog",
    "branding_image",
```

- [ ] **Step 2: Add the permissions to the default set**

In `permissions/default.toml`, append to the `permissions = [ ... ]` list (after `"allow-content-demo-info",`):

```toml
  "allow-branding-catalog",
  "allow-branding-image",
```

- [ ] **Step 3: Regenerate + verify the autogenerated permission files exist**

Run: `cargo build -p tauri-plugin-coilbox-content` Expected: build succeeds and creates `permissions/autogenerated/commands/branding_catalog.toml` and `branding_image.toml`.

Run: `ls crates/tauri-plugin-coilbox-content/permissions/autogenerated/commands/branding_catalog.toml` Expected: file exists.

- [ ] **Step 4: Commit (include the autogenerated files)**

```bash
git add crates/tauri-plugin-coilbox-content/build.rs crates/tauri-plugin-coilbox-content/permissions/default.toml crates/tauri-plugin-coilbox-content/permissions/autogenerated
git commit -m "feat(content): ACL for branding commands"
```

---

## Task 4: Seed catalog + bundle resource

**Files:**
- Create: `src-tauri/branding/catalog.json`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Write the seed catalog (single source of truth, also fetched from GitHub)**

Create `src-tauri/branding/catalog.json`. Splinter Faction is the verified seed entry (real website + logo + itch.io art). Order entries most-specific-first.

```json
{
  "version": 1,
  "updated": "2026-07-02",
  "entries": [
    {
      "id": "splinter-faction",
      "match": { "regex": "^Splinter Faction" },
      "title": "Splinter Faction",
      "banner": ["https://img.itch.zone/aW1nLzIxNjg5NTc3LnBuZw==/original/W1YpP9.png"],
      "logo": ["https://splinterfaction.info/images/logo.webp"],
      "screenshots": [],
      "videos": [],
      "links": [
        { "label": "Website", "url": "https://splinterfaction.info/" },
        { "label": "itch.io", "url": "https://frozenyak.itch.io/splinterfaction" }
      ]
    }
  ]
}
```

> Authoring note: verify `match.regex`/`names` against the real installed `game.name` for each project before adding it. Keep patterns narrow — never let one project's pattern sweep a sibling (Balanced Annihilation / Beyond All Reason / BAR are distinct projects).

- [ ] **Step 2: Bundle it as a resource**

In `src-tauri/tauri.conf.json`, change the `bundle.resources` array from `["mapconv"]` to include the catalog:

```json
    "resources": ["mapconv", "branding/catalog.json"],
```

- [ ] **Step 3: Verify JSON parses**

Run: `jq . src-tauri/branding/catalog.json` Expected: pretty-prints without error.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/branding/catalog.json src-tauri/tauri.conf.json
git commit -m "feat(content): seed branding catalog + bundle it as a resource"
```

---

## Task 5: Frontend bindings + pure matcher (`branding.ts`)

**Files:**
- Create: `src/content/branding.ts`

- [ ] **Step 1: Write the types, bindings, matcher, and hooks**

Create `src/content/branding.ts`:

```ts
import { defineCommand } from "@picoframe/plugin-sdk";
import { useEffect, useState } from "react";
import type { GameItem } from "./bindings";

/**
 * Branding catalog: GitHub-hosted JSON mapping a game identity to branding assets
 * and backfill links. Fetched at runtime (disk-cached + bundled seed by the Rust
 * side); entries are matched narrowly, per-project, and catalog art wins over the
 * game's own loading-screen art.
 */

/** Default catalog URL — the copy in the main coilbox repo (main branch). */
export const DEFAULT_BRANDING_CATALOG_URL =
  "https://raw.githubusercontent.com/tomjn/coilbox/main/src-tauri/branding/catalog.json";

export interface BrandingMatch {
  /** Case-insensitive regex tested against game.name. */
  regex?: string;
  /** Case-insensitive exact matches against game.name or game.info.shortname. */
  names?: string[];
}
export interface BrandingScreenshot {
  urls: string[];
  caption?: string;
}
export type BrandingVideo =
  | { kind: "youtube"; id: string; title?: string }
  | { kind: "link"; url: string; title?: string };
export interface BrandingLink {
  label: string;
  url: string;
}
export interface BrandingEntry {
  id: string;
  match: BrandingMatch;
  title?: string;
  banner?: string[];
  logo?: string[];
  screenshots?: BrandingScreenshot[];
  videos?: BrandingVideo[];
  links?: BrandingLink[];
}
export interface BrandingCatalog {
  version: number;
  updated?: string;
  entries: BrandingEntry[];
}

interface CatalogResult {
  json: string;
  source: string;
  errors: string[];
}
interface ImageResult {
  dataUrl?: string;
}

const brandingCatalogCmd = defineCommand<{ url: string }, CatalogResult>(
  "coilbox-content",
  "branding_catalog",
);
const brandingImageCmd = defineCommand<{ urls: string[] }, ImageResult>(
  "coilbox-content",
  "branding_image",
);

/** An entry with its regex precompiled (invalid regex -> undefined, entry kept). */
interface CompiledEntry extends BrandingEntry {
  compiledRegex?: RegExp;
}

function compile(entries: BrandingEntry[]): CompiledEntry[] {
  return entries.map((e) => {
    let compiledRegex: RegExp | undefined;
    if (e.match.regex) {
      try {
        compiledRegex = new RegExp(e.match.regex, "i");
      } catch {
        console.warn(`branding: entry "${e.id}" has an invalid regex, skipped`);
      }
    }
    return { ...e, compiledRegex };
  });
}

const eq = (a: string, b?: string) => !!b && a.toLowerCase() === b.toLowerCase();

/** Does this entry match the game? names (exact) are checked before regex. */
function entryMatches(e: CompiledEntry, name: string, shortname?: string): boolean {
  if (e.match.names?.some((n) => eq(n, name) || eq(n, shortname))) return true;
  if (e.compiledRegex?.test(name)) return true;
  return false;
}

/**
 * Resolve the branding entry for a game: entries are evaluated top-to-bottom and
 * the first match wins (authors order them most-specific-first). Returns null when
 * nothing matches — the UI then keeps the game's own art.
 */
export function resolveBranding(
  entries: CompiledEntry[],
  game: GameItem,
): CompiledEntry | null {
  for (const e of entries) {
    if (entryMatches(e, game.name, game.info.shortname)) {
      return e;
    }
  }
  return null;
}

// --- hooks -----------------------------------------------------------------

let catalogPromise: Promise<CompiledEntry[]> | null = null;

/** Load + compile the catalog once per session (module-level promise cache). */
export function loadBrandingCatalog(): Promise<CompiledEntry[]> {
  if (!catalogPromise) {
    catalogPromise = brandingCatalogCmd({ url: DEFAULT_BRANDING_CATALOG_URL })
      .then((res) => {
        const parsed = JSON.parse(res.json) as BrandingCatalog;
        return compile(parsed.entries ?? []);
      })
      .catch((e) => {
        console.warn("branding: catalog load failed", e);
        return [] as CompiledEntry[];
      });
  }
  return catalogPromise;
}

/** The compiled catalog entries, loaded once. */
export function useBrandingCatalog(): CompiledEntry[] {
  const [entries, setEntries] = useState<CompiledEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadBrandingCatalog().then((e) => {
      if (!cancelled) setEntries(e);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return entries;
}

/**
 * The branding entry matching a game (or null). Accepts `undefined` so it can be
 * called unconditionally before a page's early-return guards (rules of hooks).
 */
export function useBrandingEntry(game: GameItem | undefined): BrandingEntry | null {
  const entries = useBrandingCatalog();
  const entry = game ? resolveBranding(entries, game) : null;
  useEffect(() => {
    if (game && entry) console.debug(`branding: "${game.name}" -> entry "${entry.id}"`);
  }, [game, entry]);
  return entry;
}

const imageCache = new Map<string, Promise<ImageResult>>();

/**
 * Resolve the first working URL to a cached `data:` URL via the Rust proxy (fetch
 * once, CSP-safe). No-ops for empty input; session-cached by the joined URL list.
 */
export function useBrandingImage(urls?: string[]): string | undefined {
  const key = urls?.length ? urls.join("\n") : "";
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!key) {
      setDataUrl(undefined);
      return;
    }
    let cancelled = false;
    let promise = imageCache.get(key);
    if (!promise) {
      promise = brandingImageCmd({ urls: key.split("\n") });
      imageCache.set(key, promise);
    }
    promise
      .then((res) => {
        if (!cancelled) setDataUrl(res.dataUrl ?? undefined);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return dataUrl;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` Expected: no errors. (Confirms `GameItem.info.shortname` exists and the binding signatures line up.)

- [ ] **Step 3: Lint**

Run: `bunx biome ci src/content/branding.ts` Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/content/branding.ts
git commit -m "feat(content): branding catalog bindings, matcher, hooks"
```

---

## Task 6: Wire banner + logo into the game hero (catalog wins)

**Files:**
- Modify: `src/content/pages/components/GameHeader.tsx`

- [ ] **Step 1: Resolve branding and prefer catalog banner over loadpicture art**

In `GameHeader.tsx`, add the imports:

```tsx
import { useBrandingEntry, useBrandingImage } from "../../branding";
```

Replace the art-resolution line:

```tsx
  const { headers } = useUnitsyncGameHeaders(enginePath, dataDir);
  const artUrl = headers.get(game.name);
```

with:

```tsx
  const { headers } = useUnitsyncGameHeaders(enginePath, dataDir);
  const brand = useBrandingEntry(game);
  const brandBanner = useBrandingImage(brand?.banner);
  const brandLogo = useBrandingImage(brand?.logo);
  // Catalog art wins; the game's own loading-screen art is the fallback.
  const artUrl = brandBanner ?? headers.get(game.name);
```

- [ ] **Step 2: Show the logo + title override in the title block**

Replace the `<h1>` title row:

```tsx
            <h1 className="break-words text-lg font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
              {game.name}
            </h1>
```

with (logo emblem when present, and `brand.title` overrides the display name):

```tsx
            {brandLogo && (
              <img
                src={brandLogo}
                alt=""
                aria-hidden
                className="h-7 w-auto shrink-0 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
              />
            )}
            <h1 className="break-words text-lg font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
              {brand?.title ?? game.name}
            </h1>
```

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck` Run: `bunx biome ci src/content/pages/components/GameHeader.tsx` Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/content/pages/components/GameHeader.tsx
git commit -m "feat(content): catalog banner + logo in game hero"
```

---

## Task 7: Wire catalog banner + logo into the Games-grid card

**Files:**
- Modify: `src/content/pages/components/GameCard.tsx`

The card gets `artUrl` from the grid's batch loader. It self-resolves branding so the parent grid needs no change; catalog banner overrides the passed art, and a small logo badge overlays the top-left.

- [ ] **Step 1: Resolve branding inside the card**

Add imports:

```tsx
import { useBrandingEntry, useBrandingImage } from "../../branding";
```

At the top of the component body (before the `return`):

```tsx
  const brand = useBrandingEntry(game);
  const brandBanner = useBrandingImage(brand?.banner);
  const brandLogo = useBrandingImage(brand?.logo);
  const art = brandBanner ?? artUrl;
```

- [ ] **Step 2: Use the resolved art + add the logo badge**

Change the `<GameArt ... artUrl={artUrl} />` to `artUrl={art}`, and the shimmer condition `loading && !artUrl` to `loading && !art`. After the `GameArt` element, add the logo badge:

```tsx
      {brandLogo && (
        <img
          src={brandLogo}
          alt=""
          aria-hidden
          className="absolute left-2 top-2 h-6 w-auto drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
        />
      )}
```

Optionally show `brand?.title ?? game.name` in the `<p>` name (keep `title={game.name}` tooltip as the real name).

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck` Run: `bunx biome ci src/content/pages/components/GameCard.tsx` Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/content/pages/components/GameCard.tsx
git commit -m "feat(content): catalog banner + logo badge on game cards"
```

---

## Task 8: P1 live verification (the core value)

- [ ] **Step 1: Full lint + typecheck (the exact CI commands)**

Run: `cargo fmt --all --check` Run: `cargo clippy --all-targets --all-features -- -D warnings` Run: `bunx biome ci .` Run: `bun run typecheck` Expected: all clean. (If clippy needs the unitsync sidecar, first `bun run sidecar:unitsync` per CLAUDE.md.)

- [ ] **Step 2: Run the app and verify branding via Tauri MCP**

Run: `bun tauri dev` (leave running), then via the Tauri MCP:
- Navigate to a game whose `game.name` starts with "Splinter Faction" (install it, or temporarily add a seed entry whose regex matches an installed game to prove the path).
- Screenshot the game detail hero: the itch.io banner shows, the `splinterfaction.info` logo overlays the title, and the Website + itch.io links will appear after Task 9.
- Screenshot the Games grid card for the same game: catalog banner + logo badge.
- Relaunch and confirm the images render instantly (served from `coilbox-branding-images/<hash>.dataurl`); confirm no network request for those images on the second launch.
- Verify a **non-matching** game (e.g. Balanced Annihilation) is unbranded — still its own art/gradient, proving no sibling cross-branding.

- [ ] **Step 3: Commit any fmt fixes only**

```bash
git add -u
git commit -m "chore(content): fmt/lint fixes for branding P1"
```

---

## Task 9: P2 — links row + video links in game detail

**Files:**
- Create: `src/content/pages/components/BrandingLinks.tsx`
- Modify: `src/content/pages/GameDetailPage.tsx`

- [ ] **Step 1: Create the BrandingLinks component**

Create `src/content/pages/components/BrandingLinks.tsx`:

```tsx
import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Play } from "lucide-react";
import type { BrandingEntry } from "../../branding";

/**
 * Branding links + video links for a game (the dead-`modinfo`-site backfill).
 * Everything opens in the system browser; videos are never embedded.
 */
export function BrandingLinks({ entry }: { entry: BrandingEntry }) {
  const videos = entry.videos ?? [];
  const links = entry.links ?? [];
  if (videos.length === 0 && links.length === 0) return null;

  const videoUrl = (v: NonNullable<BrandingEntry["videos"]>[number]) =>
    v.kind === "youtube" ? `https://youtu.be/${v.id}` : v.url;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Links</h2>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Button
            key={l.url}
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => openUrl(l.url).catch(() => {})}
          >
            <ExternalLink className="size-4" /> {l.label}
          </Button>
        ))}
        {videos.map((v) => (
          <Button
            key={videoUrl(v)}
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => openUrl(videoUrl(v)).catch(() => {})}
          >
            <Play className="size-4" /> {v.title ?? "Video"}
          </Button>
        ))}
      </div>
    </section>
  );
}
```

> Note: `@tauri-apps/plugin-opener` exports `openUrl` for URLs (and `openPath` for paths). Confirm the export name during Step 3's typecheck; if the installed version only exports `open`, import `{ open as openUrl }`.

- [ ] **Step 2: Render it in GameDetailPage**

In `GameDetailPage.tsx`, add imports:

```tsx
import { useBrandingEntry } from "../branding";
import { BrandingLinks } from "./components/BrandingLinks";
```

Call the hook **before the early-return guards** (rules of hooks) — place it right after the `useUnitsyncGameInfo` hook (~line 44), where `game` may still be `undefined` (the hook accepts that):

```tsx
  const brand = useBrandingEntry(game);
```

Then render `<BrandingLinks>` right after the description block (after the closing `</div>` of the `flex flex-col gap-1` block, ~line 91):

```tsx
      {brand && <BrandingLinks entry={brand} />}
```

- [ ] **Step 3: Typecheck + lint + commit**

Run: `bun run typecheck` Run: `bunx biome ci src/content` Expected: clean.

```bash
git add src/content/pages/components/BrandingLinks.tsx src/content/pages/GameDetailPage.tsx
git commit -m "feat(content): branding links + video links on game detail"
```

---

## Task 10: P3 — screenshots strip + lightbox

**Files:**
- Create: `src/content/pages/components/BrandingScreenshots.tsx`
- Modify: `src/content/pages/GameDetailPage.tsx`

- [ ] **Step 1: Create the screenshots component**

Create `src/content/pages/components/BrandingScreenshots.tsx`:

```tsx
import { X } from "lucide-react";
import { useState } from "react";
import type { BrandingScreenshot } from "../../branding";
import { useBrandingImage } from "../../branding";

/** One thumbnail resolved via the image proxy; click opens the lightbox. */
function Thumb({
  shot,
  onOpen,
}: {
  shot: BrandingScreenshot;
  onOpen: (dataUrl: string, caption?: string) => void;
}) {
  const dataUrl = useBrandingImage(shot.urls);
  if (!dataUrl) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(dataUrl, shot.caption)}
      className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-md border border-border/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <img src={dataUrl} alt={shot.caption ?? ""} className="size-full object-cover" />
    </button>
  );
}

/**
 * A horizontal strip of branding screenshots with a click-to-open lightbox. Each
 * thumbnail resolves through the same cached image proxy as banners/logos.
 */
export function BrandingScreenshots({ shots }: { shots: BrandingScreenshot[] }) {
  const [open, setOpen] = useState<{ url: string; caption?: string } | null>(null);
  if (shots.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Screenshots</h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {shots.map((s, i) => (
          <Thumb
            key={s.urls[0] ?? i}
            shot={s}
            onOpen={(url, caption) => setOpen({ url, caption })}
          />
        ))}
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-8"
          onClick={() => setOpen(null)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(null)}
          role="dialog"
          aria-modal="true"
          aria-label={open.caption ?? "Screenshot"}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setOpen(null)}
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
          <img
            src={open.url}
            alt={open.caption ?? ""}
            className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
          />
          {open.caption && <p className="text-sm text-white/90">{open.caption}</p>}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Render it in GameDetailPage**

Add import:

```tsx
import { BrandingScreenshots } from "./components/BrandingScreenshots";
```

Render after the `BrandingLinks` line:

```tsx
      {brand?.screenshots?.length ? (
        <BrandingScreenshots shots={brand.screenshots} />
      ) : null}
```

- [ ] **Step 3: Typecheck + lint + commit**

Run: `bun run typecheck` Run: `bunx biome ci src/content` Expected: clean.

```bash
git add src/content/pages/components/BrandingScreenshots.tsx src/content/pages/GameDetailPage.tsx
git commit -m "feat(content): branding screenshots strip + lightbox"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full CI-parity suite**

Run: `cargo fmt --all --check` Run: `cargo clippy --all-targets --all-features -- -D warnings` Run: `bunx biome ci .` Run: `bun run typecheck` Run: `cargo test -p tauri-plugin-coilbox-content` Expected: all green.

- [ ] **Step 2: Live end-to-end via `bun tauri dev` + Tauri MCP**

Confirm and screenshot:
- Splinter Faction (or a temporarily-matched installed game): hero banner + logo, a Links row (Website + itch.io) that opens the system browser, and — if seeded — a screenshots strip + lightbox.
- A non-matching sibling game stays unbranded (no cross-branding).
- Second launch: branding images load from disk cache with no network fetch; a deliberately-broken URL falls through to the next fallback / the game's own art.
- Offline first-run still brands from the bundled seed.

- [ ] **Step 3: Final commit**

```bash
git add -u
git commit -m "chore(content): branding catalog final polish"
```

---

## Success criteria (from the spec)

- Matched game shows catalog **banner** in hero + card, overriding loadpicture art; non-matching game unchanged.
- Splinter Faction seed shows itch.io banner, `splinterfaction.info` logo, Website + itch.io links.
- Each remote image fetched **once**; relaunch renders from `coilbox-branding-images/<hash>.dataurl` with no network; failed URL recorded (`.none`) and next fallback used.
- Offline first-run brands from the bundled seed; prior fetch uses the disk cache.
- Invalid regex entry is skipped without breaking others.
- Sibling projects are **not** cross-branded.
- `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `bunx biome ci .`, `bun run typecheck`, `cargo test -p tauri-plugin-coilbox-content` all green.
- Verified live via `bun tauri dev` + Tauri MCP screenshots.
```
