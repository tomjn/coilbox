# Rapid pool cache: background warm + orphan prune

Issue: #329 (parent #326). Gap-analysis candidate CB-34.

## Goal

Two pieces of client-side content housekeeping for the rapid content system, no protocol involvement:

1. **Warm** the rapid pool cache in the background after content scans / downloads, so first launch/join is faster (or at least a cache-warm summary is logged).
2. **Prune** orphaned rapid pool data left behind by removed/replaced/failed downloads, which pr-downloader never cleans up.

## Background: how rapid stores content on disk

Under each data root (`engine/ games/ maps/ packages/ pool/ rapid/`):

- `packages/<md5>.sdp` — one gzip-compressed manifest per rapid package. Each entry is `u8 name-len | name | 16-byte pool-md5 | 4-byte crc32 | 4-byte size` (byte-exact per pr-downloader `FileSystem::parseSdp`). The 16-byte md5 identifies a pool blob.
- `pool/<md5[:2]>/<md5[2:]>.gz` — content-addressed blobs (md5 is 32 lowercase hex; shard = first 2 chars, filename = remaining 30 + `.gz`). Referenced **only** by `.sdp` manifests — never by loose maps/games.
- `rapid/<host>/<repo>/versions.gz` — the repo index (`tag,md5,depends,longname`). Retains full history (thousands of superseded versions), so it is **not** a reliable "is this package still needed?" signal.

Key invariant that makes safe GC possible: a pool blob is needed iff some `.sdp` still on disk references it. The `.sdp` files on disk are the source of truth for installed rapid content. Pools are per-root (not shared across roots).

## Warm

Background-read every `packages/*.sdp` manifest into memory, warming the OS page cache the engine hits when resolving rapid tags on launch. Manifests only (KBs–MBs); never the full pool (can be GBs). Bounded and honest — we do not claim an unmeasured launch speedup; we log a cache-warm summary (packages + bytes), satisfying the AC's "cache-hit logged" arm.

- Command: `content_warm_rapid_pool(roots: Vec<String>) -> WarmSummary { packages, bytes }`.
- Runs on `spawn_blocking`; fired fire-and-forget from the frontend so the UI never blocks.
- Triggered from `ContentStartupProvider.warmUp` (after the initial scan primes) and from the `DownloadQueueProvider` post-download hook after a rapid (`dl_download`) completes.

## Prune (safety-critical)

Prune **orphaned pool blobs**, refcounted against the `.sdp` files still on disk. Per root:

1. Parse every `packages/*.sdp`, collecting the referenced pool-md5 set.
2. Walk `pool/<xx>/<rest>.gz`; any blob whose md5 (`xx` + `rest`) is not in the referenced set is orphaned.
3. Also sweep leftover `*.incomplete` temp files (`packages/*.sdp.incomplete`, `pool/**/*.gz.incomplete`) and `.sdp` files that fail to parse (corrupt/zero-byte); a corrupt `.sdp` contributes no refs, so its blobs are correctly reclaimable.

This is a change from the issue's literal "prune stale packages": versions.gz-based `.sdp` deletion is dropped (near-useless because versions.gz retains history, and risky if the index is stale/partial). On-disk `.sdp` = source of truth, so a blob is kept iff a real installed package references it — it cannot remove data an installed package needs (satisfies "pruning never removes packages referenced by installed content"). It reclaims exactly the space left behind by removed/replaced/failed content.

- Command: `content_prune_rapid_pool(root: String, apply: bool) -> PruneSummary`.
  - `apply=false` is a dry run: computes the summary, deletes nothing.
  - `apply=true` deletes the identified orphans + incomplete leftovers.
  - `PruneSummary { blobs, blob_bytes, incompletes, incomplete_bytes, unreadable_sdp }`.
- Guard: the UI disables the prune action while a download is `active` or `queued` (no in-flight downloads), so we never race a mid-write blob. Defense in depth only — the command itself is pure filesystem work.

## UI

Per-root, on each `RootCard` in `FoldersSection` (`/settings/content-folders`), a "Reclaim space" action next to the existing packages count. Clicking runs a dry run and shows "N orphaned blobs, X MB reclaimable" (plus incomplete leftovers); a confirm then prunes and shows what was removed. Disabled while the download queue is non-idle, with a tooltip explaining why.

## Testing

- Rust unit tests (in `rapid_pool.rs`):
  - `sdp_pool_refs`: byte-exact parse of a hand-built gzip `.sdp` fixture yields the expected pool md5s; a zero-byte/corrupt `.sdp` yields an error (counted as unreadable), not a panic.
  - `prune` over a temp fixture: a referenced blob survives; an unreferenced blob is removed; a `.incomplete` leftover is swept; dry run (`apply=false`) removes nothing but reports the same counts; a root with no `pool/` is a no-op.
  - `warm`: counts packages + bytes over a fixture.
- Frontend: a pure predicate for the idle gate (`canPrune(active, queued)`).

## Non-goals

- No pool GC across roots (pools are per-root).
- No deletion of valid `.sdp` packages (only corrupt/incomplete ones).
- No background auto-pruning (prune is always user-initiated with a preview).
